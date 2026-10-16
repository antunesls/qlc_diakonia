# QLCPlus-MCP

QLCPlus-MCP is a TypeScript Model Context Protocol server for controlling **QLC+ 5 through its native network protocol**.

The server connects to the QLC+ Native Server, authenticates, downloads the active project and keeps a complete model of it (universes, fixtures, groups, functions, shows and the Virtual Console). On top of that model it exposes MCP tools to **build and edit the whole project** — patch fixtures, write scenes from looks ("red at 60%"), chasers, sequences, EFX, RGB matrices, collections, scripts and shows, and lay out a Virtual Console from a declarative description — plus live show control.

Every edit is sent as QLC+ native editing actions, then the project is reloaded from QLC+ and checked, so the agent is told about anything QLC+ did not apply.

OSC, WebSocket, `/vc.json`, static `widgets.json` runtime mappings and QLC+ 4 control are not part of the supported runtime.

## Features

- QLC+ 5 native TCP control on port `9998`.
- Automatic authorization/project-download lifecycle.
- Automatic reconnect and fresh inventory after QLC+ restarts.
- Runtime discovery of Virtual Console buttons and sliders.
- Exact button-caption execution with case-insensitive matching only.
- Full project editing: fixtures, fixture groups, universes, every function type, Show Manager timelines and the Virtual Console.
- Fixture-aware scene writing: colors, dimmer, pan/tilt, strobe, gobos and raw channels resolved from the QLC+ fixture definitions.
- Declarative Virtual Console building with automatic layout.
- In-place updates that keep IDs and repair the references QLC+ drops when a function is recreated.
- Optional extended API of the QLC+ fork: save/load/new/upload project, server-side fixture library, I/O patching, page and group management.
- MCP over local STDIO or Streamable HTTP.
- Optional HTTP bearer authentication.
- Native connection/status reporting.
- Repository `PROMPT.md` exposed as an MCP prompt, resource and tool.

For implementation details, see [ARCHITECTURE.md](ARCHITECTURE.md).

## Requirements

- Node.js `>=20.20.0` (Node 22 recommended).
- npm.
- QLC+ 5 with Native Server enabled.
- A QLC+ build compatible with upstream commit `984f0e7` or a release containing equivalent grouped native Virtual Console action behavior.
- For project management, I/O patching and page/group deletion: the QLC+ fork with the extended native API (branch `feat/native-api-ext`). Everything else works with stock QLC+ 5, except that stock QLC+ 5 ignores Virtual Console widgets created into a page after a project was loaded (fixed in the fork).

### Building the QLC+ fork on Windows

