#!/bin/bash

RUNTIME_LOG_DIR="/opt/fs25/logs"
RUNTIME_LOG_FILE="${RUNTIME_LOG_DIR}/panel-runtime.log"

runtime_log_init() {
    mkdir -p "$RUNTIME_LOG_DIR"
    touch "$RUNTIME_LOG_FILE"
}

runtime_log_write() {
    runtime_log_init
    printf '%s %s\n' "[$(date '+%Y-%m-%d %H:%M:%S')]" "$*" >> "$RUNTIME_LOG_FILE"
}
