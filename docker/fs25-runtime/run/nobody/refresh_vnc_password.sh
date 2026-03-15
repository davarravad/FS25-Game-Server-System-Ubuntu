#!/bin/bash

set -euo pipefail

export HOME="/home/nobody"
export USER="nobody"

VNC_PASSWD_DIR="/home/nobody/.vnc"
VNC_PASSWD_PATH="${VNC_PASSWD_DIR}/passwd"

mkdir -p "${VNC_PASSWD_DIR}"
chmod 700 "${VNC_PASSWD_DIR}"

if [[ -z "${VNC_PASSWORD:-}" ]]; then
    rm -f "${VNC_PASSWD_PATH}"
    echo "[info] VNC_PASSWORD is not set. Starting VNC without a password file."
    exit 0
fi

if [[ "${#VNC_PASSWORD}" -le 5 ]]; then
    rm -f "${VNC_PASSWD_PATH}"
    echo "[warn] VNC_PASSWORD is shorter than 6 characters. Starting VNC without a password file."
    exit 0
fi

if ! command -v vncpasswd >/dev/null 2>&1; then
    echo "[crit] vncpasswd command was not found in the runtime image."
    exit 1
fi

printf '%s\n' "${VNC_PASSWORD}" | vncpasswd -f > "${VNC_PASSWD_PATH}"
chmod 600 "${VNC_PASSWD_PATH}"

if [[ ! -s "${VNC_PASSWD_PATH}" ]]; then
    echo "[crit] VNC password file was not created at ${VNC_PASSWD_PATH}."
    exit 1
fi

echo "[info] Refreshed VNC password file at ${VNC_PASSWD_PATH}."
