#!/bin/bash

# Copy webserver config...

if [ -d ~/.fs25server/drive_c/Program\ Files\ \(x86\)/Farming\ Simulator\ 2025/ ]; then
  target_web_cfg=~/.fs25server/drive_c/Program\ Files\ \(x86\)/Farming\ Simulator\ 2025/dedicatedServer.xml
  mkdir -p "$(dirname "${target_web_cfg}")"
  if [ ! -f "${target_web_cfg}" ]; then
    cp "/home/nobody/.build/fs25/default_dedicatedServer.xml" "${target_web_cfg}"
  else
    echo -e "${YELLOW}INFO: Existing dedicatedServer.xml found, leaving it untouched.${NOCOLOR}"
  fi
else
  echo -e "${RED}ERROR: Game is not installed?${NOCOLOR}" && exit
fi

# Copy server config

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
