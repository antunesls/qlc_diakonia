# qlc_diakonia

Monorepo do ecossistema QLC+ da Diakonia.

| Pasta | Conteúdo |
|-------|----------|
| [`qlcplus/`](qlcplus) | Fork do [QLC+](https://github.com/mcallegari/qlcplus) com as extensões **Cockpit API** (`webaccess/`, usada pelo app) e **Native API** (`qmlui/tardis/`, usada pelo MCP) |
| [`mcp/`](mcp) | Fork do [QLCPlus-MCP](https://github.com/infrafast/QLCPlus-MCP) (servidor MCP em Node/TypeScript) |
| [`app/`](app) | QLC+ Cockpit — controlador Android nativo para tablet |
| [`shows/`](shows) | Workspaces `.qxw` de teste/palco |

## Compilar, executar e gerar release

Tudo pelo script interativo `diakonia.sh`. Abra pelo Git Bash (`./diakonia.sh`) ou com duplo clique em `diakonia.cmd`.

```
Menu principal
  1) Compilar         QLC+ | MCP | App debug | App release | Todos
  2) Executar         QLC+ (Web Access/servidor nativo/show) | MCP | App no tablet via adb
  3) Gerar release    versão -> build -> dist/vX/ -> tag -> release no GitHub
  4) Testes do MCP
  5) Verificar ambiente
  6) Limpar builds
```

Também funciona sem menu: `./diakonia.sh build all`, `./diakonia.sh run qlcplus`, `./diakonia.sh release`, `./diakonia.sh doctor`.

| Componente | Saída do build | Release (`dist/vX/`) |
|------------|----------------|----------------------|
| QLC+ | `C:\qlcplus\qlcplus5.exe` (o CMake do QLC+ instala sempre aí) | `QLCplus-diakonia-X-setup.exe` + `...-win64-portable.zip` |
| MCP | `mcp/dist/src/index.js` | `qlcplus-mcp-X.zip` (no destino: `npm ci --omit=dev`) |
| App | `app/app/build/outputs/apk/<debug\|release>/` | `qlc-cockpit-X.apk` |

Pré-requisitos (o item 5 do menu confere todos):
- **MSYS2 UCRT64** com `cmake`, `ninja`, `qt6` e, para o instalador, `nsis`.
- **Node.js**.
- **JDK 17–21**, detectado em `~/.jdks`, no `jbr` do Android Studio ou pela variável `QLC_JDK`.
- **Android SDK** com `adb`.

Detalhes da Cockpit API em `qlcplus/COCKPIT_API.md`.

> Os workflows em `qlcplus/.github` e `mcp/.github` vieram dos projetos originais e não são executados pelo GitHub a partir de subpastas.

## Sincronizar com os upstreams

`qlcplus/` e `mcp/` foram importados com `git subtree`:

```sh
# QLC+ (importado como snapshot squash do upstream b3e82d5)
git subtree pull --prefix=qlcplus https://github.com/mcallegari/qlcplus.git master --squash

# QLCPlus-MCP (histórico completo)
git subtree pull --prefix=mcp https://github.com/infrafast/QLCPlus-MCP.git main
```
