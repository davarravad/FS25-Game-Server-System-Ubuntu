#!/bin/bash

set -u

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NOCOLOR='\033[0m'

INSTALL_DIR="/opt/fs25/installer"
GAME_ROOT_DIR="/opt/fs25/game"
GAME_INSTALL_DIR="${GAME_ROOT_DIR}/Farming Simulator 2025"
CONFIG_DIR="/opt/fs25/config"
INSTANCE_PROFILE_DIR="${CONFIG_DIR}/FarmingSimulator2025"
GAME_INSTALL_MARKER="${GAME_INSTALL_DIR}/.game-install-complete"
SERVER_SETUP_MARKER="${INSTANCE_PROFILE_DIR}/.server-setup-complete"
DLC_DIR="/opt/fs25/dlc"
PDLC_DIR="${INSTANCE_PROFILE_DIR}/pdlc"
DLC_PREFIX="FarmingSimulator25_"
FS25_EXEC="$HOME/.fs25server/drive_c/Program Files (x86)/Farming Simulator 2025/FarmingSimulator2025.exe"
WEB_CONFIG="$HOME/.fs25server/drive_c/Program Files (x86)/Farming Simulator 2025/dedicatedServer.xml"
SERVER_CONFIG="$HOME/.fs25server/drive_c/users/$USER/Documents/My Games/FarmingSimulator2025/dedicated_server/dedicatedServerConfig.xml"
HOST_GAME_EXEC="${GAME_INSTALL_DIR}/FarmingSimulator2025.exe"
HOST_GAME_VERSION="${GAME_INSTALL_DIR}/VERSION"
HOST_WEB_CONFIG="${GAME_INSTALL_DIR}/dedicatedServer.xml"
HOST_GAME_DIR_MARKER="${GAME_INSTALL_DIR}/x64"
SERVER_TEMPLATE_DIR="/home/nobody/.build/serverFiles/server0001"
CUSTOM_PORT_VALUE="${WEB_PORT:-${SERVER_PORT:-}}"
PORT_SERVER_DIR=""
PORT_X64_DIR=""
PORT_LAUNCHER_PATH=""
PORT_SERVER_EXE=""

if [[ -n "$CUSTOM_PORT_VALUE" ]] && [[ "$CUSTOM_PORT_VALUE" =~ ^[0-9]+$ ]]; then
    PORT_SERVER_DIR="${GAME_INSTALL_DIR}/${CUSTOM_PORT_VALUE}"
    PORT_X64_DIR="${PORT_SERVER_DIR}/x64"
    PORT_LAUNCHER_PATH="${GAME_INSTALL_DIR}/start_fs25_${CUSTOM_PORT_VALUE}.sh"
    PORT_SERVER_EXE="${PORT_SERVER_DIR}/dedicatedServer.exe"
fi

ensure_runtime_directories() {
    mkdir -p "$INSTALL_DIR" "$GAME_ROOT_DIR" "$GAME_INSTALL_DIR" "$CONFIG_DIR" "$INSTANCE_PROFILE_DIR" "$DLC_DIR"
}

require_custom_port() {
    if [[ -z "$CUSTOM_PORT_VALUE" ]]; then
        echo -e "${RED}ERROR: Neither WEB_PORT nor SERVER_PORT is set for this container.${NOCOLOR}"
        exit 1
    fi

    if ! [[ "$CUSTOM_PORT_VALUE" =~ ^[0-9]+$ ]]; then
        echo -e "${RED}ERROR: Custom launcher port must be numeric, got '${CUSTOM_PORT_VALUE}'.${NOCOLOR}"
        exit 1
    fi

    PORT_SERVER_DIR="${GAME_INSTALL_DIR}/${CUSTOM_PORT_VALUE}"
    PORT_X64_DIR="${PORT_SERVER_DIR}/x64"
    PORT_LAUNCHER_PATH="${GAME_INSTALL_DIR}/start_fs25_${CUSTOM_PORT_VALUE}.sh"
    PORT_SERVER_EXE="${PORT_SERVER_DIR}/dedicatedServer.exe"
}

has_shared_game_install() {
    [ -f "$HOST_GAME_EXEC" ] ||
    [ -f "$HOST_GAME_VERSION" ] ||
    [ -f "$HOST_WEB_CONFIG" ] ||
    [ -d "$HOST_GAME_DIR_MARKER" ]
}

