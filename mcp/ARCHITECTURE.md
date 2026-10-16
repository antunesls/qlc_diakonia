# QLCPlus-MCP Architecture

QLCPlus-MCP is a TypeScript MCP server that controls QLC+ 5 through the QLC+ native network protocol.

User-facing installation and operation live in [README.md](README.md). Migration history and future work live in [ROADMAP.md](ROADMAP.md).

## Product Architecture

```text
MCP client
  -> QLCPlus-MCP tool layer
  -> QLC+ native session
  -> authentication
  -> active-project transfer
  -> validated in-memory Virtual Console inventory
  -> exact caption resolution
  -> native Virtual Console button action
  -> QLC+ 5 lighting engine
```

There is one supported QLC+ runtime transport: **native TCP**.

OSC, WebSocket, `/vc.json`, static runtime `widgets.json`, raw DMX helpers and QLC+ 4 compatibility are intentionally absent from the runtime.

## Startup

[src/index.ts](src/index.ts) performs startup orchestration:

1. load the first available runtime environment file;
2. validate configuration with Zod;
3. initialize logging;
4. initialize the QLC+ native client;
5. register MCP tools/resources/prompts;
6. start STDIO or Streamable HTTP MCP transport.

Environment files are searched in this order:

1. `QLCPLUS_MCP_ENV_FILE`
2. `/etc/qlcplusmcp.env`
3. `/config/.env`
4. `config/.env`
5. `.env`

The repository does not track a machine-specific env file.

## Core Modules

### Configuration — `src/config.ts`

`ConfigSchema` contains only MCP/HTTP, native QLC+, dry-run and logging settings.

Important defaults:

```text
MCP_TRANSPORT=stdio
HTTP_HOST=127.0.0.1
HTTP_PORT=8788
QLC_NATIVE_ENABLED=true
QLC_NATIVE_HOST=127.0.0.1
QLC_NATIVE_PORT=9998
QLC_DRY_RUN=false
```

Boolean environment values are parsed as true booleans rather than forcing absent variables to `false`. Therefore omission of `QLC_NATIVE_ENABLED` correctly keeps the schema default `true`.

Bearer mode requires a non-empty `MCP_AUTH_TOKEN` during configuration validation.

### MCP server — `src/mcpServer.ts`

The official Model Context Protocol SDK is used directly.

Responsibilities:

- expose tool JSON schemas generated from Zod;
- validate tool arguments;
- expose `PROMPT.md` as prompt `agent_prompt`;
- expose `PROMPT.md` as resource `agent://prompt/system`;
- expose `PROMPT.md` through tool `get_agent_prompt`.

### Prompt loading — `src/agentPrompt.ts`

`MCP_PROMPT_FILE` is resolved when the prompt is read, after runtime environment loading. This prevents a custom prompt path from being missed because of ES module import order.

### Logging — `src/logger.ts`

Pino provides structured logging and an in-memory recent-log buffer for the HTTP diagnostic surface.

STDIO mode sends logs to stderr so stdout remains reserved for MCP framing.

## QLC+ Native Protocol

### Endpoint selection — `src/qlc/nativeHost.ts`

Default target:

```text
127.0.0.1:9998
```

On Linux, a localhost target receives a per-process source identity inside `127.0.0.0/8`.

Example:

```text
process A -> 127.x.y.z -> QLC+ :9998
process B -> 127.a.b.c -> QLC+ :9998
```

QLC+ keys native sessions by source address. Distinct loopback source addresses allow concurrent local native clients without exposing QLC+ Native Server to the LAN.

macOS does not use undeclared secondary loopback source addresses and therefore uses the normal platform source selection.

### Codec — `src/qlc/nativeCodec.ts`

Responsibilities:

- native packet headers;
- SimpleCrypt compatibility;
- compression/decompression;
- CRC/SHA integrity handling;
- typed native sections;
- fragmented/coalesced TCP frame decoding;
- protocol and allocation bounds.

Key bounds include:

- native encrypted packet protocol length;
- bounded decrypted output;
- bounded section lengths;
- bounded decompression output.

Malformed framing is treated as a connection failure rather than scanning arbitrary encrypted data for another apparent header.

SimpleCrypt is a QLC+ protocol compatibility mechanism, **not modern transport security**. Native access should remain on localhost or a trusted show network.

### Project inventory — `src/qlc/nativeInventory.ts`

After authorization, QLC+ transfers the active project. The server parses only the metadata required for Virtual Console control.

The parser:

