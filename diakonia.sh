#!/usr/bin/env bash
#
# diakonia.sh - compila, executa e gera releases do monorepo qlc_diakonia
#
#   ./diakonia.sh                      menu interativo
#   ./diakonia.sh build  [qlcplus|mcp|app|app-release|all]
#   ./diakonia.sh run    [qlcplus|mcp|app]
#   ./diakonia.sh release
#   ./diakonia.sh doctor
#
# Roda no Git Bash (ou no próprio MSYS2). As etapas do QLC+ são executadas
# dentro do MSYS2 UCRT64, onde estão o Qt6, o CMake e o Ninja.
#
# Variáveis que podem ser sobrescritas:
#   MSYS2_ROOT   (padrão /c/msys64)
#   ANDROID_SDK  (padrão $ANDROID_HOME ou ~/AppData/Local/Android/Sdk)
#   QLC_JDK      JDK 17-21 usado pelo Gradle (detectado automaticamente)

set -uo pipefail

SELF="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"
ROOT="$(dirname "$SELF")"
QLC_SRC="$ROOT/qlcplus"
MCP_DIR="$ROOT/mcp"
APP_DIR="$ROOT/app"
SHOWS_DIR="$ROOT/shows"
DIST_DIR="$ROOT/dist"
LOG_DIR="$ROOT/logs"

MSYS2_ROOT="${MSYS2_ROOT:-/c/msys64}"
# Fixo no CMake do QLC+ (variables.cmake: INSTALLROOT = $SystemDrive/qlcplus)
QLC_INSTALL="/c/qlcplus"
QLC_EXE="$QLC_INSTALL/qlcplus5.exe"
# libFTDI do MSYS2: backend do plugin DMX USB para adaptadores FTDI
LIBFTDI_PC="$MSYS2_ROOT/ucrt64/lib/pkgconfig/libftdi1.pc"
ANDROID_SDK="${ANDROID_SDK:-${ANDROID_HOME:-$HOME/AppData/Local/Android/Sdk}}"
ADB="$ANDROID_SDK/platform-tools/adb.exe"
APP_ID="com.diakonia.qlccockpit"
APP_GRADLE="$APP_DIR/app/build.gradle.kts"

# ---------------------------------------------------------------- helpers

if [[ -t 1 ]]; then
    C_B=$'\e[1m'; C_G=$'\e[32m'; C_Y=$'\e[33m'; C_R=$'\e[31m'; C_C=$'\e[36m'; C_0=$'\e[0m'
else
    C_B=; C_G=; C_Y=; C_R=; C_C=; C_0=
fi

step() { echo; echo "${C_C}${C_B}==> $*${C_0}"; }
ok()   { echo "${C_G}✔ $*${C_0}"; }
warn() { echo "${C_Y}! $*${C_0}"; }
die()  { echo "${C_R}✘ $*${C_0}" >&2; exit 1; }

# ask "Pergunta" "padrão" -> imprime a resposta
ask() {
    local reply
    read -r -p "$1${2:+ [$2]}: " reply
    echo "${reply:-${2:-}}"
}

# confirm "Pergunta" s|n
confirm() {
    local def="${2:-s}" reply hint="[S/n]"
    [[ "$def" == n ]] && hint="[s/N]"
    read -r -p "$1 $hint " reply
    reply="${reply:-$def}"
    [[ "$reply" =~ ^[sSyY] ]]
}

pause() { read -r -p "Enter para continuar..." _; }

# Roda uma ação em subshell com 'set -e': um erro volta ao menu sem fechar o script
attempt() {
    ( set -e; "$@" )
    local rc=$?
    if (( rc != 0 )); then warn "Falhou: $* (código $rc)"; fi
    return $rc
}

# Impede dois builds simultâneos do mesmo projeto (ninja/gradle travam os arquivos)
# Chamar dentro de 'attempt' (subshell): o trap libera a trava ao sair.
HELD_LOCKS=()
release_locks() { local d; for d in "${HELD_LOCKS[@]}"; do rm -rf "$d"; done; }
lock() {
    local dir="$ROOT/.locks/$1" d
    for d in "${HELD_LOCKS[@]}"; do [[ "$d" == "$dir" ]] && return 0; done
    mkdir -p "$ROOT/.locks"
    if ! mkdir "$dir" 2>/dev/null; then
        die "Já existe um build de '$1' em andamento (se não houver, apague $dir)"
    fi
    HELD_LOCKS+=("$dir")
    trap release_locks EXIT
}