has_custom_server_files() {
    if [[ -z "$CUSTOM_PORT_VALUE" ]] || ! [[ "$CUSTOM_PORT_VALUE" =~ ^[0-9]+$ ]]; then
        return 1
    fi

    [ -f "${PORT_SERVER_DIR}/dedicatedServer.exe" ] &&
    [ -f "${PORT_SERVER_DIR}/dedicatedServer.xml" ] &&
    [ -f "${PORT_SERVER_DIR}/cert.pem" ] &&
    [ -f "${PORT_SERVER_DIR}/pk.pem" ] &&
    [ -f "${PORT_X64_DIR}/run.bat" ] &&
    [ -x "$PORT_LAUNCHER_PATH" ]
}

resolve_installer_path() {
    if [ -f "$INSTALL_DIR/FarmingSimulator2025.exe" ]; then
        INSTALLER_PATH="$INSTALL_DIR/FarmingSimulator2025.exe"
        return 0
    fi

    if [ -f "$INSTALL_DIR/Setup.exe" ]; then
        INSTALLER_PATH="$INSTALL_DIR/Setup.exe"
        return 0
    fi

    return 1
}

copy_tree_contents() {
    local src_dir="$1"
    local dest_dir="$2"

    mkdir -p "$dest_dir"
    cp -R "${src_dir}/." "$dest_dir/"
}

escape_sed_replacement() {
    printf '%s' "$1" | sed 's/[\/&]/\\&/g'
}

xml_escape() {
    local value="$1"
    value="${value//&/&amp;}"
    value="${value//</&lt;}"
    value="${value//>/&gt;}"
    printf '%s' "$value"
}

