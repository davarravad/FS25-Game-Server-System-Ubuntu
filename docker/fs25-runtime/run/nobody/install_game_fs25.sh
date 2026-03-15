#!/bin/bash

set -euo pipefail

. /usr/local/bin/runtime_log.sh
. /usr/local/bin/fs25_common.sh

ensure_runtime_directories
runtime_log_write "Install Game: checking shared game installation..."
scan_dlc_installers
report_installed_dlcs

. /usr/local/bin/wine_init.sh
. /usr/local/bin/wine_symlinks.sh

if has_shared_game_install; then
    echo -e "${GREEN}INFO: Shared FS25 game files already exist in ${GAME_INSTALL_DIR}. Skipping reinstall.${NOCOLOR}"
else
    if ! resolve_installer_path; then
        echo -e "${RED}ERROR: No installer found in ${INSTALL_DIR}. Upload or extract the FS25 installer there first.${NOCOLOR}"
        pause_before_exit
        exit 1
    fi

    REQUIRED_SPACE=50
    AVAILABLE_SPACE=$(df --output=avail /opt/fs25 | tail -1)
    AVAILABLE_SPACE=$((AVAILABLE_SPACE / 1024 / 1024))

    if [ "$AVAILABLE_SPACE" -lt "$REQUIRED_SPACE" ]; then
        echo -e "${RED}ERROR: Not enough free space in /opt/fs25. Required: ${REQUIRED_SPACE} GB, Available: ${AVAILABLE_SPACE} GB${NOCOLOR}"
        pause_before_exit
        exit 1
    fi

    echo -e "${GREEN}INFO: Using installer at ${INSTALLER_PATH}${NOCOLOR}"
    echo -e "${GREEN}INFO: Running shared game installer...${NOCOLOR}"
    runtime_log_write "Install Game: running shared game installer..."
    wine "$INSTALLER_PATH" "/SILENT" "/NOCANCEL" "/NOICONS"
fi

cleanup_desktop_icons
ensure_license_files
. /usr/local/bin/copy_server_config.sh
install_missing_dlcs

echo -e "${YELLOW}INFO: Checking for updates. If prompted about GPU drivers, choose no.${NOCOLOR}"
wine ~/.fs25server/drive_c/Program\ Files\ \(x86\)/Farming\ Simulator\ 2025/FarmingSimulator2025.exe

refresh_game_version_cache
touch "$GAME_INSTALL_MARKER"
runtime_log_write "Install Game: shared game install is ready."

echo -e "${GREEN}INFO: Shared game install is ready at ${GAME_INSTALL_DIR}${NOCOLOR}"
echo -e "${GREEN}INFO: Next step: click 'Setup Server' to prepare this instance safely.${NOCOLOR}"
pause_before_exit