in_ucrt64() { [[ "${MSYSTEM:-}" == UCRT64 ]]; }

# Executa uma função interna deste script dentro do MSYS2 UCRT64
msys() {
    if in_ucrt64; then
        "$@"
    else
        [[ -x "$MSYS2_ROOT/usr/bin/bash.exe" ]] || die "MSYS2 não encontrado em $MSYS2_ROOT"
        MSYSTEM=UCRT64 CHERE_INVOKING=1 MSYS2_PATH_TYPE=minimal MSYS2_ARG_CONV_EXCL='*' \
            "$MSYS2_ROOT/usr/bin/bash.exe" -lc "'$SELF' __msys $*"
    fi
}

find_jdk() {
    local c
    for c in "${QLC_JDK:-}" \
             "/c/Program Files/Android/Android Studio/jbr" \
             "$HOME"/.jdks/jdk-21* "$HOME"/.jdks/jdk-17* \
             "/c/Program Files/Eclipse Adoptium"/jdk-21* "/c/Program Files/Eclipse Adoptium"/jdk-17* \
             "/c/Program Files/Java"/jdk-21* "/c/Program Files/Java"/jdk-17*; do
        [[ -n "$c" && -x "$c/bin/javac.exe" ]] && { echo "$c"; return 0; }
    done
    return 1
}

qlc_version() { sed -n 's/^ *set(APPVERSION "\(5[^"]*\)").*/\1/p' "$QLC_SRC/variables.cmake" | head -1; }
app_version() { sed -n 's/.*versionName = "\([^"]*\)".*/\1/p' "$APP_GRADLE"; }
app_version_code() { sed -n 's/.*versionCode = \([0-9]*\).*/\1/p' "$APP_GRADLE"; }

github_repo() {
    git -C "$ROOT" remote get-url origin 2>/dev/null \
        | sed -E 's#^(https://github.com/|git@github.com:)##; s#\.git$##'
}

# --------------------------------------------- funções internas (UCRT64)

_qlc_build() {
    cd "$QLC_SRC"
    cmake -S . -B build -G Ninja -DCMAKE_BUILD_TYPE=Release -Dqmlui=ON
    ninja -C build
}

_qlc_install() {
    ninja -C "$QLC_SRC/build" install
}

# Deixa C:\qlcplus autossuficiente (roda sem o MSYS2 no PATH)
_qlc_deploy() {
    cd "$QLC_INSTALL"
    windeployqt6 --qmldir "$QLC_SRC/qmlui/qml" qlcplusengine.dll Plugins/dmxusb.dll qlcplus5.exe
    # Sem isto o Qt do MSYS2 procura os módulos QML em share/qt6/qml e a interface não carrega
    printf '[Paths]\nPrefix = .\nPlugins = .\nQmlImports = qml\n' > qt.conf
    rm -f sceneparsers/gltfsceneexport.dll
    rm -rf generic networkinformation qmltooling renderplugins tls
    # Dependências do MSYS2 (ICU, libusb, fftw, ...) que o windeployqt não copia
    find . -iname '*.exe' -o -iname '*.dll' \
        | xargs ldd 2>/dev/null \
        | awk '$3 ~ /\/ucrt64\// {print $3}' | sort -u \
        | while read -r dll; do cp -n "$dll" . ; done
}

_qlc_installer() {
    local ver="$1" out="$2" nsi="qlcplus5-diakonia.nsi" exe="QLCplus-diakonia-$1-setup.exe"
    # Barras normais: com -w o sed leria \U, \a... do caminho como escapes
    local home; home=$(cygpath -m "$QLC_SRC")
    cd "$QLC_INSTALL"
    sed -e "s|^!define QLCPLUS_HOME .*|!define QLCPLUS_HOME \"$home\"|" \
        -e "s|^OutFile .*|OutFile \"$exe\"|" \
        qlcplus5Qt6.nsi > "$nsi"
    makensis -X'SetCompressor /FINAL lzma' "$nsi"
    rm -f "$nsi"
    mv "$exe" "$out/"
}

# libFTDI para o plugin DMX USB. Sem ela o plugin ignora adaptadores FTDI (a
# interface QtSerialPort os descarta) ou cai no D2XX, que derruba o Windows
# (bugcheck 0x139 no driver da FTDI). O adaptador precisa do driver WinUSB (Zadig).
_pacman_libftdi() { pacman -S --needed --noconfirm mingw-w64-ucrt-x86_64-libftdi; }

