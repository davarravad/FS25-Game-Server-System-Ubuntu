#!/bin/bash

. /usr/local/bin/runtime_log.sh

WEBSERVER_PORT="${WEB_PORT:-${SERVER_PORT:-7999}}"

# Autostart
if [[ $AUTOSTART_SERVER = "true" ]] || [[ $AUTOSTART_SERVER = "web_only" ]]; then
  . /usr/local/bin/prepare_start.sh

  . /usr/local/bin/start_fs25.sh &

  runtime_log_write "Waiting for webserver to come up..."

  attempt=1
  max_attempts=12
  DETECTED_WEBSERVER_IP=""
  while [ "$attempt" -le "$max_attempts" ]; do
    runtime_log_write "Checking if FS25 control panel is online - Attempt ${attempt}"
    while read line ; do
      if nc -z "$line" "$WEBSERVER_PORT"; then
        DETECTED_WEBSERVER_IP="$line"
      fi
    done <<< "$(ip -4 addr show | grep -oP '(?<=inet\s)\d+(\.\d+){3}')"

    if [ -n "$DETECTED_WEBSERVER_IP" ]; then
      break
    fi

    runtime_log_write "Attempt ${attempt} failed. Retrying in 10s..."
    attempt=$((attempt + 1))
    sleep 10
  done

  # Check if an IP address was found
  if [ -n "$DETECTED_WEBSERVER_IP" ]; then
    runtime_log_write "[Webserver]: Now accessible using: http://${DETECTED_WEBSERVER_IP}:${WEBSERVER_PORT}"
    runtime_log_write "[Webserver]: Username: ${WEB_USERNAME}"
    runtime_log_write "[Webserver]: Password: ${WEB_PASSWORD}"
    runtime_log_write "Console: Server marked as running..."
    export WEBSERVER_LISTENING_ON="$DETECTED_WEBSERVER_IP"
  else
    runtime_log_write "No IP address found for the webserver."
    exit 1
  fi

  # Redirect all incoming traffic on port $WEBSERVER_PORT to the webserver
  ip -4 addr show | grep -oP '(?<=inet\s)\d+(\.\d+){3}' | while read line ; do
    if [ "$line" = "$WEBSERVER_LISTENING_ON" ]; then
      continue
    fi
    echo "Redirecting incoming traffic on $line:$WEBSERVER_PORT to the webserver at $WEBSERVER_LISTENING_ON:$WEBSERVER_PORT"
    socat tcp-listen:$WEBSERVER_PORT,reuseaddr,fork,bind=$line tcp:${WEBSERVER_LISTENING_ON}:$WEBSERVER_PORT &
  done

  # Test redirects
  ip -4 addr show | grep -oP '(?<=inet\s)\d+(\.\d+){3}' | while read line ; do
    nc -z $line $WEBSERVER_PORT && echo "Webserver link up $line:$WEBSERVER_PORT" || echo "!! Webserver link failed $line:$WEBSERVER_PORT"
  done

  # Start Game Server
  if [[ $AUTOSTART_SERVER = "true" ]]; then
    node /usr/local/bin/start_game.mjs &
    #wine "/home/nobody/.fs25server/drive_c/Program Files (x86)/Farming Simulator 2025/x64/FarmingSimulator2025Game.exe" -name FarmingSimulator2025 -profile C:/users/nobody/Documents/My\ Games/FarmingSimulator2025 -server &
  fi;
fi;

# Keep the container running
trap 'runtime_log_write "Received shutdown signal, stopping server..."; runtime_log_write "Server stopped gracefully."; runtime_log_write "Console: Server marked as offline..."; exit 0' TERM INT
cat
