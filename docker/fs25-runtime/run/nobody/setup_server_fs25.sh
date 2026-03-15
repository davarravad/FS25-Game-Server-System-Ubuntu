#!/bin/bash

set -euo pipefail

. /usr/local/bin/fs25_common.sh

ensure_runtime_directories
require_custom_port

. /usr/local/bin/wine_init.sh
. /usr/local/bin/wine_symlinks.sh

if ! has_shared_game_install; then
    echo -e "${RED}ERROR: Shared game files are not installed yet. Run 'Install Game' first.${NOCOLOR}"
    pause_before_exit
    exit 1
fi

. /usr/local/bin/copy_server_config.sh

if has_custom_server_files; then
    echo -e "${YELLOW}INFO: Custom server files already exist for port ${CUSTOM_PORT_VALUE}. Leaving them untouched.${NOCOLOR}"
else
    prepare_port_server_files
fi

if [ -f "$SERVER_CONFIG" ]; then
    echo -e "${YELLOW}INFO: Existing profile config found at ${SERVER_CONFIG}. Leaving it untouched.${NOCOLOR}"
fi

refresh_game_version_cache
touch "$SERVER_SETUP_MARKER"
. /usr/local/bin/cleanup_logs.sh

echo -e "${GREEN}INFO: Server setup is ready for web port ${CUSTOM_PORT_VALUE}.${NOCOLOR}"
echo -e "${GREEN}INFO: You can now click 'Start Server'.${NOCOLOR}"
pause_before_exit
