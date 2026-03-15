#!/bin/bash
set -euo pipefail

export WINEDEBUG=-all
export WINEPREFIX=/home/nobody/.fs25server

FS_PORT="2521"  # <-- change only this

GAME_DIR="$WINEPREFIX/drive_c/Program Files (x86)/Farming Simulator 2025/${FS_PORT}"
EXE="${GAME_DIR}/dedicatedServer.exe"
TAG="start_fs25_${FS_PORT}"

# Prevent this launcher from running twice
LOCK="/tmp/fs25_${FS_PORT}.lock"
exec 9>"$LOCK"
if ! flock -n 9; then
  echo "[$TAG] launcher already running (lock $LOCK). Exiting."
  exit 0
fi

while true; do
  # If the server is already running, do NOT start another instance
  if pgrep -af "dedicatedServer\.exe" | grep -F "$GAME_DIR" >/dev/null 2>&1; then
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