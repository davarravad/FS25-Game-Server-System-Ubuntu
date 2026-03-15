#!/bin/bash

export WINEDEBUG=-all
export WINEPREFIX=~/.fs25server

CUSTOM_PORT_VALUE="${WEB_PORT:-${SERVER_PORT:-}}"
LAUNCHER_PATH="/opt/fs25/game/Farming Simulator 2025/start_fs25_${CUSTOM_PORT_VALUE}.sh"
WEB_PORT_VALUE="${WEB_PORT:-${SERVER_PORT:-7999}}"

if [ -n "${CUSTOM_PORT_VALUE}" ] && [ -x "${LAUNCHER_PATH}" ]
then
    "${LAUNCHER_PATH}" & sleep 1 && firefox "http://"$CONTAINER_IP":"$WEB_PORT_VALUE"/index.html?lang=en&username="$WEB_USERNAME"&password="$WEB_PASSWORD"&login=Login"
elif [ -f ~/.fs25server/drive_c/Program\ Files\ \(x86\)/Farming\ Simulator\ 2025/dedicatedServer.exe ]
then
    wine ~/.fs25server/drive_c/Program\ Files\ \(x86\)/Farming\ Simulator\ 2025/dedicatedServer.exe & sleep 1 && firefox "http://"$CONTAINER_IP":7999/index.html?lang=en&username="$WEB_USERNAME"&password="$WEB_PASSWORD"&login=Login"
else
    echo "Game not installed?" && exit
fi

exit 0
