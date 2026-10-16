# QLC+ Cockpit (Android)

App Android nativo (Kotlin + Jetpack Compose) para controlar o **QLC+ 5** de um tablet de 10" na horizontal.
Ele conversa com a Web Access do QLC+ (WebSocket `ws://<pc>:9999/qlcplusWS` + HTTP).

## Telas

| Tela | O que faz |
|---|---|
| **Funções** | Grade com todas as Scenes, Chasers, Sequences, Shows, EFX, RGB Matrix, Collections, Scripts e Audio. Toque executa ou para; toque longo abre intensidade, pausa e "Abrir no Player". Filtros por tipo, pasta, busca e "Ativas". |
| **Player** | Shows: play/pause/stop, tempo, seek e linha do tempo das tracks. Chasers/Sequences: lista de steps com o step atual, GO/anterior/pausa, toque no step para pular, intensidade. |
| **Fixtures** | Lista de fixtures (filtro por grupo, seleção múltipla). Faders por canal coloridos por tipo, seletor de cor RGB/CMY, XY pad de Pan/Tilt (16 bits), funções (capabilities) do canal com um toque, Localizar e Liberar. |
| **Mesa DMX** | Os 512 canais de cada universo, nomeados pelo fixture. Toque duplo devolve o canal às funções. Resetar universo. |
| **Console** | Espelha o Virtual Console do QLC+ (`/vc.json`): botões (toggle/flash), sliders, cue lists, frames com páginas, XY pad, speed dial, relógio, animation e audio triggers. |
| **Conexão** | IP/porta/usuário, busca automática na rede Wi-Fi, servidores recentes, auto-conexão, tema de palco (vermelho). |

Barra fixa no topo: estado da conexão e latência, **Grand Master**, **Blackout** e **Parar tudo**.

## Servidor: QLC+ com a API Cockpit

O QLC+ oficial não expõe fixtures, steps nem push de DMX. Por isso existe o fork em
`../qlcplus` deste monorepo, que adiciona `/api/*.json` e comandos WebSocket extras.
Veja `../qlcplus/COCKPIT_API.md`.

- Com o fork, o app detecta a API (`getApiVersion` → `cockpit-1`) e libera tudo.
- Com o QLC+ 5 oficial, o app entra em **modo compatível**: Funções, Console e Mesa DMX (por polling) continuam funcionando; Fixtures, steps, seek e blackout ficam indisponíveis.

Inicie o QLC+ no PC com a Web Access ligada:

```
qlcplus-qml -w          # sem senha
qlcplus-qml -wa         # com usuários/senha da Web Access
```

Tablet e PC precisam estar na mesma rede. Libere a porta TCP 9999 no firewall do Windows.

## Build

Requisitos: JDK 17+ (testado com o 21) e Android SDK 35 (`local.properties` com `sdk.dir`).

```
./gradlew testDebugUnitTest      # protocolo, conexão (WebSocket fake), modelos e screenshots das telas
./gradlew assembleDebug          # app/build/outputs/apk/debug/app-debug.apk
./gradlew assembleRelease        # APK minificado (assinado com a chave debug; troque para distribuir)
adb install -r app/build/outputs/apk/release/app-release.apk
```

Os screenshots gerados pelos testes (Robolectric/Roborazzi, 1920x1200) ficam em `app/build/outputs/roborazzi/`.

## Estrutura

```
net/       QlcProtocol (parser/serializador do protocolo "|"), QlcConnection (WebSocket com
           reconexão, coalescência de faders a 25 ms, request/response), QlcHttpApi, ServerScanner
model/     modelos da API Cockpit e do /vc.json
data/      CockpitRepository (estado único + ações), UniverseStore (valores DMX), SettingsStore
ui/        CockpitApp (navegação + barra global), screens/*, components/ (faders multitoque, XY pad, cor)
```
