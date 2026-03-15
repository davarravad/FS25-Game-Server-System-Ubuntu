#!/bin/bash

set -u

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NOCOLOR='\033[0m'

# Path to the game installer directory (where the game installation files are stored)
INSTALL_DIR="/opt/fs25/installer"
GAME_ROOT_DIR="/opt/fs25/game"
GAME_INSTALL_DIR="${GAME_ROOT_DIR}/Farming Simulator 2025"

# Path to the config directory (where the game config files are stored)
CONFIG_DIR="/opt/fs25/config"
INSTANCE_PROFILE_DIR="${CONFIG_DIR}/FarmingSimulator2025"
SETUP_MARKER="${INSTANCE_PROFILE_DIR}/.setup-complete"

# Path to the DLC installer directory (where downloaded DLCs are stored)
DLC_DIR="/opt/fs25/dlc"

# Path to the DLC install directory
PDLC_DIR="${INSTANCE_PROFILE_DIR}/pdlc"

# DLC filename prefix (used to identify official DLC packages)
DLC_PREFIX="FarmingSimulator25_"

# Path to the Farming Simulator executable
FS25_EXEC="$HOME/.fs25server/drive_c/Program Files (x86)/Farming Simulator 2025/FarmingSimulator2025.exe"
WEB_CONFIG="$HOME/.fs25server/drive_c/Program Files (x86)/Farming Simulator 2025/dedicatedServer.xml"
SERVER_CONFIG="$HOME/.fs25server/drive_c/users/$USER/Documents/My Games/FarmingSimulator2025/dedicated_server/dedicatedServerConfig.xml"
HOST_GAME_EXEC="${GAME_INSTALL_DIR}/FarmingSimulator2025.exe"
HOST_GAME_VERSION="${GAME_INSTALL_DIR}/VERSION"
HOST_WEB_CONFIG="${GAME_INSTALL_DIR}/dedicatedServer.xml"
HOST_GAME_DIR_MARKER="${GAME_INSTALL_DIR}/x64"
SERVER_TEMPLATE_DIR="/home/nobody/.build/serverFiles/server0001"
SERVER_PORT_VALUE="${SERVER_PORT:-}"
PORT_SERVER_DIR=""
PORT_X64_DIR=""
PORT_LAUNCHER_PATH=""

if [[ -z "$SERVER_PORT_VALUE" ]]; then
    echo -e "${RED}ERROR: SERVER_PORT is not set for this container.${NOCOLOR}"
    exit 1
fi

if ! [[ "$SERVER_PORT_VALUE" =~ ^[0-9]+$ ]]; then
    echo -e "${RED}ERROR: SERVER_PORT must be numeric, got '${SERVER_PORT_VALUE}'.${NOCOLOR}"
    exit 1
fi

PORT_SERVER_DIR="${GAME_INSTALL_DIR}/${SERVER_PORT_VALUE}"
PORT_X64_DIR="${PORT_SERVER_DIR}/x64"
PORT_LAUNCHER_PATH="${GAME_INSTALL_DIR}/start_fs25_${SERVER_PORT_VALUE}.sh"

ensure_runtime_directories() {
    mkdir -p "$INSTALL_DIR" "$GAME_ROOT_DIR" "$CONFIG_DIR" "$INSTANCE_PROFILE_DIR" "$DLC_DIR"
}

has_shared_game_install() {
    [ -f "$HOST_GAME_EXEC" ] ||
    [ -f "$HOST_GAME_VERSION" ] ||
    [ -f "$HOST_WEB_CONFIG" ] ||
    [ -d "$HOST_GAME_DIR_MARKER" ]
}

