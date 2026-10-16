# QLC+ 5 Native Protocol Roadmap

## Product Decision

QLCPlus-MCP is a **QLC+ 5 native-network-protocol-only** MCP server.

The supported production path is:

```text
MCP client
  -> QLCPlus-MCP tools
  -> QLC+ native session
  -> active project inventory
  -> validated native Virtual Console actions
  -> QLC+ 5
```

OSC, WebSocket, `/vc.json`, QLC+ 4 runtime compatibility and static `widgets.json` mappings are no longer product targets.

## Compatibility Boundary

The implementation requires QLC+ native protocol behavior compatible with upstream commit `984f0e7` or a release containing equivalent grouped native Virtual Console action codes and authentication/project-transfer behavior.

Important currently used action code:

```text
VCButtonSetPressed = 0xF200
```

The protocol details reused from OculizerQLC include:

- TCP native sessions on port `9998`;
- QLC+ native authentication/SimpleCrypt compatibility;
- bounded TCP framing for fragmented/coalesced packets;
- bounded project-transfer reassembly;
- safe active-project XML parsing;
- Virtual Console button/slider inventory discovery;
- reconnect and fresh-project behavior;
- grouped Virtual Console action codes.

## Historical Rollback Anchor

The former OSC implementation remains available only through repository history.

Rollback anchor:

```text
dc3fc87
```

Do not reintroduce OSC code as an in-tree fallback. If historical comparison is required, inspect the rollback commit/tag instead.

## Milestone 0 — Freeze OSC Baseline

Status: **complete (historical)**

Purpose: preserve a known rollback point before native work.

Result:

- OSC baseline preserved in Git history;
- MCP tool contract recorded before migration;
- WebSocket migration abandoned in favor of direct native protocol work.

## Milestone 1 — Native Client, Inventory And Lifecycle

Status: **complete**

Implemented:

- native packet/section/SimpleCrypt codec;
- TCP framing and bounded decoding;
- authentication lifecycle;
- active-project transfer/reassembly;
- safe Virtual Console inventory parsing;
- explicit `connecting`, `waiting-for-authorization`, `downloading-project`, `ready`, `disconnected` and `stopped` states;
- atomic inventory replacement;
- inventory invalidation on disconnect;
- automatic reconnect and fresh project download;
- TCP keepalive;
- Linux per-process `127/8` local source identity for concurrent clients;
- dry-run with no native socket.

Accepted live behavior from the migration phase includes Raspberry Pi authorization, inventory discovery, QLC+ restart and reconnect/fresh-inventory recovery.

## Milestone 2 — Native MCP Button Control

Status: **implemented; representative live-lighting acceptance remains the release gate**

Implemented:

- `qlc_list_widgets` reads the native runtime inventory;
- `qlc_button_press` sends native Virtual Console button actions;
- Toggle/default buttons use press-only semantics;
- Flash uses press/release semantics;
- commands are rejected outside `ready`;
- numeric widget IDs remain session-only;
- raw OSC control was removed;
- exact button identity is validated server-side.

### Exact caption policy

Matching ignores **case only**.

```text
Blue Speed  == blue speed
blue speed  != blue_speed
blue speed  != bluespeed
Été         != Ete
```

Spaces are explicitly supported in widget captions.

No substring, separator-insensitive, accent-insensitive, semantic, closest or fuzzy match may authorize a live action.

### Efficient agent routing

A complete user-supplied caption goes directly to `qlc_button_press`.

`qlc_list_widgets` is used for discovery, partial search and recovery after an exact-match failure. This removes a redundant MCP round trip from normal commands while keeping the server as the authoritative validator.

### Remaining live acceptance gate

On the target QLC+ production build:

1. trigger representative Toggle buttons;
2. trigger a Flash button and verify release behavior;
3. trigger buttons inside ordinary Frame and SoloFrame layouts if present;
4. verify a button whose caption contains spaces, for example `blue speed`;
5. reload/switch the QLC+ project and verify rediscovery before the next action;
6. restart QLC+ and verify the first post-reconnect action uses the fresh inventory.

The Raspberry Pi / LiveStageAssistant STDIO validation already confirmed exact captions containing spaces such as `blue speed`.

## Milestone 3 — Native-Only Cleanup

Status: **complete on `main`**

The cleanup removed migration-era contradictions and legacy runtime code. The cleanup PR was merged on 18 August 2026 and subsequent `main` CI passed on Node 20.20 and Node 22.

Implemented:

