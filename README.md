# qlc_diakonia

Monorepo do ecossistema QLC+ da Diakonia.

| Pasta | Conteúdo |
|-------|----------|
| [`qlcplus/`](qlcplus) | Fork do [QLC+](https://github.com/mcallegari/qlcplus) com as extensões **Cockpit API** (`webaccess/`, usada pelo app) e **Native API** (`qmlui/tardis/`, usada pelo MCP) |
| [`mcp/`](mcp) | Fork do [QLCPlus-MCP](https://github.com/infrafast/QLCPlus-MCP) (servidor MCP em Node/TypeScript) |
| [`app/`](app) | QLC+ Cockpit — controlador Android nativo para tablet |
| [`shows/`](shows) | Workspaces `.qxw` de teste/palco |

## Build

- **qlcplus**: ver `qlcplus/README.md` (CMake, Qt). Detalhes da Cockpit API em `qlcplus/COCKPIT_API.md`.
- **mcp**: `cd mcp && npm ci && npm run build && npm test`
- **app**: `cd app && ./gradlew assembleDebug`

> Os workflows em `qlcplus/.github` e `mcp/.github` vieram dos projetos originais e não são executados pelo GitHub a partir de subpastas.

## Sincronizar com os upstreams

`qlcplus/` e `mcp/` foram importados com `git subtree`:

```sh
# QLC+ (importado como snapshot squash do upstream b3e82d5)
git subtree pull --prefix=qlcplus https://github.com/mcallegari/qlcplus.git master --squash

# QLCPlus-MCP (histórico completo)
git subtree pull --prefix=mcp https://github.com/infrafast/QLCPlus-MCP.git main
```
