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
- **MSYS2 UCRT64** com `cmake`, `ninja`, `qt6`, `assimp` (sem ele a visão 3D fica vazia) e, para o instalador, `nsis`.
- **D2XX SDK** da FTDI em `C:\projects\D2XXSDK` para adaptadores DMX USB FTDI. O plugin usa o driver padrão da FTDI, o mesmo do QLC+ oficial e do FreeStyler, sem Zadig. Na build Insider 26300 do Windows o D2XX derruba o sistema (tela azul): nesse PC compile com `-DDMXUSB_D2XX=OFF` (usa libFTDI, `mingw-w64-ucrt-x86_64-libftdi`) e troque o driver do adaptador para WinUSB com o [Zadig](https://zadig.akeo.ie/).
- **Node.js**.
- **JDK 17–21**, detectado em `~/.jdks`, no `jbr` do Android Studio ou pela variável `QLC_JDK`.
- **Android SDK** com `adb`.

Detalhes da Cockpit API em `qlcplus/COCKPIT_API.md`.

## Comandos UDP

Servidor e cliente: `qlcplus5.exe -w -s --server-allow-all -o igreja.qxw` sobe o Web Access (9999) e o servidor nativo (9998) já com os clientes autorizados; `qlcplus5.exe --connect <ip-do-servidor>` inicia como cliente desse servidor, recebe o projeto dele e tenta reconectar a cada 10 s se a conexão cair (não combine com `-o`, `-s` nem `-w`). `-platform offscreen` roda sem janela.

O QLC+ do fork aceita comandos em texto por UDP (porta padrão 7799), vindos de qualquer aparelho da rede. Configure em **menu → Rede → Comandos UDP**: liga/desliga, porta, tabela "comando recebido → ação" (salva no `.qxw`), teste e log ao vivo. Também dá para ligar só nesta execução com `--udp-commands [--udp-port N]` (o `diakonia.sh run qlcplus` pergunta).

Cada linha recebida é respondida ao remetente com `OK …` ou `ERR …`. Primeiro vale a tabela da tela; um comando de slider aceita o valor no fim (`volume 50%`). Com "Comandos diretos" ligado também valem, pelo nome completo (maiúsculas não importam) ou ID:

```
start|stop|toggle|status <função>      blackout on|off|toggle
button|press|release <botão do VC>     stopall
slider <slider> <0-255|N%>             list functions|buttons|sliders|cuelists
cuelist <cue list> play|stop|next|prev ping | help
```

Teste rápido no PowerShell:

```powershell
$u = New-Object Net.Sockets.UdpClient; $b = [Text.Encoding]::UTF8.GetBytes("blackout toggle"); $u.Send($b, $b.Length, "127.0.0.1", 7799)
```

Não há senha: use só em rede confiável.

> Os workflows em `qlcplus/.github` e `mcp/.github` vieram dos projetos originais e não são executados pelo GitHub a partir de subpastas.

## Sincronizar com os upstreams

`qlcplus/` e `mcp/` foram importados com `git subtree`:

```sh
# QLC+ (importado como snapshot squash do upstream b3e82d5)
git subtree pull --prefix=qlcplus https://github.com/mcallegari/qlcplus.git master --squash

# QLCPlus-MCP (histórico completo)
git subtree pull --prefix=mcp https://github.com/infrafast/QLCPlus-MCP.git main
```