- enforces a configurable maximum project size;
- rejects XML entities;
- accepts only the inert standard `<!DOCTYPE Workspace>` form;
- discovers buttons/sliders recursively inside Virtual Console;
- records Frame/SoloFrame hierarchy;
- records button action type and slider metadata;
- builds a new inventory before replacing the current one.

#### Caption identity

Runtime command identity ignores **case only**.

```text
Blue Speed  == blue speed
blue speed  != blue_speed
blue speed  != bluespeed
Été         != Ete
```

Internal spaces, accents, punctuation, underscores and hyphens are significant.

`exactNativeCaptionKey()` is the only identity key used for command lookup and duplicate detection.

`normalizeNativeCaption()` remains diagnostic/search metadata only. Its separator/accent-insensitive form must never authorize an action or collapse two otherwise distinct live captions.

This specifically means widgets such as `blue speed` are supported without renaming.

### Native client — `src/qlc/nativeClient.ts`

The native client implements the lifecycle:

```text
disabled
  or
connecting
  -> waiting-for-authorization
  -> downloading-project
  -> ready
  -> disconnected
  -> connecting ...
```

`ready` requires all of the following:

- TCP connection exists;
- QLC+ authorization succeeded;
- the complete current project was received;
- the project passed validation;
- the current inventory was installed atomically.

A raw TCP connection is never reported as ready.

Each native receive callback is bound to the exact socket that delivered the bytes. Frames arriving from a socket that is no longer the current session are ignored, including errors or project data that race with reconnect.

When a new project transfer starts with sequence `0`:

- the previous inventory is invalidated immediately;
- `inventoryLoadedAt` is cleared;
- state changes to `downloading-project` before the new project can be used;
- button actions are therefore rejected until the replacement inventory has been completely parsed and validated;
- a project-transfer generation counter identifies which asynchronous parse is still current.

Once all bytes for a project have been assembled, the transfer buffer is detached and reset before XML parsing begins. If a newer transfer starts on the same socket while the older XML parse is still running, only the newest transfer generation may install an inventory. Likewise, a parse from an old socket can never install into a replacement connection.

On disconnect:

- socket state is cleared;
- the current project-transfer generation is invalidated;
- decoder/project-transfer state is reset;
- the inventory is invalidated immediately;
- old numeric widget IDs become unusable;
- reconnect is scheduled with bounded interval/log repetition;
- a fresh project must be downloaded before returning to `ready`.

TCP keepalive is enabled. QLC+ `NetPoll`/`NetPollReply` are not relied upon.

## Button Execution

`qlc_button_press` calls `QlcNativeClient.pressButton()`.

Execution flow:

```text
complete caption
  -> exactNativeCaptionKey(caption)
  -> current inventory.buttons lookup
  -> verify native state == ready
  -> VCButtonSetPressed packet
```

Current native action code:

```text
VCButtonSetPressed = 0xF200
```

Button semantics:

- Toggle/default/ordinary buttons: press-only;
- Flash: press, wait briefly, release;
- slider with the same exact caption: explicit wrong-kind error;
- missing exact caption: explicit error; no fuzzy fallback is executed.

A command is counted successful only after the packet write completes.

## MCP Tools

| Tool | Purpose |
| --- | --- |
| `get_agent_prompt` | Return runtime agent guidance. |
| `qlc_get_state` | Report native lifecycle/inventory/reconnect/action state. |
| `qlc_list_widgets` | Discover the current native project inventory. |
| `qlc_button_press` | Execute one complete exact button caption. |

### Efficient agent flow

If the user already supplies a complete caption, the agent should call `qlc_button_press` directly. The server performs the authoritative inventory check.

`qlc_list_widgets` is intended for:

- inventory questions;
- partial searches;
- user discovery;
- recovery after an exact caption fails.

This removes an unnecessary MCP round trip from normal live commands without weakening validation.

## Local deterministic command gateway

OR4B1 adds a Local-engine-only adapter around the existing native client. The adapter does not implement another QLC protocol or inventory.

```text
Local transcript
  -> lsa_local_analyze_command   [read-only]
  -> exact QLC caption/current inventory resolution
  -> opaque short-lived plan token
  -> lsa_local_execute_command
  -> existing QlcNativeClient methods
```

The gateway is registered only when `LSA_LOCAL_COMMAND_GATEWAY=1`. Without that flag, the ordinary/cloud tool inventory remains `get_agent_prompt`, `qlc_get_state`, `qlc_list_widgets`, and `qlc_button_press`.