- remove OSC runtime module;
- remove static widget resolver and `config/widgets.json` runtime mapping;
- remove obsolete QXW-to-OSC generator/parser;
- remove OSC/DMX runtime types and tests;
- remove OSC Docker UDP exposure and config volume;
- make Docker native-only;
- make Raspberry Pi service configuration native-only;
- stop tracking machine-specific `config/.env`;
- stop tracking generated `dist/`;
- add `.env`, `config/.env`, `dist/` and `.DS_Store` ignore rules;
- fix `QLC_NATIVE_ENABLED` default handling;
- bind HTTP to loopback by default;
- require a token when bearer auth is selected;
- prevent bearer token exposure through `/health`, generated agent config or logs;
- replace the stale OSC HTTP admin form with read-only native status;
- bound HTTP JSON request bodies;
- preserve spaces/punctuation/accents/separators in exact widget identity;
- resolve `MCP_PROMPT_FILE` after runtime env loading;
- add GitHub Actions build/test CI on Node 20.20 and 22;
- add the repository MIT `LICENSE` file;
- align README, ARCHITECTURE, ROADMAP, AGENTS and PROMPT with native-only behavior;
- terminate native resources cleanly when a STDIO parent disconnects.

### Validation status

Automated validation is enforced by GitHub Actions:

```text
npm ci
npm run build
npm run test:ci
```

The production usage path through LiveStageAssistant STDIO was validated on Raspberry Pi after the cleanup, including native button execution with captions containing spaces.

The optional systemd/HTTP service-pack path remains available for deployments that need it, but it is not required when LiveStageAssistant launches QLCPlus-MCP directly over STDIO.

## Milestone 4 — Project And Session Safety Hardening

Status: **implemented**

Purpose: guarantee that a button can never be executed from an inventory that belongs to a project or native connection which has already been superseded.

Implemented:

- bind incoming frames to the exact socket that delivered them;
- ignore stale data/errors from obsolete sockets after reconnect;
- invalidate the current inventory immediately when a replacement project transfer starts;
- leave `ready` and enter `downloading-project` before accepting commands against the replacement project;
- clear the current inventory timestamp during invalidation;
- use a project-transfer generation counter so an older asynchronous XML parse cannot overwrite a newer transfer on the same socket;
- invalidate the generation on disconnect/stop;
- detach completed project bytes from transfer state before asynchronous parsing;
- add regression tests for project reload, stale socket parsing and overlapping project generations;
- replace the former source-text-only STDIO cleanup check with a direct behavioral cleanup test while retaining signal wiring coverage.

This hardening does not change caption identity. Names such as `blue speed` remain supported exactly as before.

## Future Native-Only Work

Candidates after the native button-control release is stable:

- native slider control with a deliberately designed MCP schema;
- richer inventory search that never changes execution identity rules;
- native connection telemetry/metrics;
- additional protocol compatibility fixtures for future QLC+ versions;
- authorization automation only if QLC+ provides an explicit secure supported mechanism;
- optional release packaging/artifacts after CI proves reproducible builds.

Not planned unless the product decision changes explicitly:

- OSC fallback;
- QLC+ 4 support;
- WebSocket or `/vc.json` fallback;
- raw unrestricted native action tools;
- fuzzy execution matching;
- direct native DMX control.


## Milestone 5 — Deterministic Local Command Gateway

Status: **OR4B1 implementation, automated CI, and LiveStageAssistant/Pi exact-button live write acceptance validated**

Purpose: add a fast Local-engine-only natural-command path without changing the existing cloud/LLM MCP contract.

Product boundary:

- existing `qlc_get_state`, `qlc_list_widgets`, `qlc_button_press`, `PROMPT.md` and native QLC+ behavior remain unchanged for ordinary MCP/cloud clients;
- the Local deterministic gateway is disabled by default and is registered only when explicitly enabled for a dedicated Local LiveStageAssistant session/instance;
- no LLM, embedding model or inference service is added to QLCPlus-MCP;
- consume the planned versioned `@infrafast/stage-command-core` library and pin an exact compatible version/commit.

### 5A — Shared gateway contract

- [x] register reserved `lsa_local_analyze_command` / `lsa_local_execute_command` only when Local gateway enablement is active;
- [x] implement `lsa-command-gateway/v1` using pinned `@infrafast/stage-command-core` commit `d64b4c4b4f3f45502519024dc90d957c98b6fee9`;
- [x] analysis is read-only and may inspect connection state/current inventory;
- [x] execution uses a short-lived opaque one-shot plan token;
- [ ] return deterministic localized `responseText`;
- [x] classify list/state requests as reads and button presses as writes;
- [ ] incompatible protocol/core versions fail closed.

### 5B — QLC local deterministic grammar

