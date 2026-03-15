#!/usr/bin/env bash
[ -n "${BASH_VERSION:-}" ] || exec /usr/bin/env bash "$0" "$@"

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
ENV_EXAMPLE="${REPO_DIR}/.env.example"
ENV_FILE="${REPO_DIR}/.env"

INSTANCE_BASE_PATH_DEFAULT="/opt/fsg-panel/instances"
BACKUP_BASE_PATH_DEFAULT="/opt/fsg-panel/backups"
PANEL_PORT_DEFAULT="8080"
DB_NAME_DEFAULT="fsg_panel"
DB_USER_DEFAULT="fsg_panel"
DB_HOST_DEFAULT="db"
DB_PORT_DEFAULT="3306"
DEFAULT_HOST_NAME_DEFAULT="Local Agent"
NODE_NAME_DEFAULT="FS25 Local Node"
SHARED_GAME_PATH_DEFAULT="/opt/fs25/game"
SHARED_DLC_PATH_DEFAULT="/opt/fs25/dlc"
SHARED_INSTALLER_PATH_DEFAULT="/opt/fs25/installer"
ADMIN_SFTP_PORT_DEFAULT="22220"
ADMIN_SFTP_USERNAME_DEFAULT="paneladmin"
APP_ENV_DEFAULT="production"
TZ_DEFAULT="America/Chicago"

require_root() {
  if [ "${EUID}" -ne 0 ]; then
    echo "Run this script with sudo or as root."
    exit 1
  fi
}

random_secret() {
  local chars='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  local out=''
  local idx=''

  while [ "${#out}" -lt 32 ]; do
    idx="$(od -An -N2 -tu2 /dev/urandom)"
    idx="${idx//[[:space:]]/}"
    out="${out}${chars:$((idx % ${#chars})):1}"
  done

  printf '%s' "${out}"
}

prompt_value() {
  local var_name="$1"
  local prompt_label="$2"
  local default_value="${3:-}"
  local current_value=""

  if [ -n "${default_value}" ]; then
    read -r -p "${prompt_label} [${default_value}]: " current_value
    current_value="${current_value:-$default_value}"
  else
    while [ -z "${current_value}" ]; do
      read -r -p "${prompt_label}: " current_value
    done
  fi

  printf -v "${var_name}" '%s' "${current_value}"
}

prompt_secret() {
  local var_name="$1"
  local prompt_label="$2"
  local generated_default="$3"
  local current_value=""

  read -r -s -p "${prompt_label} [press Enter to auto-generate]: " current_value
  echo
  current_value="${current_value:-$generated_default}"
  printf -v "${var_name}" '%s' "${current_value}"
}

install_docker_if_needed() {
  echo "[1/7] Checking Docker prerequisites..."
  apt-get update
  apt-get install -y ca-certificates curl gnupg lsb-release git

  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    echo "Docker and Compose plugin already installed."
    return
  fi

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

  echo "[2/7] Installing Docker..."
  apt-get update
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  systemctl enable docker >/dev/null 2>&1 || true
  systemctl enable containerd >/dev/null 2>&1 || true
  systemctl start docker >/dev/null 2>&1 || true
}