With [MSYS2](https://www.msys2.org/) installed in `C:\msys64`, from a **UCRT64** shell:

```bash
pacman -S --needed mingw-w64-ucrt-x86_64-{gcc,cmake,ninja,pkgconf,libmad,libsndfile,flac,fftw,libusb} \
  mingw-w64-ucrt-x86_64-qt6-{base,declarative,3d,multimedia,websockets,serialport,imageformats,svg,tools,shadertools,5compat}
cmake -S . -B build -G Ninja -DCMAKE_BUILD_TYPE=Release -Dqmlui=ON
cmake --build build && cmake --install build          # installs to C:\qlcplus
cd /c/qlcplus && windeployqt6 --qmldir <qlcplus source>/qmlui/qml qlcplus5.exe qlcplusengine.dll plugins/dmxusb.dll
```

Then copy the MSYS2 DLLs the install depends on (`ldd` on every `.dll`/`.exe` under `C:\qlcplus`, copying anything resolved from `/ucrt64/bin`), and add `C:\qlcplus\qt.conf` so the deployed QML modules are found:

```ini
[Paths]
Prefix = .
Plugins = .
QmlImports = qml
```

The FTDI D2XX SDK in `C:\projects\D2XXSDK` is optional; without it the DMX USB plugin uses its serial-port backend. Start QLC+ with `qlcplus5.exe -o project.qxw`, or with `--openlast` to reopen the most recent project (the last file opened or saved with a path, including through `qlc_project_load` and `qlc_project_save`). `--server-allow-all` starts the native server and grants every native client full access without the authorization dialog (development only).
- Grant the client every access right in the QLC+ authorization dialog (fixture, function, VC and show editing, I/O and, on the fork, project management).

## Quick Start

```bash
git clone https://github.com/infrafast/QLCPlus-MCP.git
cd QLCPlus-MCP
npm ci
npm run build
cp .env.example .env
```

For same-machine QLC+ and local HTTP use, the defaults are intentionally loopback-only:

```text
MCP_TRANSPORT=http
HTTP_HOST=127.0.0.1
QLC_NATIVE_HOST=127.0.0.1
QLC_NATIVE_PORT=9998
```

Start the server:

```bash
npm run start:http
```

Health endpoint:

```text
http://127.0.0.1:8788/health
```

MCP endpoint:

```text
http://127.0.0.1:8788/mcp
```

QLC+ may display an authorization dialog for `QLCPlus-MCP`. Approve it once when required. The server becomes operational only after native state reaches `ready` and the current project inventory has been validated.

## QLC+ Native Setup

1. Start the supported QLC+ 5 build.
2. Enable the QLC+ Native Server.
3. Keep it on localhost whenever QLCPlus-MCP runs on the same machine.
4. Start QLCPlus-MCP.
5. Approve `QLCPlus-MCP` if QLC+ asks for authorization.
6. Check `qlc_get_state` or `/health` until state is `ready`.

On Linux/Raspberry Pi, localhost clients use a per-process address inside `127.0.0.0/8`. This lets QLC+ distinguish concurrent native clients without exposing port `9998` to the LAN.

## Widget Names

QLCPlus-MCP executes buttons by their complete QLC+ caption.

Matching ignores **case only**. Spaces and other characters remain part of the name:

```text
Blue Speed  == blue speed
blue speed  != blue_speed
blue speed  != bluespeed
```

Therefore a widget named **`blue speed` is fully supported**.

The agent may call:

```json
{
  "widgetName": "blue speed"
}
```

`qlc_button_press` validates the caption against the current native inventory before sending any QLC+ packet. A separate `qlc_list_widgets` call is not required when the user already supplied a complete caption.

Use `qlc_list_widgets` when discovering available controls, searching by a partial term, or recovering after an exact caption was rejected.

## MCP Tools

### `qlc_get_state`

Reports native lifecycle and runtime information including authorization, inventory generation, reconnect count and last successful action.

Only `ready` means a current project inventory is authorized and usable.

### `qlc_list_widgets`

Lists widgets discovered from the active project. Optional filters include widget type, text query and result limit.

Numeric QLC+ widget IDs are session-only and can change after project reload/reconnect.

### `qlc_button_press`

Executes one complete Virtual Console button caption.

- case-insensitive only;
- spaces significant;
- accents significant;
- punctuation significant;
- `_` and `-` significant;
- no substring/fuzzy substitution.

Flash buttons are sent as press/release; normal toggle-style buttons are press-only.

### Editing tools

Enabled by default (`QLC_TOOLSET=full`). `QLC_TOOLSET=control` restores the four-tool control inventory above.

| Area | Tools |
| --- | --- |
| Project | `qlc_project_summary`, `qlc_project_export_xml`, `qlc_project_save`¹, `qlc_project_new`¹, `qlc_project_load`¹, `qlc_project_upload_xml`¹ |
| Fixtures | `qlc_fixture_library_search`, `qlc_fixture_definition`, `qlc_fixture_list`, `qlc_fixture_add`, `qlc_fixture_update`, `qlc_fixture_position`, `qlc_fixture_remove`, `qlc_fixture_group_create`, `qlc_fixture_group_delete`¹, `qlc_universe_add`, `qlc_io_list`¹, `qlc_io_patch`¹ |
| Functions | `qlc_function_list`, `qlc_function_get`, `qlc_function_update`, `qlc_function_delete`, `qlc_scene_set`, `qlc_chaser_set`, `qlc_sequence_set`, `qlc_efx_set`, `qlc_rgbmatrix_set`, `qlc_rgbmatrix_algorithms`, `qlc_collection_set`, `qlc_script_set`, `qlc_show_set`, `qlc_media_set` |
| Virtual Console | `qlc_vc_tree`, `qlc_vc_build`, `qlc_vc_widget_update`, `qlc_vc_widget_move`, `qlc_vc_widget_delete`, `qlc_vc_page_rename`, `qlc_vc_page_add`¹, `qlc_vc_page_remove`¹ |
| Live | `qlc_function_start`, `qlc_function_stop`, `qlc_slider_set`, `qlc_cuelist_control`, `qlc_speeddial_set`, `qlc_xypad_set`, `qlc_simpledesk_set` |

¹ Needs the QLC+ fork; `qlc_get_state` and `qlc_project_summary` report the features the connected server supports.

Objects are referenced by numeric ID or by exact name (case-insensitive). The `*_set` tools create a function, or overwrite the one named in `replace` while keeping its ID: scenes are edited value by value, other types are recreated and their uses in chasers, collections, cue lists, buttons and sliders are restored.

Example `qlc_vc_build` input:

```json
{
  "page": 0,
  "widgets": [
    {
      "type": "frame", "caption": "Colors", "columns": 4,
      "children": [
        { "type": "button", "caption": "Red", "function": "Wash Red", "backgroundColor": "red" },
        { "type": "button", "caption": "Blue", "function": "Wash Blue", "backgroundColor": "blue" },
        { "type": "slider", "caption": "Pars", "fixtures": ["PAR 1", "PAR 2"] }
      ]
    },
    { "type": "cuelist", "caption": "Song 1", "chaser": "Song 1 cues" }
  ]
}
```

Scene looks resolve colors and intensities through the fixture definitions. On stock QLC+ the definitions are read from the local QLC+ fixture directories (`QLC_FIXTURE_DIRS` overrides them); on the fork they come from QLC+ itself.

### `get_agent_prompt`

Returns [PROMPT.md](PROMPT.md), the recommended lighting-agent instructions.

The same content is also available as MCP prompt `agent_prompt` and resource `agent://prompt/system`.

## Local deterministic gateway

OR4B1 adds an optional deterministic command gateway for the LiveStageAssistant Local engine. It is **disabled by default** so ordinary/cloud MCP clients keep the existing tool inventory and behavior.

Enable it only for a dedicated Local LSA process/instance:

```text
LSA_LOCAL_COMMAND_GATEWAY=1
```

When enabled, two additional reserved tools are exposed:

- `lsa_local_analyze_command`: read-only analysis of QLC state/list/button commands;
- `lsa_local_execute_command`: execution of a previously analyzed plan token.

The gateway uses `lsa-command-gateway/v1` from the pinned `@infrafast/stage-command-core` dependency. QLC button identity still ignores case only; accents, spaces, punctuation, underscores and hyphens remain significant. Write plans are short-lived and one-shot, and a button plan is rejected if the native inventory generation changed between analyze and execute.

### How to speak or type deterministic QLC commands

The deterministic parser is intentionally narrow. Prefer the canonical formulations below in voice mode or chat when using the Local parsing gateway:

| Intent | Canonical example |
|---|---|
| Native/session state | `qlc état` |
| List current controls | `liste tous les contrôles qlc` |
| Press an exact Virtual Console button | `qlc wave` |

For a button command, replace `wave` with the **complete current QLC+ caption**. Execution identity is case-insensitive only:

```text
qlc Blue Speed   == qlc blue speed
qlc blue speed   != qlc blue_speed
qlc blue speed   != qlc bluespeed
```

Spaces, accents, punctuation, underscores and hyphens therefore remain significant. In the **Local spoken-command wrapper only**, a literal exact caption is tried first; if that fails, trailing sentence punctuation added by STT (`.`, `?`, `!`, `…`) is removed and the exact lookup is retried. Thus `QLC rouge.` can safely execute a button captioned `Rouge`, while a real caption `Alert!` still wins before any stripping. Optional comma/colon punctuation immediately after the spoken `QLC` prefix is also treated as command syntax. The normal `qlc_button_press` MCP tool keeps punctuation fully significant.

A partial/search result may help discovery, but it never authorizes a write. If the parser cannot identify exactly one safe button caption from the current native inventory, it asks for clarification or refuses the action rather than guessing.

The deterministic grammar is not arbitrary natural-language understanding. Commands not documented here and not covered by parser tests should be treated as unsupported until the parser is explicitly extended.

### Cloud/LLM mode versus deterministic parsing

In normal MCP/LLM mode, the model selects tools such as `qlc_get_state`, `qlc_list_widgets`, and `qlc_button_press`.

In deterministic Local mode, the client only uses `lsa_local_analyze_command` and `lsa_local_execute_command`. QLCPlus-MCP parses the text, validates it against the current native inventory, creates an opaque short-lived plan, and executes that plan through the same native QLC+ implementation. No LLM chooses the underlying QLC tool.


## STDIO Mode

For an MCP host running on the same machine:

```bash
npm run start:stdio
```

Example MCP configuration:

```json
{
  "mcpServers": {
    "qlcplus": {
      "command": "node",
      "args": ["/absolute/path/to/QLCPlus-MCP/dist/src/index.js"],
      "env": {
        "MCP_TRANSPORT": "stdio",
        "QLC_NATIVE_HOST": "127.0.0.1"
      }
    }
  }
}
```

`PROMPT.md` is discovered automatically from the QLCPlus-MCP installation, even when the MCP process is launched with another working directory. `MCP_PROMPT_FILE` is needed only to deliberately override the bundled prompt.

Build the project before using `dist/src/index.js`.

## HTTP Mode

HTTP defaults to loopback for safety:

```text
HTTP_HOST=127.0.0.1
HTTP_PORT=8788
HTTP_MCP_PATH=/mcp
```

For direct network access, explicitly bind to a network interface and enable bearer auth:

```bash
HTTP_HOST=0.0.0.0 \
MCP_AUTH_MODE=bearer \
MCP_AUTH_TOKEN="$(openssl rand -base64 32)" \
npm run start:http
```

For the validated Raspberry Pi rack deployment, direct network binding is not required: keep `HTTP_HOST=127.0.0.1` and publish the service through Tailscale Funnel instead.

### Validated Tailscale Funnel endpoint

The rack setup exposes QLCPlus-MCP through the Raspberry Pi's stable Tailscale hostname under `/qlc`:

```text
Local MCP    : http://127.0.0.1:8788/mcp
Public MCP   : https://raspberrypi-1.tail70348.ts.net/qlc/mcp
Public health: https://raspberrypi-1.tail70348.ts.net/qlc/health
```

Configure Funnel with:

```bash
sudo tailscale funnel --https=443 --set-path=/qlc --bg 8788
```

Expected proxy path:

```text
https://raspberrypi-1.tail70348.ts.net/qlc
        ↓
http://127.0.0.1:8788
```

Keeping QLCPlus-MCP bound to loopback means port `8788` is not exposed directly on the LAN while Funnel provides the public HTTPS endpoint.

The public `/health` endpoint intentionally exposes only minimal service/native readiness information. It never exposes the bearer token, native encryption key, or generated authenticated client configuration.

Authenticated endpoints include `/mcp/status`, `/mcp/logs`, `/mcp/tools`, `/mcp/resources`, and the MCP endpoint itself.

## Configuration

Environment files are searched in this order:

1. `QLCPLUS_MCP_ENV_FILE`
2. `/etc/qlcplusmcp.env`
3. `/config/.env`
4. `config/.env`
5. `.env`

The repository does **not** track a machine-specific `config/.env`.

Main variables:

```text
MCP_TRANSPORT=stdio|http
HTTP_HOST=127.0.0.1
HTTP_PORT=8788
HTTP_MCP_PATH=/mcp
MCP_AUTH_MODE=none|bearer
MCP_AUTH_TOKEN=...

QLC_NATIVE_HOST=127.0.0.1
QLC_NATIVE_PORT=9998
QLC_NATIVE_ENCRYPTION_KEY=
QLC_NATIVE_RECONNECT_MS=2000
QLC_NATIVE_CONNECT_TIMEOUT_MS=10000
QLC_NATIVE_MAX_PROJECT_SIZE=16777216
QLC_NATIVE_CLIENT_NAME=QLCPlus-MCP
QLC_REQUEST_TIMEOUT_MS=15000

QLC_TOOLSET=full|control
QLC_FIXTURE_DIRS=C:QLC+Fixtures;C:UsersmeQLC+Fixtures

QLC_DRY_RUN=false
MCP_PROMPT_FILE=/optional/custom/PROMPT.md
LOG_LEVEL=info
NODE_ENV=production|development
```

Native QLC+ control is always enabled because it is the only supported QLC+ runtime path. There is no `QLC_NATIVE_ENABLED` setting. Use `QLC_DRY_RUN=true` when you intentionally want the MCP to open no QLC+ socket and send no live action.

Legacy OSC-era variables such as `QLC_ALLOW_RAW_OSC`, `QLC_HOST`, `QLC_OSC_INPUT_PORT`, `QLC_OSC_OUTPUT_PORT`, `QLC_UNIVERSE` and `QLC_WIDGETS_FILE` are not read and should be removed from deployment configuration.

`dotenv` is configured quietly by the application, so `DOTENV_CONFIG_QUIET` is not required.

`MCP_PROMPT_FILE` is optional and normally unnecessary; it exists only for a deliberate custom prompt override.

## Raspberry Pi Service

The `qlcplusmcp_raspi_service_pack` directory contains the systemd service, environment template, installer and helper command.

Typical installation:

```bash
cd /home/pi/QLCPlus-MCP
npm ci
npm run build
cd qlcplusmcp_raspi_service_pack
chmod +x install_qlcplusmcp_service.sh
./install_qlcplusmcp_service.sh
qlcplusmcp auto
qlcplusmcp health
```

The installer:

- creates `/etc/qlcplusmcp.env` only if it does not already exist;
- preserves existing runtime configuration on reinstall;
- stores the environment file with mode `600`;
- defaults HTTP to `127.0.0.1`;
- defaults QLC+ native control to `127.0.0.1:9998`;
- documents the validated public Funnel endpoint `https://raspberrypi-1.tail70348.ts.net/qlc/mcp`.

Useful commands:

```text
qlcplusmcp start
qlcplusmcp stop
qlcplusmcp restart
qlcplusmcp status
qlcplusmcp logs
qlcplusmcp health
qlcplusmcp endpoint
qlcplusmcp test-remote
qlcplusmcp auto
qlcplusmcp noauto
qlcplusmcp config
```

`qlcplusmcp endpoint` prints both the local and validated public MCP URLs. `qlcplusmcp test-remote` checks the Funnel health endpoint.

## Docker

Build/run with Docker Compose:

```bash
docker compose up --build
```

The container exposes only the MCP HTTP TCP port. No OSC UDP port is exposed.

By default Docker Compose uses `host.docker.internal` as the QLC+ native target. Override `QLC_NATIVE_HOST` when QLC+ is reachable elsewhere.

If HTTP is published beyond a trusted local host, enable bearer authentication.

## Development

```bash
npm ci
npm run build
npm run test:ci
```

Watch mode:

```bash
npm run dev
```

Formatting:

```bash
npm run format
```

GitHub Actions runs build and tests on Node 20.20 and Node 22 for pull requests and `main` pushes.

Generated `dist/` output is not tracked in Git. Build it locally or in the deployment image/service before starting the compiled entry point.

## Troubleshooting

### Native state never reaches `ready`

Check:

- QLC+ 5 Native Server is enabled;
- `QLC_NATIVE_HOST` and `QLC_NATIVE_PORT` are correct;
- QLC+ authorization has been approved if prompted;
- the QLC+ build is compatible with the required native protocol behavior;
- the project transfer is not rejected by the configured size limit.

### Exact button not found

Call `qlc_list_widgets` and compare the complete caption. Do not remove spaces or replace them with underscores.

For example, if the inventory contains `blue speed`, call exactly `blue speed` (case may differ), not `blue_speed` or `bluespeed`.

### HTTP client receives 401

When `MCP_AUTH_MODE=bearer`, send:

```text
Authorization: Bearer <MCP_AUTH_TOKEN>
```

### QLC+ restarts

QLCPlus-MCP invalidates the old inventory, reconnects, downloads the fresh project and returns to `ready`. Numeric widget IDs from the old session are never treated as persistent identifiers.

## Documentation

- [README.md](README.md): installation and operation.
- [ARCHITECTURE.md](ARCHITECTURE.md): technical design and security boundaries.
- [ROADMAP.md](ROADMAP.md): migration history and future native work.
- [AGENTS.md](AGENTS.md): coding-agent maintenance rules.
- [PROMPT.md](PROMPT.md): runtime AI-agent behavior.

## License

MIT — see [LICENSE](LICENSE).

## References

- [QLC+ Documentation](https://docs.qlcplus.org/)
- [Model Context Protocol](https://modelcontextprotocol.io/)
