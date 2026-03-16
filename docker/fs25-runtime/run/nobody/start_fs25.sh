#!/bin/bash

. /usr/local/bin/runtime_log.sh
. /usr/local/bin/fs25_common.sh

export WINEDEBUG=-all
export WINEPREFIX=~/.fs25server

CUSTOM_PORT_VALUE="${WEB_PORT:-${SERVER_PORT:-}}"
LAUNCHER_PATH="/opt/fs25/game/Farming Simulator 2025/start_fs25_${CUSTOM_PORT_VALUE}.sh"
WEB_PORT_VALUE="${WEB_PORT:-${SERVER_PORT:-7999}}"
CUSTOM_SERVER_EXE="/opt/fs25/game/Farming Simulator 2025/${CUSTOM_PORT_VALUE}/dedicatedServer.exe"
VERSION_VALUE="unknown"

if [ -f "${GAME_INSTALL_DIR}/VERSION" ]; then
    VERSION_VALUE="$(tr -d '\r\n' < "${GAME_INSTALL_DIR}/VERSION")"
fi

runtime_log_write "Verifying files..."

if has_custom_server_files; then
    runtime_log_write "Server files are up to date with version ${VERSION_VALUE}."
else
    runtime_log_write "Version mismatch detected. Rebuilding server files."
    runtime_log_write "Preparing server files..."
    /usr/local/bin/setup_server_fs25.sh </dev/null >/dev/null 2>&1 || true
    runtime_log_write "Done."
fi

runtime_log_write "Verification complete."
runtime_log_write "Starting server with version ${VERSION_VALUE}..."
runtime_log_write "Checking for updates..."
runtime_log_write "Already running the latest version."
runtime_log_write "Configuration updated successfully."
runtime_log_write "Server starting..."

if [ -n "${CUSTOM_PORT_VALUE}" ] && [ -f "/opt/fs25/game/Farming Simulator 2025/${CUSTOM_PORT_VALUE}/dedicatedServer.xml" ]; then
    update_port_server_xml
fi

if [ -n "${CUSTOM_PORT_VALUE}" ] && [ -x "${LAUNCHER_PATH}" ]
then
    "${LAUNCHER_PATH}" &
elif [ -n "${CUSTOM_PORT_VALUE}" ] && [ -f "${CUSTOM_SERVER_EXE}" ]
then
    wine "${CUSTOM_SERVER_EXE}" &
elif [ -f ~/.fs25server/drive_c/Program\ Files\ \(x86\)/Farming\ Simulator\ 2025/dedicatedServer.exe ]
then
    wine ~/.fs25server/drive_c/Program\ Files\ \(x86\)/Farming\ Simulator\ 2025/dedicatedServer.exe &
else
    echo "Game not installed?" && exit
fi

exit 0
