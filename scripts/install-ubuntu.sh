#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="${REPO_DIR:-/opt/fsg-panel/app}"
INSTANCE_BASE_PATH="${INSTANCE_BASE_PATH:-/opt/fsg-panel/instances}"
BACKUP_BASE_PATH="${BACKUP_BASE_PATH:-/opt/fsg-panel/backups}"

echo "[1/6] Installing Docker prerequisites..."
apt-get update
apt-get install -y ca-certificates curl gnupg lsb-release git

if [ ! -f /etc/apt/keyrings/docker.gpg ]; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
fi

if [ ! -f /etc/apt/sources.list.d/docker.list ]; then
  echo \
    "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
    $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
    > /etc/apt/sources.list.d/docker.list
fi

echo "[2/6] Installing Docker..."
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

echo "[3/6] Creating folders..."
mkdir -p "${REPO_DIR}"
mkdir -p "${INSTANCE_BASE_PATH}"
mkdir -p "${BACKUP_BASE_PATH}"

echo "[4/6] Repo placement..."
echo "Place this repo at: ${REPO_DIR}"
echo "Then copy .env.example to .env and update secrets."

echo "[5/6] Permissions..."
chmod 755 "${INSTANCE_BASE_PATH}"
chmod 755 "${BACKUP_BASE_PATH}"

echo "[6/6] Done."
echo "Next:"
echo "  cd ${REPO_DIR}"
echo "  cp .env.example .env"
echo "  nano .env"
echo "  docker compose up -d --build"
