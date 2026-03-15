#!/bin/bash

# Copy server profile config only. The custom dedicatedServer.xml is managed
# inside the per-port server folder under the shared game install.

if [ -d ~/.fs25server/drive_c/users/$USER/Documents/My\ Games/FarmingSimulator2025/ ]; then
  target_server_cfg=~/.fs25server/drive_c/users/$USER/Documents/My\ Games/FarmingSimulator2025/dedicated_server/dedicatedServerConfig.xml
  mkdir -p "$(dirname "${target_server_cfg}")"
  if [ ! -f "${target_server_cfg}" ]; then
    cp "/home/nobody/.build/fs25/default_dedicatedServerConfig.xml" "${target_server_cfg}"
  else
    echo -e "${YELLOW}INFO: Existing dedicatedServerConfig.xml found, leaving it untouched.${NOCOLOR}"
  fi
else
  echo -e "${RED}ERROR: Game didn't start for first time, no directories?${NOCOLOR}" && exit
fi