gather_settings() {
  echo "[3/7] Collecting panel settings..."

  prompt_value APP_URL "Panel URL" "http://$(hostname -I | awk '{print $1}'):${PANEL_PORT_DEFAULT}"
  prompt_value PANEL_PORT "External panel port" "${PANEL_PORT_DEFAULT}"
  prompt_value TZ "Timezone" "${TZ_DEFAULT}"
  prompt_value NODE_NAME "Local node name" "${NODE_NAME_DEFAULT}"
  prompt_value ADMIN_DEFAULT_USERNAME "Admin username" "admin"
  prompt_secret ADMIN_DEFAULT_PASSWORD "Admin password" "$(random_secret)"
  prompt_value DB_NAME "Database name" "${DB_NAME_DEFAULT}"
  prompt_value DB_USER "Database user" "${DB_USER_DEFAULT}"
  prompt_secret DB_PASSWORD "Database password" "$(random_secret)"
  prompt_secret DB_ROOT_PASSWORD "Database root password" "$(random_secret)"
  prompt_value INSTANCE_BASE_PATH "Instance base path" "${INSTANCE_BASE_PATH_DEFAULT}"
  prompt_value BACKUP_BASE_PATH "Backup base path" "${BACKUP_BASE_PATH_DEFAULT}"
  prompt_value DEFAULT_HOST_NAME "Default managed host name" "${DEFAULT_HOST_NAME_DEFAULT}"
  prompt_value AGENT_URL "Default managed host agent URL" "http://agent:8081"
  prompt_secret AGENT_SHARED_TOKEN "Agent shared token" "$(random_secret)"
  prompt_secret NODE_API_TOKEN "Node API token" "$(random_secret)"
  prompt_value SHARED_GAME_PATH "Shared game path" "${SHARED_GAME_PATH_DEFAULT}"
  prompt_value SHARED_DLC_PATH "Shared DLC path" "${SHARED_DLC_PATH_DEFAULT}"
  prompt_value SHARED_INSTALLER_PATH "Shared installer path" "${SHARED_INSTALLER_PATH_DEFAULT}"
  prompt_value ADMIN_SFTP_PORT "Admin SFTP port" "${ADMIN_SFTP_PORT_DEFAULT}"
  prompt_value ADMIN_SFTP_USERNAME "Admin SFTP username" "${ADMIN_SFTP_USERNAME_DEFAULT}"
  prompt_secret ADMIN_SFTP_PASSWORD "Admin SFTP password" "$(random_secret)"

  APP_NAME="FSG FS25 Node"
  APP_ENV="${APP_ENV_DEFAULT}"
  APP_KEY="$(random_secret)"
  SESSION_SECRET="$(random_secret)"
  NODE_SLUG="$(printf '%s' "${NODE_NAME}" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//')"
  NODE_SLUG="${NODE_SLUG:-fs25-local-node}"
  DB_HOST="${DB_HOST_DEFAULT}"
  DB_PORT="${DB_PORT_DEFAULT}"
}

write_env_file() {
  echo "[4/7] Writing ${ENV_FILE}..."

  cat >"${ENV_FILE}" <<EOF
APP_NAME=${APP_NAME}
APP_ENV=${APP_ENV}
APP_URL=${APP_URL}
APP_KEY=${APP_KEY}
SESSION_SECRET=${SESSION_SECRET}
NODE_NAME=${NODE_NAME}
NODE_SLUG=${NODE_SLUG}
NODE_API_TOKEN=${NODE_API_TOKEN}

DB_HOST=${DB_HOST}
DB_PORT=${DB_PORT}
DB_NAME=${DB_NAME}
DB_USER=${DB_USER}
DB_PASSWORD=${DB_PASSWORD}
DB_ROOT_PASSWORD=${DB_ROOT_PASSWORD}

ADMIN_DEFAULT_USERNAME=${ADMIN_DEFAULT_USERNAME}
ADMIN_DEFAULT_PASSWORD=${ADMIN_DEFAULT_PASSWORD}

DEFAULT_HOST_NAME=${DEFAULT_HOST_NAME}
AGENT_URL=${AGENT_URL}
AGENT_SHARED_TOKEN=${AGENT_SHARED_TOKEN}
SHARED_GAME_PATH=${SHARED_GAME_PATH}
SHARED_DLC_PATH=${SHARED_DLC_PATH}
SHARED_INSTALLER_PATH=${SHARED_INSTALLER_PATH}
ADMIN_SFTP_PORT=${ADMIN_SFTP_PORT}
ADMIN_SFTP_USERNAME=${ADMIN_SFTP_USERNAME}
ADMIN_SFTP_PASSWORD=${ADMIN_SFTP_PASSWORD}

PANEL_PORT=${PANEL_PORT}
INSTANCE_BASE_PATH=${INSTANCE_BASE_PATH}
BACKUP_BASE_PATH=${BACKUP_BASE_PATH}

TZ=${TZ}
EOF
}