has_instance_setup_completed() {
    [ -f "$SETUP_MARKER" ] &&
    [ -f "$SERVER_CONFIG" ] &&
    [ -f "$WEB_CONFIG" ] &&
    [ -f "${PORT_SERVER_DIR}/dedicatedServer.exe" ] &&
    [ -f "${PORT_SERVER_DIR}/dedicatedServer.xml" ] &&
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

prepare_port_server_files() {
    local tls_port=""
    local dedicated_server_template=""
    local web_data_template=""
    local run_bat_template=""
    local launcher_template=""
    local escaped_web_username=""
    local escaped_web_password=""

    tls_port="$((SERVER_PORT_VALUE + 10000))"
    dedicated_server_template="${SERVER_TEMPLATE_DIR}/dedicatedServer.xml"
    web_data_template="${SERVER_TEMPLATE_DIR}/web_data"
    run_bat_template="${SERVER_TEMPLATE_DIR}/x64/run.bat"
    launcher_template="${SERVER_TEMPLATE_DIR}/start_fs25_2521.sh"
    escaped_web_username="$(escape_sed_replacement "${WEB_USERNAME:-admin}")"
    escaped_web_password="$(escape_sed_replacement "${WEB_PASSWORD:-webpassword}")"

    mkdir -p "$PORT_SERVER_DIR" "$PORT_X64_DIR"

    for required_file in dedicatedServer.exe cert.pem pk.pem; do
        if [ ! -f "${GAME_INSTALL_DIR}/${required_file}" ]; then
            echo -e "${RED}ERROR: Missing ${GAME_INSTALL_DIR}/${required_file}. The shared game install is incomplete.${NOCOLOR}"
            exit 1
        fi
        cp -f "${GAME_INSTALL_DIR}/${required_file}" "${PORT_SERVER_DIR}/${required_file}"
    done

    if [ -d "$web_data_template" ]; then
        rm -rf "${PORT_SERVER_DIR}/web_data"
        copy_tree_contents "$web_data_template" "${PORT_SERVER_DIR}/web_data"
    elif [ -d "${GAME_INSTALL_DIR}/web_data" ]; then
        rm -rf "${PORT_SERVER_DIR}/web_data"
        copy_tree_contents "${GAME_INSTALL_DIR}/web_data" "${PORT_SERVER_DIR}/web_data"
    else
        echo -e "${YELLOW}WARNING: No web_data template was found. Continuing without copying web assets.${NOCOLOR}"
    fi

    if [ -f "$dedicated_server_template" ]; then
        cp -f "$dedicated_server_template" "${PORT_SERVER_DIR}/dedicatedServer.xml"
    elif [ -f "${GAME_INSTALL_DIR}/dedicatedServer.xml" ]; then
        cp -f "${GAME_INSTALL_DIR}/dedicatedServer.xml" "${PORT_SERVER_DIR}/dedicatedServer.xml"
    else
        echo -e "${RED}ERROR: No dedicatedServer.xml template was found.${NOCOLOR}"
        exit 1
    fi

    sed -i "s/port=\"2521\"/port=\"${SERVER_PORT_VALUE}\"/" "${PORT_SERVER_DIR}/dedicatedServer.xml"
    sed -i "s/port=\"12521\"/port=\"${tls_port}\"/" "${PORT_SERVER_DIR}/dedicatedServer.xml"
    sed -i "s/<username>admin<\\/username>/<username>${escaped_web_username}<\\/username>/" "${PORT_SERVER_DIR}/dedicatedServer.xml"
    sed -i "s/<passphrase>[^<]*<\\/passphrase>/<passphrase>${escaped_web_password}<\\/passphrase>/" "${PORT_SERVER_DIR}/dedicatedServer.xml"
    sed -i 's/exe="[^"]*"/exe="run.bat"/' "${PORT_SERVER_DIR}/dedicatedServer.xml"

    if [ -f "$run_bat_template" ]; then
        cp -f "$run_bat_template" "${PORT_X64_DIR}/run.bat"
    else
        cat >"${PORT_X64_DIR}/run.bat" <<'EOF'
@ECHO OFF
CD "C:\Program Files (x86)\Farming Simulator 2025"
FarmingSimulator2025.exe -server
EOF
    fi

    if [ -f "$launcher_template" ]; then
        cp -f "$launcher_template" "$PORT_LAUNCHER_PATH"
    else
        cat >"$PORT_LAUNCHER_PATH" <<'EOF'
#!/bin/bash
set -euo pipefail

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
    echo "[$TAG] launching dedicatedServer.exe (${FS_PORT})"
    wine "$EXE" || true
    echo "[$TAG] dedicatedServer.exe exited; restarting in 10s..."
    sleep 10
  else
    echo "[$TAG] missing EXE: $EXE"
    sleep 30
  fi
done
EOF
    fi

    sed -i "s/FS_PORT=\"2521\"/FS_PORT=\"${SERVER_PORT_VALUE}\"/" "$PORT_LAUNCHER_PATH"
    chmod +x "$PORT_LAUNCHER_PATH"

    echo -e "${GREEN}INFO: Prepared dedicated server files in ${PORT_SERVER_DIR}${NOCOLOR}"
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

ensure_runtime_directories

if has_instance_setup_completed; then
    echo -e "${YELLOW}INFO: Setup already completed for this server profile. Leaving the shared game install and server config untouched.${NOCOLOR}"
    exit 0
fi

scan_dlc_installers
report_installed_dlcs

# Required free space in GB
REQUIRED_SPACE=50

. /usr/local/bin/wine_init.sh

. /usr/local/bin/wine_symlinks.sh

if has_shared_game_install; then
        echo -e "${GREEN}INFO: Shared FS25 game files already exist in ${GAME_INSTALL_DIR}. Skipping the game installer.${NOCOLOR}"
else
        if ! resolve_installer_path; then
                echo -e "${RED}ERROR: No installer found in ${INSTALL_DIR}. Upload or copy the extracted FS25 installer there before running Setup.${NOCOLOR}"
                exit 1
        fi

        echo -e "${GREEN}INFO: Using installer at ${INSTALLER_PATH}${NOCOLOR}"
        echo -e "${GREEN}INFO: FarmingSimulator2025.exe does not exist. Checking available space...${NOCOLOR}"

        # Get available free space in /opt/fs25 (in GB)
        AVAILABLE_SPACE=$(df --output=avail /opt/fs25 | tail -1)
        AVAILABLE_SPACE=$((AVAILABLE_SPACE / 1024 / 1024)) # Convert KB to GB

        if [ "$AVAILABLE_SPACE" -lt "$REQUIRED_SPACE" ]; then
                echo -e "${RED}ERROR:Not enough free space in /opt/fs25. Required: $REQUIRED_SPACE GB, Available: $AVAILABLE_SPACE GB${NOCOLOR}"
                exit 1
        fi

        echo -e "${GREEN}INFO: Sufficient space available. Running the installer...${NOCOLOR}"
        wine "$INSTALLER_PATH" "/SILENT" "/NOCANCEL" "/NOICONS"
fi

# Cleanup Desktop

# Find files starting with "Farming" on /home/nobody/Desktop
icons=$(find /home/nobody/Desktop -type f -name 'Farming*')

# Check if any files are found
if [ -n "$icons" ]; then
        # Remove all icons starting with "Farming"
        find /home/nobody/Desktop -type f -name 'Farming*' -exec rm -f {} \;
        echo -e "${GREEN}INFO: Files starting with 'Farming' have been removed...${NOCOLOR}"
else
        echo -e "${GREEN}INFO: No desktop icons to cleanup!${NOCOLOR}"
fi

# Do we have a license file installed?

count=$(ls -1 ~/.fs25server/drive_c/users/$USER/Documents/My\ Games/FarmingSimulator2025/*.dat 2>/dev/null | wc -l)
if [ $count != 0 ]; then
        echo -e "${GREEN}INFO: Generating the game license files as needed!${NOCOLOR}"
else
        if [ ! -f "$FS25_EXEC" ]; then
                echo -e "${RED}ERROR: The shared game install is still missing after setup. Aborting before touching server config.${NOCOLOR}" && exit 1
        fi
        wine ~/.fs25server/drive_c/Program\ Files\ \(x86\)/Farming\ Simulator\ 2025/FarmingSimulator2025.exe
fi

count=$(ls -1 ~/.fs25server/drive_c/users/$USER/Documents/My\ Games/FarmingSimulator2025/*.dat 2>/dev/null | wc -l)
if [ $count != 0 ]; then
        echo -e "${GREEN}INFO: The license files are in place!${NOCOLOR}"
else
        echo -e "${RED}ERROR: No license files detected, they are generated after you enter the cd-key during setup... most likely the setup is failing to start!${NOCOLOR}" && exit
fi

. /usr/local/bin/copy_server_config.sh

prepare_port_server_files

# Install DLC (only those not already installed)

echo -e "${GREEN}INFO: Installing missing DLCs (if any)...${NOCOLOR}"

if ((${#supported_names[@]})); then
  for dlc_name in "${supported_names[@]}"; do
    if [ -f "${PDLC_DIR}/${dlc_name}.dlc" ]; then
      # Already installed; skip
      continue
    fi

    # Install missing DLC
    echo -e "${GREEN}INFO: Installing ${dlc_name} (ESD)...${NOCOLOR}"
    any_ran=false
    for i in "$DLC_DIR"/${DLC_PREFIX}${dlc_name}_*.exe; do
      [ -e "$i" ] || break
      any_ran=true
      echo -e "${GREEN}INFO: Running installer ${i}${NOCOLOR}"
      wine "$i"
    done

	# Check if any installer was run
    if ! $any_ran; then
      echo -e "${YELLOW}WARNING: No matching installer found for ${dlc_name} (expected ${DLC_PREFIX}${dlc_name}_*.exe).${NOCOLOR}"
      continue
    fi

    # Verify installation
    if [ -f "${PDLC_DIR}/${dlc_name}.dlc" ]; then
      echo -e "${GREEN}INFO: ${dlc_name} is now installed!${NOCOLOR}"
    else
      echo -e "${YELLOW}WARNING: ${dlc_name} installer ran, but didnt install the DLC. ${NOCOLOR}" #but ${dlc_name}.dlc not found yet.
    fi
  done
else
  echo -e "${YELLOW}WARNING: No DLC installers to process.${NOCOLOR}"
fi


# Check for updates

echo -e "${YELLOW}INFO: Checking for updates, if you get warning about gpu drivers make sure to click no!${NOCOLOR}"
wine ~/.fs25server/drive_c/Program\ Files\ \(x86\)/Farming\ Simulator\ 2025/FarmingSimulator2025.exe

# Replace VERSION File after update / Create VERSION File after first Install -> fix Version to old error for Future DLCs
cp /opt/fs25/game/Farming\ Simulator\ 2025/VERSION /opt/fs25/config/FarmingSimulator2025/

# Check config if not exist exit

if [ -f ~/.fs25server/drive_c/users/$USER/Documents/My\ Games/FarmingSimulator2025/dedicated_server/dedicatedServerConfig.xml ]; then
        touch "${SETUP_MARKER}"
        echo -e "${GREEN}INFO: We can run the server now by clicking on 'Start Server' on the desktop!${NOCOLOR}"
else
        echo -e "${RED}ERROR: We are missing files?${NOCOLOR}" && exit
fi

. /usr/local/bin/cleanup_logs.sh

# Closing window

echo -e "${YELLOW}INFO: All done, closing this window in 20 seconds...${NOCOLOR}"

exec sleep 20