- [x] recognize Local state/list commands;
- [x] recognize explicit QLC button commands while preserving the raw caption text;
- [ ] command-prefix normalization must never alter the execution caption;
- [x] exact caption authorization remains **case-insensitive only**;
- [ ] spaces, accents, punctuation, underscores and hyphens remain significant;
- [ ] no fuzzy, substring, semantic or separator-normalized result may authorize execution;
- [ ] no-match/ambiguous discovery returns deterministic clarification or suggestions, never a write plan.

### 5C — Project/inventory generation safety

- [x] bind each executable plan to the current project/inventory generation;
- [ ] project transfer/reconnect/inventory replacement invalidates outstanding plans;
- [x] execution of a stale token returns a deterministic stale-plan error and performs no button action;
- [ ] preserve existing `ready` state requirement and current stale-socket/project safety guarantees.

### 5D — Regression corpus

- [ ] exact caption with spaces;
- [ ] case-only variant;
- [x] accent mismatch;
- [x] underscore/hyphen mismatch;
- [ ] list-all and filtered discovery;
- [ ] not-ready state;
- [x] project generation change between analyze and execute;
- [x] duplicate write execution is rejected;
- [ ] explicit token-expiry timing test;
- [x] gateway-disabled tool inventory remains identical to ordinary/cloud MCP behavior.

### 5E — LiveStageAssistant Local acceptance

- [x] STDIO Local integration first;
- [x] list controls;
- [x] exact Toggle button;
- [ ] Flash button;
- [ ] clarification/no-match path;
- [ ] project reload between commands;
- [ ] target deterministic gateway overhead <100 ms typical on Pi5 excluding QLC+ native action;
- [ ] verify no LLM process or inference dependency is started.


## Cross-repository OR4 status

QLCPlus-MCP OR4B1 and XMSeries-MCP OR4B2 are both merged and CI-validated. XMSeries OR4B2 is on `main` as `0256b3d66dcdf6594f25e8aa0b6fe7ecec07bfed`, using the same `lsa-command-gateway/v1` contract and a pinned StageCommandCore dependency. LiveStageAssistant/Pi end-to-end acceptance remains a later cross-repository gate.


## Cross-repository OR4B3 status

LiveStageAssistant OR4B3 is now in implementation on `or4b3-deterministic-local-engine`: the Local runtime no longer routes conceptually through an LLM planner and is being wired to the generic `lsa-command-gateway/v1` contract used by QLCPlus OR4B1 and XMSeries OR4B2. Automated CI and Pi acceptance remain pending.


## OR4C pin alignment

QLCPlus-MCP and XMSeries-MCP now target the same validated StageCommandCore commit: `fa9f8baef06a668efb18b1bfc50060335689f287`. QLCPlus-MCP PR #8 merged as `b46f0c5d9aa859281976bec48090dd9a8f0bfffe`; PR and post-merge Node 20.20/22 CI are green. The wire protocol remains `lsa-command-gateway/v1`.


## OR4C live acceptance readiness

LiveStageAssistant now includes the domain-neutral Raspberry Pi/rack acceptance harness, merged into `realtime-voice-architecture` as `63019ba4089b7b9c6d06ac5b307914fca8645a5e`. PR and post-merge Python 3.11/3.12 CI are green. The harness exercises `lsa-command-gateway/v1`, records per-command latency evidence, blocks live writes unless explicitly enabled, and checks for newly spawned known local-LLM processes. Real Raspberry Pi/rack read-path acceptance was completed on 18 September 2026. LiveStageAssistant discovered the QLCPlus gateway under `lsa-command-gateway/v1`; QLC state and inventory reads executed successfully, and the exact `qlc wave` command produced a ready/write plan without execution because `--allow-writes` was intentionally omitted. The complete 4-case cross-repo corpus passed with analysis p50 3.0 ms / p95 6.4 ms and total p50 5.9 ms / p95 11.7 ms. A second Pi run with `--allow-writes` executed the exact `qlc wave` write plan; the harness reported `PASS ready/write ... executed`, and the operator confirmed that the `wave` Virtual Console button was physically pressed. That live-write run measured analysis p50 2.9 ms / p95 6.6 ms and total p50 6.4 ms / p95 12.3 ms. Flash-button, clarification/no-match, and project-reload acceptance remain pending. Cross-repository note: XMSeries-MCP OR4B4 advanced Local semantics (percent, channel->bus, ramps/fades and delayed level actions) merged as `968c94f69d4bd007191fff1762101707a94c70b5`; this does not change QLCPlus-MCP behavior or its exact-caption safety policy.