scan_dlc_installers() {
    echo -e "${GREEN}INFO: Scanning ${DLC_DIR} for DLC installers...${NOCOLOR}"

    shopt -s nullglob

    supported_names=()
    unsupported=()
    unset seen
    declare -gA seen=()

    for path in "$DLC_DIR"/${DLC_PREFIX}*; do
      [ -e "$path" ] || break
      base="$(basename "$path")"
      ext="${base##*.}"

      case "$ext" in
        exe|EXE)
          raw="${base#${DLC_PREFIX}}"
          name="${raw%%_*}"
          if [[ -n "$name" && -z "${seen[$name]:-}" ]]; then
            supported_names+=("$name")
            seen["$name"]=1
          fi
          ;;
        zip|ZIP|bin|BIN)
          unsupported+=("$base")
          ;;
        *)
          :
          ;;
      esac
    done

    if ((${#supported_names[@]})); then
      echo -e "${GREEN}INFO: DLCs found:${NOCOLOR} ${supported_names[*]}"
    else
      echo -e "${YELLOW}INFO: No DLC installers (.exe) found in ${DLC_DIR}.${NOCOLOR}"
    fi

    if ((${#unsupported[@]})); then
      echo -e "${YELLOW}WARNING: The following files were found but are NOT supported (bin/zip), please use .exe:${NOCOLOR}"
      for u in "${unsupported[@]}"; do
        echo " - $u"
      done
    fi
}

report_installed_dlcs() {
    if ((${#supported_names[@]})); then
      echo -e "${GREEN}INFO: Checking installed DLC status...${NOCOLOR}"
      for name in "${supported_names[@]}"; do
        if [ -f "${PDLC_DIR}/${name}.dlc" ]; then
          echo -e "${GREEN}INFO: ${name} is already installed.${NOCOLOR}"
        else
          echo -e "${YELLOW}INFO: ${name} is not installed yet.${NOCOLOR}"
        fi
      done
    fi
}

cleanup_desktop_icons() {
    local icons
    icons=$(find /home/nobody/Desktop -type f -name 'Farming*' 2>/dev/null || true)

    if [ -n "$icons" ]; then
        find /home/nobody/Desktop -type f -name 'Farming*' -exec rm -f {} \;
        echo -e "${GREEN}INFO: Removed temporary Farming desktop icons.${NOCOLOR}"
    fi
}

ensure_license_files() {
    local count=0
    count=$(ls -1 ~/.fs25server/drive_c/users/$USER/Documents/My\ Games/FarmingSimulator2025/*.dat 2>/dev/null | wc -l)
    if [ "$count" -eq 0 ]; then
        if [ ! -f "$FS25_EXEC" ]; then
            echo -e "${RED}ERROR: The shared game install is still missing after setup.${NOCOLOR}" && exit 1
        fi
        wine ~/.fs25server/drive_c/Program\ Files\ \(x86\)/Farming\ Simulator\ 2025/FarmingSimulator2025.exe
    fi

    count=$(ls -1 ~/.fs25server/drive_c/users/$USER/Documents/My\ Games/FarmingSimulator2025/*.dat 2>/dev/null | wc -l)
    if [ "$count" -eq 0 ]; then
        echo -e "${RED}ERROR: No license files detected. Enter the FS25 key in the game setup window first.${NOCOLOR}" && exit 1
    fi

    echo -e "${GREEN}INFO: License files are in place.${NOCOLOR}"
}

install_missing_dlcs() {
    echo -e "${GREEN}INFO: Installing missing DLCs (if any)...${NOCOLOR}"

    if ((${#supported_names[@]})); then
      for dlc_name in "${supported_names[@]}"; do
        if [ -f "${PDLC_DIR}/${dlc_name}.dlc" ]; then
          continue
        fi

        echo -e "${GREEN}INFO: Installing ${dlc_name} (ESD)...${NOCOLOR}"
        local any_ran=false
        for i in "$DLC_DIR"/${DLC_PREFIX}${dlc_name}_*.exe; do
          [ -e "$i" ] || break
          any_ran=true
          echo -e "${GREEN}INFO: Running installer ${i}${NOCOLOR}"
          wine "$i"
        done

        if ! $any_ran; then
          echo -e "${YELLOW}WARNING: No matching installer found for ${dlc_name}.${NOCOLOR}"
          continue
        fi

        if [ -f "${PDLC_DIR}/${dlc_name}.dlc" ]; then
          echo -e "${GREEN}INFO: ${dlc_name} is now installed!${NOCOLOR}"
        else
          echo -e "${YELLOW}WARNING: ${dlc_name} installer ran, but did not install the DLC yet.${NOCOLOR}"
        fi
      done
    else
      echo -e "${YELLOW}WARNING: No DLC installers to process.${NOCOLOR}"
    fi
}

refresh_game_version_cache() {
    if [ -f "${GAME_INSTALL_DIR}/VERSION" ]; then
        mkdir -p "${INSTANCE_PROFILE_DIR}"
        cp "${GAME_INSTALL_DIR}/VERSION" "${INSTANCE_PROFILE_DIR}/"
    fi
}

update_port_server_xml() {
    require_custom_port

    if [ ! -f "${PORT_SERVER_DIR}/dedicatedServer.xml" ]; then
        return 0
    fi

    local tls_port=""
    local escaped_web_username=""
    local escaped_web_password=""

    tls_port="${TLS_PORT:-$((CUSTOM_PORT_VALUE + 10000))}"
    escaped_web_username="$(escape_sed_replacement "$(xml_escape "${WEB_USERNAME:-admin}")")"
    escaped_web_password="$(escape_sed_replacement "$(xml_escape "${WEB_PASSWORD:-webpassword}")")"

    sed -i -E "s/(<webserver port=\")[0-9]+(\">)/\1${CUSTOM_PORT_VALUE}\2/" "${PORT_SERVER_DIR}/dedicatedServer.xml"
    sed -i -E "s/(<tls port=\")[0-9]+(\" active=\")/\1${tls_port}\2/" "${PORT_SERVER_DIR}/dedicatedServer.xml"
    sed -i -E "s#<username>[^<]*</username>#<username>${escaped_web_username}</username>#" "${PORT_SERVER_DIR}/dedicatedServer.xml"
    sed -i -E "s#<passphrase>[^<]*</passphrase>#<passphrase>${escaped_web_password}</passphrase>#" "${PORT_SERVER_DIR}/dedicatedServer.xml"
    sed -i -E 's/exe="[^"]*"/exe="run.bat"/' "${PORT_SERVER_DIR}/dedicatedServer.xml"
}

prepare_port_server_files() {
    require_custom_port

    local tls_port=""
    local dedicated_server_template=""
    local web_data_template=""
    local run_bat_template=""
    local launcher_template=""
    local escaped_web_username=""
    local escaped_web_password=""

    tls_port="${TLS_PORT:-$((CUSTOM_PORT_VALUE + 10000))}"
    dedicated_server_template="${SERVER_TEMPLATE_DIR}/dedicatedServer.xml"
    web_data_template="${SERVER_TEMPLATE_DIR}/web_data"
    run_bat_template="${SERVER_TEMPLATE_DIR}/x64/run.bat"
    launcher_template="${SERVER_TEMPLATE_DIR}/start_fs25_2521.sh"
    escaped_web_username="$(escape_sed_replacement "${WEB_USERNAME:-admin}")"
    escaped_web_password="$(escape_sed_replacement "${WEB_PASSWORD:-webpassword}")"

    mkdir -p "$PORT_SERVER_DIR" "$PORT_X64_DIR"

    for required_file in dedicatedServer.exe cert.pem pk.pem; do
        if [ ! -f "${GAME_INSTALL_DIR}/${required_file}" ]; then
            echo -e "${RED}ERROR: Missing ${GAME_INSTALL_DIR}/${required_file}. Install the game first.${NOCOLOR}"
            exit 1
        fi
        if [ ! -f "${PORT_SERVER_DIR}/${required_file}" ]; then
            cp -f "${GAME_INSTALL_DIR}/${required_file}" "${PORT_SERVER_DIR}/${required_file}"
        fi
    done

    if [ ! -d "${PORT_SERVER_DIR}/web_data" ]; then
        if [ -d "$web_data_template" ]; then
            copy_tree_contents "$web_data_template" "${PORT_SERVER_DIR}/web_data"
        elif [ -d "${GAME_INSTALL_DIR}/web_data" ]; then
            copy_tree_contents "${GAME_INSTALL_DIR}/web_data" "${PORT_SERVER_DIR}/web_data"
        else
            echo -e "${YELLOW}WARNING: No web_data template was found.${NOCOLOR}"
        fi
    fi

    if [ ! -f "${PORT_SERVER_DIR}/dedicatedServer.xml" ]; then
        if [ -f "$dedicated_server_template" ]; then
            cp -f "$dedicated_server_template" "${PORT_SERVER_DIR}/dedicatedServer.xml"
        elif [ -f "${GAME_INSTALL_DIR}/dedicatedServer.xml" ]; then
            cp -f "${GAME_INSTALL_DIR}/dedicatedServer.xml" "${PORT_SERVER_DIR}/dedicatedServer.xml"
        else
            echo -e "${RED}ERROR: No dedicatedServer.xml template was found.${NOCOLOR}"
            exit 1
        fi

    else
        echo -e "${YELLOW}INFO: Existing ${PORT_SERVER_DIR}/dedicatedServer.xml found, leaving it untouched.${NOCOLOR}"
    fi

    update_port_server_xml

    if [ ! -f "${PORT_X64_DIR}/run.bat" ]; then
        if [ -f "$run_bat_template" ]; then
            cp -f "$run_bat_template" "${PORT_X64_DIR}/run.bat"
        else
            cat >"${PORT_X64_DIR}/run.bat" <<'EOF'
@ECHO OFF
CD "C:\Program Files (x86)\Farming Simulator 2025"
FarmingSimulator2025.exe -server
EOF
        fi
    fi

    if [ -f "$launcher_template" ]; then
        cp -f "$launcher_template" "$PORT_LAUNCHER_PATH"
    else
        cat >"$PORT_LAUNCHER_PATH" <<'EOF'
#!/bin/bash
set -euo pipefail

. /usr/local/bin/runtime_log.sh

export WINEDEBUG=-all
export WINEPREFIX=/home/nobody/.fs25server

FS_PORT="2521"

GAME_DIR="$WINEPREFIX/drive_c/Program Files (x86)/Farming Simulator 2025/${FS_PORT}"
EXE="${GAME_DIR}/dedicatedServer.exe"
TAG="start_fs25_${FS_PORT}"

LOCK="/tmp/fs25_${FS_PORT}.lock"
exec 9>"$LOCK"
if ! flock -n 9; then
  echo "[$TAG] launcher already running (lock $LOCK). Exiting."
  exit 0
fi

while true; do
  if pgrep -af "dedicatedServer\\.exe" | grep -F "$GAME_DIR" >/dev/null 2>&1; then
    echo "[$TAG] server already running; sleeping 15s..."
    sleep 15
    continue
  fi

  if [ -f "$EXE" ]; then
    runtime_log_write "Console: Server seen offline for port ${FS_PORT}. Starting it back up..."
    echo "[$TAG] launching dedicatedServer.exe (${FS_PORT})"
    runtime_log_write "Console: Server marked as starting..."
    wine "$EXE" || true
    runtime_log_write "Console: Server process exited for port ${FS_PORT}."
    runtime_log_write "Console: Server marked as offline..."
    echo "[$TAG] dedicatedServer.exe exited; restarting in 10s..."
    runtime_log_write "Console: Restarting server for port ${FS_PORT} in 10s..."
    sleep 10
  else
    echo "[$TAG] missing EXE: $EXE"
    runtime_log_write "Console: Missing dedicatedServer.exe for port ${FS_PORT} at ${EXE}"
    sleep 30
  fi
done
EOF
    fi

    sed -i "s/FS_PORT=\"2521\"/FS_PORT=\"${CUSTOM_PORT_VALUE}\"/" "$PORT_LAUNCHER_PATH"
    chmod +x "$PORT_LAUNCHER_PATH"

    echo -e "${GREEN}INFO: Custom server files are ready in ${PORT_SERVER_DIR}${NOCOLOR}"
}

pause_before_exit() {
    echo
    read -r -p "Press Enter to close this window..." _
}
