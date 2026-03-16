#!/bin/bash
set -euo pipefail

. /usr/local/bin/runtime_log.sh

export WINEDEBUG=-all
export WINEPREFIX=/home/nobody/.fs25server

FS_PORT="2521"  # <-- change only this

GAME_DIR="$WINEPREFIX/drive_c/Program Files (x86)/Farming Simulator 2025/${FS_PORT}"
EXE="${GAME_DIR}/dedicatedServer.exe"
TAG="start_fs25_${FS_PORT}"
WEB_PORT_VALUE="${WEB_PORT:-${SERVER_PORT:-${FS_PORT}}}"

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
    runtime_log_write "Console: Server seen offline for port ${FS_PORT}. Starting it back up..."
    echo "[$TAG] launching dedicatedServer.exe (${FS_PORT})"
    runtime_log_write "Console: Server marked as starting..."
    wine "$EXE" &
    server_pid=$!

    if [[ ${AUTOSTART_SERVER:-false} = "true" ]]; then
      (
        attempt=1
        max_attempts=12
        while [ "$attempt" -le "$max_attempts" ]; do
          if nc -z 127.0.0.1 "$WEB_PORT_VALUE" >/dev/null 2>&1; then
            export WEBSERVER_LISTENING_ON="${WEBSERVER_LISTENING_ON:-127.0.0.1}"
            runtime_log_write "Console: Control panel is back for port ${FS_PORT}. Auto-starting the game server..."
            node /usr/local/bin/start_game.mjs >/dev/null 2>&1 || true
            exit 0
          fi

          sleep 5
          attempt=$((attempt + 1))
        done

        runtime_log_write "Console: Timed out waiting for the control panel on port ${FS_PORT}; auto-start was skipped."
      ) &
    fi

    wait "$server_pid" || true
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
