services:
  fs25:
    image: {{IMAGE_NAME}}
    container_name: {{INSTANCE_ID}}
    env_file:
      - .env
    volumes:
      - /etc/localtime:/etc/localtime:ro
      - ./data/config:/opt/fs25/config
      - {{SHARED_GAME_PATH}}:/opt/fs25/game
      - {{SHARED_DLC_PATH}}:/opt/fs25/dlc
      - {{SHARED_INSTALLER_PATH}}:/opt/fs25/installer
      - ./data/mods:/opt/fs25/mods
      - ./data/logs:/opt/fs25/logs
      - ./data/saves:/opt/fs25/saves
    ports:
      - "{{VNC_PORT}}:5900/tcp"
      - "{{NOVNC_PORT}}:6080/tcp"
      - "{{WEB_PORT}}:7999/tcp"
      - "{{SERVER_PORT}}:10823/tcp"
      - "{{SERVER_PORT}}:10823/udp"
    cap_add:
      - SYS_NICE
    restart: unless-stopped

  sftp:
    image: atmoz/sftp:alpine
    container_name: {{INSTANCE_ID}}-sftp
    command:
      - "{{SFTP_USERNAME}}:{{SFTP_PASSWORD}}:1000:1000:FarmingSimulator2025"
    volumes:
      - ./data/config:/home/{{SFTP_USERNAME}}/FarmingSimulator2025
    ports:
      - "{{SFTP_PORT}}:22/tcp"
    restart: unless-stopped