_has_makensis() { command -v makensis >/dev/null; }

_pacman_nsis() { pacman -S --needed --noconfirm mingw-w64-ucrt-x86_64-nsis; }

# ------------------------------------------------------------------ build

build_qlcplus() {
    lock qlcplus
    if tasklist //FI "IMAGENAME eq qlcplus5.exe" 2>/dev/null | grep -qi qlcplus5.exe; then
        warn "O QLC+ está aberto: a instalação em $QLC_INSTALL vai falhar ao sobrescrever os arquivos."
        confirm "Feche o QLC+ e confirme para continuar" s || return 1
    fi
    if [[ ! -f "$LIBFTDI_PC" ]]; then
        warn "libFTDI não instalada no MSYS2: sem ela adaptadores DMX USB FTDI não aparecem no QLC+."
        if confirm "Instalar agora com pacman?" s; then
            step "QLC+: instalando libFTDI"
            msys _pacman_libftdi
        fi
    fi
    step "QLC+: compilando (MSYS2 UCRT64, Release, qmlui)"
    msys _qlc_build
    step "QLC+: instalando em $QLC_INSTALL"
    msys _qlc_install
    step "QLC+: copiando Qt e DLLs (windeployqt)"
    msys _qlc_deploy
    ok "QLC+ pronto: $QLC_EXE"
}

build_mcp() {
    lock mcp
    step "MCP: dependências"
    cd "$MCP_DIR"
    if [[ ! -d node_modules || package-lock.json -nt node_modules ]]; then
        npm ci
    else
        echo "node_modules em dia"
    fi
    step "MCP: compilando TypeScript"
    npm run build
    ok "MCP pronto: $MCP_DIR/dist/src/index.js"
}

gradle() {
    local jdk
    jdk="$(find_jdk)" || die "JDK 17-21 não encontrado (defina QLC_JDK)"
    [[ -d "$ANDROID_SDK" ]] || die "Android SDK não encontrado em $ANDROID_SDK (defina ANDROID_SDK)"
    if [[ ! -f "$APP_DIR/local.properties" ]]; then
        echo "sdk.dir=$(cygpath -m "$ANDROID_SDK")" > "$APP_DIR/local.properties"
    fi
    echo "JDK: $jdk"
    cd "$APP_DIR"
    JAVA_HOME="$jdk" ./gradlew "$@"
}

build_app() {
    local type="${1:-debug}"
    lock app
    step "App: assemble ${type^}"
    gradle "assemble${type^}"
    ok "APK: $APP_DIR/app/build/outputs/apk/$type/app-$type.apk"
}

build_all() {
    build_qlcplus
    build_mcp
    build_app debug
}

# -------------------------------------------------------------------- run

