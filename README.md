# FSG FS25 Panel

Self-hosted Docker panel for provisioning and managing multiple Farming Simulator 25 dedicated servers on Ubuntu.

This repo is designed to be:
- **modular**
- **host-portable**
- **easy to bootstrap**
- **easy to extend**
- **safe enough for internet-facing use** by keeping Docker control behind an internal agent

## What this repo includes

- Panel stack with:
  - **nginx**
  - **php-fpm**
  - **mariadb**
  - **internal agent**
- Simple web UI for:
  - login
  - list instances
  - create instance
  - start / stop / restart
  - rebuild / update
  - view logs
- Template-driven FS25 instance generation
- One-folder-per-instance design
- Ubuntu bootstrap script
- Database schema
- Internal HTTP agent that controls Docker Compose locally

## Repo layout

```text
app/
  web/
    public/
    src/
docker/
  php/
  nginx/
  agent/
templates/
  fs25/
scripts/
sql/
  init/
storage/
```

## Architecture

### Control plane
The panel website runs in Docker and talks to the internal agent using a private Docker network.

### Runtime plane
Each FS25 server gets its own folder under:

```text
/opt/fsg-panel/instances/<instance-id>/
```

Each folder contains:
- `compose.yml`
- `.env`
- `data/config`
- `data/game`
- `data/dlc`
- `data/installer`
- `data/mods`
- `data/logs`
- `data/saves`

### Why this model
This makes each instance:
- isolated
- easy to back up
- easy to migrate
- easy to duplicate
- easy to delete safely

## Quick start

### 1. Clone the repo
```bash
git clone https://your-repo-url/fsg-fs25-panel.git
cd fsg-fs25-panel
```

### 2. Copy env file
```bash
cp .env.example .env
```

### 3. Edit env values
Set secure values for:
- `APP_KEY`
- `APP_URL`
- `SESSION_SECRET`
- `DB_ROOT_PASSWORD`
- `DB_PASSWORD`
- `ADMIN_DEFAULT_PASSWORD`
- `AGENT_SHARED_TOKEN`

### 4. Start the panel
```bash
docker compose up -d --build
```

### 5. Open the panel
Visit:
```text
http://YOUR_SERVER_IP:8080
```

Default login:
- username: `admin`
- password: value of `ADMIN_DEFAULT_PASSWORD`

## Production notes

Before exposing this publicly, you should:
- put the panel behind TLS
- restrict the agent to the private Docker network only
- change all default passwords
- restrict who can reach the panel
- optionally place nginx behind Cloudflare / reverse proxy
- configure backups for `/opt/fsg-panel/instances`

## How instance creation works

When you create a server in the panel:
1. the web app inserts the record into the database
2. it calls the internal agent
3. the agent:
   - creates the instance folder
   - copies the FS25 template
   - renders `.env`
   - renders `compose.yml`
   - creates data directories
4. the panel can then start the new instance with Docker Compose

## Reference image

This project is intentionally inspired by the approach used in the `wine-gameservers/arch-fs25server` repository:
- environment-driven configuration
- mounted persistent directories
- Docker-based FS25 runtime

But this repo adds:
- multi-instance management
- a web panel
- DB-backed metadata
- per-instance generated compose files

## Initial roadmap

### Included in this draft
- panel stack
- simple PHP login
- simple dashboard
- create/list/manage servers
- internal agent
- template rendering
- install script

### Recommended next upgrades
- Discord auth
- mod upload manager
- save backup/restore UI
- CPU / RAM / disk quotas
- scheduled tasks
- websocket log streaming
- multiple host node support
- audit logs
- permissions / roles

## Default host paths

The panel expects to manage instances under:

```text
/opt/fsg-panel/instances
```

Backups can go under:

```text
/opt/fsg-panel/backups
```

## Ubuntu bootstrap

Use:

```bash
sudo bash scripts/install-ubuntu.sh
```

This script installs Docker, Compose plugin, creates base directories, copies `.env` if needed, and starts the panel.

## Important note about FS25 licensing

Make sure your use of any dedicated server image and FS25 server tooling complies with the game publisher's licensing and distribution requirements.
