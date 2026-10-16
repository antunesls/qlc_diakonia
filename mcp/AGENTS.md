# Agent Instructions

This file guides Codex and other automation agents working in this repository.

## Product Direction

QLCPlus-MCP is a QLC+ 5 **native-protocol-only** MCP server.

Do not add or restore OSC, WebSocket, `/vc.json`, QLC+ 4 compatibility, static `widgets.json` runtime mappings, raw DMX paths, or transport fallbacks unless the repository owner explicitly changes this product decision.

The supported control path is:

```text
MCP client
  -> QLCPlus-MCP tools
  -> QLC+ 5 native client
  -> active-project inventory
  -> validated native Virtual Console actions
```

## Documentation Placement

Keep documentation non-redundant and consistent.

- [README.md](README.md): user-facing purpose, installation, quick start, deployment and common operation.
- [ARCHITECTURE.md](ARCHITECTURE.md): implementation details, native protocol lifecycle, transports, security and validation.
- [ROADMAP.md](ROADMAP.md): completed migration history, acceptance gates and future native-only work.
- [PROMPT.md](PROMPT.md): runtime instructions for an AI agent using this MCP server.
- [AGENTS.md](AGENTS.md): repository-maintenance rules for coding agents.

Do not recreate `docs/`, `QUICKSTART.md`, `PROJECT-SUMMARY.md`, or parallel documentation unless explicitly requested.

## Prompt Policy vs Tool Contract Boundary

Treat prompt policy, MCP contracts and deterministic runtime enforcement as three different layers. Do not blur them.

### `PROMPT.md` is the runtime-agent policy source of truth

Rules that tell the LLM **how to behave** belong in `PROMPT.md`. Examples include:

- when to call a tool;
- whether to call one tool before another;
- whether a complete exact caption needs confirmation;
- whether discovery/listing is required before execution;
- what to do after an exact-match failure;
- how the assistant should phrase a successful response;
- routing or fallback policy between exposed MCP tools.

Do not duplicate those behavioral rules in TypeScript tool descriptions, Zod field descriptions, error strings, comments or other runtime code merely to influence the model. In particular, avoid policy wording such as `immediately`, `without confirmation`, `ask the user`, `call X first`, `call X next`, or required assistant response phrasing in tool metadata unless it is literally part of the technical operation being described.

When runtime-agent behavior changes, update `PROMPT.md` first and test that policy through prompt-focused tests.

### Tool and schema descriptions define only the technical MCP contract

Tool descriptions and input-schema descriptions are visible to the model, so keep them precise, minimal and declarative. They may document:

- what technical operation the tool performs;
- accepted inputs and their exact semantics;
- identifier/matching rules enforced by the server;
- supported widget kinds;
- value/range constraints;
- session-scoped identifiers;
- deprecated or unsupported compatibility fields;
- technical preconditions such as native `ready` state when relevant to the contract.

They must not become a second prompt or a shadow copy of `PROMPT.md`.

### Code enforces safety and invariants deterministically

Anything that must remain true even if the LLM ignores its prompt belongs in code and tests. Examples include:

- exact caption lookup;
- case-only matching rules;
- preserving internal spaces such as `blue speed`;
- rejecting sliders in a button-only tool;
- refusing actions unless the native session is `ready`;
- refusing nonexistent captions instead of guessing;
- protocol framing, size limits and secret handling.

Never rely on prompt text or tool descriptions as the only enforcement mechanism for a safety or correctness invariant.

### Review checklist for coding agents

Before merging any change that touches prompts, tools or schemas:

1. Classify each new sentence as **agent policy**, **technical MCP contract**, or **deterministic runtime invariant**.
2. Put agent policy only in `PROMPT.md`.
3. Put technical contract text only in tool/schema descriptions.
4. Put mandatory correctness and safety guarantees in executable code.
5. Keep tests separated by layer: prompt-policy tests must not depend on tool-description wording, and tool-contract tests must not require behavioral policy text.
6. Search changed tool/schema descriptions for accidental policy duplication before finishing the change.
7. Do not put runtime-agent instructions in `AGENTS.md`; this file instructs coding agents only.