run_qlcplus() {
    [[ -x "$QLC_EXE" ]] || die "QLC+ não instalado. Compile antes (menu Compilar > QLC+)."
    local args=() show
    confirm "Ligar Web Access (porta 9999, usada pelo app)?" s && args+=(-w)
    confirm "Ligar servidor nativo (porta 9998, usado pelo MCP)?" s && args+=(-s)
    if [[ " ${args[*]} " == *" -s "* ]]; then
        # Forma longa: builds antigos leem '-sa' como '-s -a' e fecham ("Missing value after '-sa'")
        confirm "Autorizar automaticamente qualquer cliente nativo (só em rede confiável)?" n && args+=(--server-allow-all)
    fi
    if confirm "Aceitar comandos UDP em texto (porta 7799, sem senha: só em rede confiável)?" n; then
        args+=(--udp-commands)
        local udp_port
        udp_port="$(ask "Porta UDP" 7799)"
        [[ "$udp_port" != 7799 ]] && args+=(--udp-port "$udp_port")
    fi

    local shows=("$SHOWS_DIR"/*.qxw)
    echo "Abrir qual show?"
    echo "  0) nenhum"
    echo "  1) o último usado"
    local i=2 f
    for f in "${shows[@]}"; do [[ -f "$f" ]] && echo "  $i) $(basename "$f")" && ((i++)); done
    show="$(ask "Opção" 0)"
    if [[ "$show" == 1 ]]; then
        args+=(-9)
    elif [[ "$show" =~ ^[0-9]+$ ]] && (( show >= 2 && show - 2 < ${#shows[@]} )); then
        args+=(-o "$(cygpath -w "${shows[show-2]}")")
    fi

    mkdir -p "$LOG_DIR"
    step "Iniciando QLC+ ${args[*]}"
    PATH="$MSYS2_ROOT/ucrt64/bin:$PATH" "$QLC_EXE" "${args[@]}" > "$LOG_DIR/qlcplus.log" 2>&1 &
    ok "QLC+ rodando (PID $!). Log: $LOG_DIR/qlcplus.log"
}

run_mcp() {
    cd "$MCP_DIR"
    [[ -f dist/src/index.js ]] || build_mcp
    cd "$MCP_DIR"
    if [[ ! -f .env ]]; then
        warn "mcp/.env não existe."
        confirm "Criar a partir do .env.example?" s && cp .env.example .env
    fi
    local transport
    transport="$(ask "Transporte (http/stdio)" http)"
    step "Iniciando MCP ($transport). Ctrl+C para parar."
    MCP_TRANSPORT="$transport" node dist/src/index.js
}

run_app() {
    [[ -x "$ADB" ]] || die "adb não encontrado em $ADB"
    "$ADB" start-server >/dev/null
    local devices
    devices="$("$ADB" devices | awk 'NR>1 && $2=="device" {print $1}')"
    if [[ -z "$devices" ]]; then
        warn "Nenhum dispositivo conectado."
        local addr
        addr="$(ask "IP:porta para 'adb connect' (vazio = cancelar)" "")"
        [[ -n "$addr" ]] || return 1
        "$ADB" connect "$addr"
    fi
    "$ADB" devices -l

    local type apk
    type="$(ask "Instalar qual APK (debug/release)" debug)"
    apk="$APP_DIR/app/build/outputs/apk/$type/app-$type.apk"
    if [[ ! -f "$apk" ]] || confirm "Recompilar o APK $type antes?" n; then
        build_app "$type"
    fi
    step "Instalando $apk"
    "$ADB" install -r "$apk"
    "$ADB" shell monkey -p "$APP_ID" -c android.intent.category.LAUNCHER 1 >/dev/null
    ok "App aberto no dispositivo"
}

# ---------------------------------------------------------------- release

release() {
    cd "$ROOT"
    local last ver tag out
    last="$(git describe --tags --abbrev=0 --match 'v*' 2>/dev/null || true)"
    echo "Última release: ${last:-nenhuma}"
    if [[ -n "$(git status --porcelain)" ]]; then
        git status --short
        confirm "Há alterações não commitadas. Continuar mesmo assim?" n || return 1
    fi

    ver="$(ask "Versão da release" "$(date +%Y.%m.%d)")"
    ver="${ver#v}"
    tag="v$ver"
    git rev-parse -q --verify "refs/tags/$tag" >/dev/null && die "A tag $tag já existe"

    local do_qlc=0 do_mcp=0 do_app=0
    confirm "Incluir QLC+ (instalador + zip portátil)?" s && do_qlc=1
    confirm "Incluir MCP (zip)?" s && do_mcp=1
    confirm "Incluir app Android (APK release)?" s && do_app=1
    (( do_qlc + do_mcp + do_app )) || die "Nada selecionado"

    if (( do_app )) && confirm "Atualizar a versão do app para $ver (versionCode $(app_version_code) -> $(( $(app_version_code) + 1 )))?" s; then
        sed -i -E "s/versionName = \"[^\"]*\"/versionName = \"$ver\"/; s/versionCode = [0-9]+/versionCode = $(( $(app_version_code) + 1 ))/" "$APP_GRADLE"
        git add "$APP_GRADLE"
        git commit -q -m "app: version $ver" && ok "Commit da versão do app criado"
    fi

    out="$DIST_DIR/$tag"
    rm -rf "$out"; mkdir -p "$out"

    if (( do_qlc )); then
        build_qlcplus
        if ! msys _has_makensis; then
            warn "makensis (NSIS) não está instalado no MSYS2."
            confirm "Instalar agora com pacman?" s && msys _pacman_nsis
        fi
        if msys _has_makensis; then
            step "QLC+: gerando instalador"
            msys _qlc_installer "$ver" "$out"
        else
            warn "Sem NSIS: só o zip portátil será gerado"
        fi
        step "QLC+: zip portátil"
        /c/Windows/System32/tar.exe -a -c -f "$out/QLCplus-diakonia-$ver-win64-portable.zip" -C "$QLC_INSTALL" .
    fi

    if (( do_mcp )); then
        build_mcp
        step "MCP: empacotando"
        local stage="$DIST_DIR/.mcp-stage/qlcplus-mcp"
        rm -rf "$DIST_DIR/.mcp-stage"; mkdir -p "$stage"
        cp -r "$MCP_DIR"/{dist,package.json,package-lock.json,PROMPT.md,.env.example,README.md,qlcplusmcp_raspi_service_pack} "$stage/"
        /c/Windows/System32/tar.exe -a -c -f "$out/qlcplus-mcp-$ver.zip" -C "$DIST_DIR/.mcp-stage" qlcplus-mcp
        rm -rf "$DIST_DIR/.mcp-stage"
    fi

    if (( do_app )); then
        build_app release
        cp "$APP_DIR/app/build/outputs/apk/release/app-release.apk" "$out/qlc-cockpit-$ver.apk"
    fi

    (cd "$out" && sha256sum * > SHA256SUMS.txt)
    step "Artefatos em $out"
    ls -lh "$out"

    confirm "Criar a tag $tag e enviar para o GitHub?" s || return 0
    git tag -a "$tag" -m "Release $tag"
    git push origin HEAD "$tag"
    ok "Tag $tag enviada"

    confirm "Publicar a release no GitHub com os artefatos?" s || return 0
    publish_github "$tag" "$last" "$out"
}

publish_github() {
    local tag="$1" last="$2" out="$3" repo notes
    repo="$(github_repo)"
    notes="$(git -C "$ROOT" log --pretty='- %s' ${last:+$last..}"$tag" | head -100)"

    if command -v gh >/dev/null; then
        gh release create "$tag" "$out"/* --repo "$repo" --title "$tag" --notes "$notes"
        ok "Release publicada"
        return
    fi

    # Sem gh: usa a API com o token salvo no Git Credential Manager
    local token resp id f
    token="$(printf 'protocol=https\nhost=github.com\n\n' | git credential fill 2>/dev/null | sed -n 's/^password=//p')"
    [[ -n "$token" ]] || die "Sem token do GitHub (instale o gh: winget install GitHub.cli)"

    resp="$(node -e 'console.log(JSON.stringify({tag_name:process.argv[1],name:process.argv[1],body:process.argv[2]}))' "$tag" "$notes" \
        | curl -sS -X POST -H "Authorization: Bearer $token" -H "Accept: application/vnd.github+json" \
               --data-binary @- "https://api.github.com/repos/$repo/releases")"
    id="$(node -e 'const r=JSON.parse(require("fs").readFileSync(0,"utf8"));if(!r.id){console.error(r.message);process.exit(1)}console.log(r.id)' <<<"$resp")" \
        || die "Falha ao criar a release"

    for f in "$out"/*; do
        echo "Enviando $(basename "$f")..."
        curl -sS -o /dev/null -w '  HTTP %{http_code}\n' -X POST \
             -H "Authorization: Bearer $token" -H "Content-Type: application/octet-stream" \
             --data-binary @"$f" \
             "https://uploads.github.com/repos/$repo/releases/$id/assets?name=$(basename "$f")"
    done
    ok "Release publicada: https://github.com/$repo/releases/tag/$tag"
}

# ----------------------------------------------------------------- outros

test_mcp() {
    cd "$MCP_DIR"
    [[ -d node_modules ]] || npm ci
    npm run test:ci
}

doctor() {
    local jdk
    check() { if eval "$2" >/dev/null 2>&1; then ok "$1"; else warn "$1: NÃO encontrado${3:+ ($3)}"; fi; }
    step "Ambiente"
    check "MSYS2 ($MSYS2_ROOT)"           "[[ -x '$MSYS2_ROOT/usr/bin/bash.exe' ]]"
    check "CMake/Ninja UCRT64"            "[[ -x '$MSYS2_ROOT/ucrt64/bin/cmake.exe' && -x '$MSYS2_ROOT/ucrt64/bin/ninja.exe' ]]" "pacman -S mingw-w64-ucrt-x86_64-{cmake,ninja}"
    check "Qt6 UCRT64"                    "[[ -d '$MSYS2_ROOT/ucrt64/lib/cmake/Qt6' ]]"
    check "windeployqt6"                  "[[ -x '$MSYS2_ROOT/ucrt64/bin/windeployqt6.exe' ]]"
    check "assimp (modelos da visão 3D)"  "[[ -f '$MSYS2_ROOT/ucrt64/bin/libassimp-6.dll' ]]" "pacman -S mingw-w64-ucrt-x86_64-assimp"
    check "NSIS (makensis, p/ instalador)" "[[ -x '$MSYS2_ROOT/ucrt64/bin/makensis.exe' ]]" "pacman -S mingw-w64-ucrt-x86_64-nsis"
    check "libFTDI (DMX USB FTDI)"        "[[ -f '$LIBFTDI_PC' ]]" "pacman -S mingw-w64-ucrt-x86_64-libftdi"
    check "Node.js $(node -v 2>/dev/null)" "command -v node"
    check "npm"                           "command -v npm"
    if jdk="$(find_jdk)"; then ok "JDK p/ Gradle: $jdk"; else warn "JDK 17-21 NÃO encontrado (defina QLC_JDK)"; fi
    check "Android SDK ($ANDROID_SDK)"    "[[ -d '$ANDROID_SDK' ]]"
    check "adb"                           "[[ -x '$ADB' ]]"
    check "gh (opcional)"                 "command -v gh" "winget install GitHub.cli"
    step "Estado"
    [[ -x "$QLC_EXE" ]] && ok "QLC+ instalado: $QLC_EXE" || warn "QLC+ ainda não instalado em $QLC_INSTALL"
    [[ -f "$MCP_DIR/dist/src/index.js" ]] && ok "MCP compilado" || warn "MCP não compilado"
    echo "Versões: QLC+ $(qlc_version) | app $(app_version) (code $(app_version_code)) | repo $(github_repo)"
}

clean() {
    confirm "Apagar qlcplus/build, mcp/dist e builds do app?" n || return 0
    rm -rf "$QLC_SRC/build" "$MCP_DIR/dist" "$APP_DIR/app/build" "$APP_DIR/build"
    ok "Limpo"
}

# ------------------------------------------------------------------ menus

menu() {
    local title="$1"; shift
    echo
    echo "${C_B}── $title ──${C_0}"
    local i=1 opt
    for opt in "$@"; do echo "  $i) $opt"; ((i++)); done
    echo "  0) Voltar/Sair"
}

menu_build() {
    menu "Compilar" "QLC+" "MCP" "App (debug)" "App (release)" "Todos"
    case "$(ask "Opção" 5)" in
        1) attempt build_qlcplus ;;
        2) attempt build_mcp ;;
        3) attempt build_app debug ;;
        4) attempt build_app release ;;
        5) attempt build_all ;;
    esac
}

menu_run() {
    menu "Executar" "QLC+" "MCP" "App no tablet (adb)" "QLC+ e depois MCP"
    case "$(ask "Opção" 1)" in
        1) attempt run_qlcplus ;;
        2) attempt run_mcp ;;
        3) attempt run_app ;;
        4) attempt run_qlcplus && attempt run_mcp ;;
    esac
}

main_menu() {
    while true; do
        echo
        echo "${C_B}${C_C}qlc_diakonia${C_0}  QLC+ $(qlc_version) · app $(app_version) · $(git -C "$ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null)"
        menu "Menu principal" "Compilar" "Executar" "Gerar release" "Testes do MCP" "Verificar ambiente" "Limpar builds"
        case "$(ask "Opção" "")" in
            1) menu_build ;;
            2) menu_run ;;
            3) attempt release ;;
            4) attempt test_mcp ;;
            5) doctor ;;
            6) attempt clean ;;
            0|q|Q) exit 0 ;;
            *) continue ;;
        esac
        pause
    done
}

# ------------------------------------------------------------------- main

case "${1:-}" in
    __msys) shift; set -e; "$@" ;;
    "") main_menu ;;
    build)
        case "${2:-all}" in
            qlcplus) attempt build_qlcplus ;; mcp) attempt build_mcp ;; app) attempt build_app debug ;;
            app-release) attempt build_app release ;; all) attempt build_all ;;
            *) die "Use: build [qlcplus|mcp|app|app-release|all]" ;;
        esac ;;
    run)
        case "${2:-}" in
            qlcplus) run_qlcplus ;; mcp) run_mcp ;; app) run_app ;;
            *) die "Use: run [qlcplus|mcp|app]" ;;
        esac ;;
    release) attempt release ;;
    test) attempt test_mcp ;;
    doctor) doctor ;;
    clean) clean ;;
    *) sed -n '3,10p' "$SELF"; exit 1 ;;
esac
