#!/bin/bash

. /usr/local/bin/runtime_log.sh
. /usr/local/bin/wine_init.sh
runtime_log_write "[Fragify Daemon]: Updating process configuration files..."

. /usr/local/bin/wine_symlinks.sh
. /usr/local/bin/fs25_common.sh
runtime_log_write "[Fragify Daemon]: Ensuring file permissions are set correctly, this could take a few seconds..."
ensure_runtime_directories

. /usr/local/bin/copy_server_config.sh
runtime_log_write "[Fragify Daemon]: Checking server disk space usage, this could take a few seconds..."

. /usr/local/bin/cleanup_logs.sh