## Development Rules

### Capability symmetry: MCP tools and deterministic Local parser

Every new end-user QLC capability must be implemented and documented symmetrically across both supported interaction surfaces:

1. the normal typed MCP tool surface used by LLM/cloud agents;
2. the deterministic Local parser exposed through `lsa_local_analyze_command` / `lsa_local_execute_command`.

A capability is not complete and must not be merged as finished until all applicable parts are present:

- add or extend the normal typed MCP tool contract;
- add the equivalent deterministic Local parsing/planning/execution path;
- factor both surfaces through the same native inventory/business/action implementation rather than duplicating QLC behavior;
- add/update tests for both the tool contract and Local parser semantics;
- update `README.md` with canonical deterministic phrases users can speak/type and any exact-name/matching constraints;
- update `PROMPT.md` whenever the cloud/LLM agent requires new behavior or tool-routing guidance;
- preserve exact-caption identity, native `ready` gating, one-shot plans, inventory-generation stale checks and fail-closed ambiguity behavior.

The rule is bidirectional: a Local-only business capability or a tool-only business capability is an incomplete implementation. Only an explicit repository-owner decision may scope a feature out of one surface; such an exception must be stated in both `README.md` and `ROADMAP.md`.


- Read the existing code and docs before changing behavior.
- Keep changes scoped and add/update tests for behavior changes.
- Preserve MCP tool names and schemas unless a deliberate compatibility change is requested.
- Keep QLC+ numeric widget IDs session-only; never persist them as stable identifiers.
- Treat native state `ready` as the only state in which a live action may be sent.
- Invalidate the inventory on disconnect and require a fresh project transfer before returning to `ready`.
- Keep framing, decrypted payload, project and inventory sizes bounded.
- Do not expose native encryption keys, HTTP bearer tokens, or other secrets in health/status responses or logs.
- Default HTTP binding to loopback. Network exposure must be an explicit deployment choice; bearer authentication is strongly recommended for non-loopback HTTP.
- Run `npm run build` and `npm run test:ci` after code changes when feasible.
- Keep GitHub Actions green before merging.

## Widget Caption Rules

Live button execution uses one complete QLC+ caption and ignores **case only**.

Internal spaces, accents, punctuation, underscores and hyphens are significant. Examples:

```text
Blue Speed  == blue speed
blue speed  != blue_speed
blue speed  != bluespeed
```

Do not normalize separators or accents for execution. Do not use substring, prefix, semantic, closest or fuzzy matching to authorize a live command.

Loose normalization may exist only as diagnostic/search metadata and must not determine command identity or collision handling.

## Agent Command Routing

For a user command that supplies a complete QLC+ caption, the runtime agent must use a verify-then-execute flow against the current native inventory:

1. call `qlc_list_widgets` with the requested complete caption;
2. compare returned button captions using the execution identity rule (case-insensitive only; spaces, accents, punctuation, `_` and `-` significant);
3. if exactly one returned button is an exact match, call `qlc_button_press` immediately with that caption and do not ask the user for confirmation;
4. if there is no exact button match, do not execute any alternative or approximate result.

`qlc_list_widgets` search output is discovery data, not execution authorization by itself. Substring, prefix, fuzzy, semantic or separator-normalized matches must never be promoted to a live action.

This section documents the current product policy for maintainers. The executable runtime-agent version of this policy must remain in `PROMPT.md`; do not copy this wording into tool descriptions.

## Native Compatibility Boundary

The implementation currently requires QLC+ native protocol behavior compatible with upstream commit `984f0e7`, including grouped Virtual Console action codes such as `VCButtonSetPressed = 0xF200`.

The Linux localhost client may bind a per-process address in `127.0.0.0/8` so concurrent native clients have distinct QLC+ source identities. Do not replace this with LAN exposure as a workaround.

SimpleCrypt is protocol compatibility, not modern transport security. Keep the QLC+ native endpoint on localhost or a trusted show network.