State/list plans are reads. Button plans are writes and bind the exact resolved caption plus the current `inventoryGeneration`. Execution rejects stale generations before calling `pressButton()`. Exact caption authorization always uses the existing case-only identity rule; partial matches are suggestions/clarification only and can never create a write plan directly.

## STDIO Transport

`src/transports/stdio.ts` uses `StdioServerTransport`.

It is preferred when the MCP host and QLCPlus-MCP run on the same machine because it avoids an HTTP listener entirely.

Closing or failing the STDIO transport goes through the same native-client cleanup path before process exit. The cleanup helper is directly behavior-tested so a regression cannot leave the native socket/reconnect lifecycle alive after the MCP parent disappears.

## HTTP Transport

`src/transports/http.ts` implements:

- **stateless Streamable HTTP MCP**;
- `/health`;
- authenticated `/mcp/status`;
- authenticated log/tool/resource diagnostics;
- optional bearer authentication;
- a read-only native status page.

The MCP endpoint intentionally does not allocate or retain `Mcp-Session-Id` values. A fresh `StreamableHTTPServerTransport` and MCP server binding are created for each MCP protocol request with `sessionIdGenerator: undefined` and JSON responses enabled. The QLC+ native client and current project inventory remain process-global runtime state, not MCP transport-session state.

This means an HTTP client can continue using the same `/mcp` URL after QLCPlus-MCP or the Raspberry Pi restarts, once the service is reachable again, without depending on an in-memory MCP session created before the restart. Client configuration remains `type: "streamable-http"`.

The browser admin page remains available on `GET /mcp` when the request accepts HTML. Stateless MCP protocol traffic uses the same `/mcp` endpoint.

There is no runtime QLC+ reconfiguration form and no OSC configuration endpoint.

### Public health boundary

`/health` intentionally precedes bearer authorization so infrastructure can test liveness. It returns only minimal information:

- service identity;
- version;
- native enabled/state/ready;
- current widget count.

It does not return:

- bearer tokens;
- native encryption keys;
- authenticated client headers;
- full runtime config;
- runtime logs.

### Bearer token handling

When bearer mode is enabled:

- `MCP_AUTH_TOKEN` is required at startup;
- incoming tokens are compared with `timingSafeEqual` after equal-length validation;
- generated agent configuration displays a `<MCP_AUTH_TOKEN>` placeholder rather than the real secret;
- the real token is not logged.

HTTP request bodies are bounded to 1 MiB before JSON parsing.

Default HTTP binding is `127.0.0.1`. Network exposure is therefore explicit.

## Dry Run

With:

```text
QLC_DRY_RUN=true
```

the native client opens no TCP socket. Button calls return dry-run results without transmitting live actions.

This is suitable for integration testing but does not represent a `ready` live native session.

## Packaging

### Git repository

Generated `dist/` output is ignored and not tracked. A deployment must run `npm run build` before starting `dist/src/index.js`.

Machine-specific `.env` files and `config/.env` are ignored.

### Docker

The Docker build compiles TypeScript in a build stage and copies only compiled output plus `PROMPT.md` into the runtime image.

Only the HTTP TCP port is exposed. No OSC UDP port or widget/config volume is required.

### Raspberry Pi service

The service pack uses `/etc/qlcplusmcp.env`.

The installer preserves an existing environment file and sets mode `600`, preventing accidental destruction/exposure of bearer tokens or future secrets during reinstall.

## Automated Validation

GitHub Actions runs on pull requests and `main` pushes with Node 20.20 and Node 22:

```text
npm ci
npm run build
npm run test:ci
```

The tests cover native codec framing, native host selection, project inventory/security, connection/reconnect behavior, project/session race handling, button semantics, STDIO cleanup behavior, nullable MCP schemas, prompt behavior and native configuration defaults.

Live QLC+ validation remains necessary for protocol compatibility and actual lighting behavior because unit tests cannot prove a specific QLC+ build accepts and applies native actions.

## Security Boundaries

1. Never expose HTTP secrets through `/health`, status payloads, generated config or logs.
2. Prefer STDIO or loopback HTTP for same-host operation.
3. Use bearer authentication for non-loopback HTTP.
4. Keep QLC+ native TCP on localhost/trusted show networks.
5. Treat project data received from QLC+ as untrusted input and preserve allocation/XML bounds.
6. Never execute fuzzy/partial widget matches.
7. Never persist session-only numeric QLC+ widget IDs.
8. Never allow project data from an obsolete socket or obsolete transfer generation to replace the current inventory.
9. Keep Streamable HTTP stateless unless a future feature truly requires transport-level server-to-client session state.