prepare_directories() {
  echo "[5/7] Creating folders..."
  mkdir -p "${INSTANCE_BASE_PATH}"
  mkdir -p "${BACKUP_BASE_PATH}"
  mkdir -p "${SHARED_GAME_PATH}"
  mkdir -p "${SHARED_DLC_PATH}"
  mkdir -p "${SHARED_INSTALLER_PATH}"
  chown -R 1000:1000 "${INSTANCE_BASE_PATH}" "${BACKUP_BASE_PATH}" "${SHARED_GAME_PATH}" "${SHARED_DLC_PATH}" "${SHARED_INSTALLER_PATH}" || true
  chmod -R ug+rwX,o+rX "${INSTANCE_BASE_PATH}" "${BACKUP_BASE_PATH}" "${SHARED_GAME_PATH}" "${SHARED_DLC_PATH}" "${SHARED_INSTALLER_PATH}"
}

start_stack() {
  echo "[6/7] Starting panel stack..."
  docker compose -f "${REPO_DIR}/docker-compose.yml" up -d --build
}

verify_stack() {
  echo "Verifying containers and panel response..."

  local compose_file="${REPO_DIR}/docker-compose.yml"
  local attempt=0
  local max_attempts=30
  local panel_check_url="http://127.0.0.1:${PANEL_PORT}/?route=login"

  while [ "${attempt}" -lt "${max_attempts}" ]; do
    if docker compose -f "${compose_file}" ps --status running | grep -q "fsg-panel-nginx" \
      && docker compose -f "${compose_file}" ps --status running | grep -q "fsg-panel-web" \
      && docker compose -f "${compose_file}" ps --status running | grep -q "fsg-panel-db" \
      && curl -fsS "${panel_check_url}" >/dev/null 2>&1; then
      echo "Panel is responding on ${panel_check_url}"
      return
    fi

    attempt=$((attempt + 1))
    sleep 2
  done

  echo "Panel did not become ready in time. Recent container status:"
  docker compose -f "${compose_file}" ps || true
  echo
  echo "Recent panel logs:"
  docker compose -f "${compose_file}" logs --tail=80 nginx web db agent || true
  exit 1
}

print_summary() {
  echo "[7/7] Done."
  echo
  echo "Repo root:"
  echo "  ${REPO_DIR}"
  echo "Env file created at:"
  echo "  ${ENV_FILE}"
  echo "Panel URL:"
  echo "  ${APP_URL}"
  echo "Node API:"
  echo "  status: ${APP_URL}/?route=api_node_status"
  echo "  servers: ${APP_URL}/?route=api_node_servers"
  echo "  hosts: ${APP_URL}/?route=api_node_hosts"
  echo "Default login:"
  echo "  username: ${ADMIN_DEFAULT_USERNAME}"
  echo "  password: ${ADMIN_DEFAULT_PASSWORD}"
  echo "Admin SFTP:"
  echo "  host: $(hostname -I | awk '{print $1}')"
  echo "  port: ${ADMIN_SFTP_PORT}"
  echo "  username: ${ADMIN_SFTP_USERNAME}"
  echo "  password: ${ADMIN_SFTP_PASSWORD}"
  echo
  echo "Next:"
  echo "  1. Open the panel and sign in."
  echo "  2. Add remote managed hosts in the Managed Hosts section if needed."
  echo "  3. Create FS25 servers from the website."
}

main() {
  require_root

  if [ ! -f "${ENV_EXAMPLE}" ]; then
    echo "Missing ${ENV_EXAMPLE}. Run this script from the cloned repo."
    exit 1
  fi

  install_docker_if_needed
  gather_settings
  write_env_file
  prepare_directories
  start_stack
  verify_stack
  print_summary
}

main "$@"
