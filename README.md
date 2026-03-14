# FSG FS25 Node

Self-hosted Docker node for provisioning and managing Farming Simulator 25 dedicated servers on Ubuntu. Each node includes its own website and a token-protected node API so it can later report into a main website if you decide to centralize multiple nodes.

This repo is designed to be:
- **modular**
- **host-portable**
- **easy to bootstrap**
- **easy to extend**
- **safe enough for internet-facing use** by keeping Docker control behind an internal agent

## What this repo includes

- Node stack with:
  - **nginx**
  - **php-fpm**
  - **mariadb**
  - **internal agent**
- Node API for:
  - node status
  - host inventory
  - server inventory
- Simple web UI for:
  - login
  - managed hosts
  - file management
  - game servers
  - create server
- Template-driven FS25 instance generation
- One-folder-per-instance design
- Ubuntu bootstrap script
- Database schema
- Internal HTTP agent that controls Docker Compose locally or on remote managed hosts

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

### Local node
This install is a full FS25 node. It hosts the website, database, internal agent, and local management workflows for the servers assigned to it.

### Future upstream control plane
The node also exposes a token-protected website API so a future main site can poll node status, hosts, and server inventory without needing direct Docker access.

### Runtime plane
Each managed host keeps its own FS25 servers under:

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

## Install

### Plug-and-play install on the node host

### 1. Clone the repo
```bash
git clone https://github.com/davarravad/FS25-Game-Server-System-Ubuntu.git
cd FS25-Game-Server-System-Ubuntu
```

### 2. Run the interactive setup script
Run this from the repo root:
```bash
sudo bash scripts/install-ubuntu.sh
```

What it does:
- installs Docker and the Compose plugin if they are missing
- asks for the required node, website, database, admin, and agent settings
- asks for the node API token used by a future main website
- asks for the shared FS25 host paths for `game`, `dlc`, and `installer`
- writes the env file at the repo root as:
  - `.env.example`: template
  - `.env`: real runtime config used by Docker Compose
- creates the instance and backup directories
- creates the shared FS directories used by all instances on that host
- builds and starts the panel stack automatically
- verifies that the node containers are running and that the website responds before finishing

After setup completes, open the panel URL printed by the script and sign in with the admin username and password you entered.

The installer also prints the local node API endpoints:
- `/?route=api_node_status`
- `/?route=api_node_hosts`
- `/?route=api_node_servers`

Authenticate with:

```text
Authorization: Bearer <NODE_API_TOKEN>
```

### 3. Add remote managed game hosts if needed

If the panel host is also the game host, the default local agent is already bootstrapped and you can start creating servers immediately.

If you want one website to manage multiple game hosts from this node:
1. prepare each remote host with Docker, Docker Compose, `/opt/fsg-panel/instances`, and `/opt/fsg-panel/backups`
2. run the agent on that host with its own `AGENT_SHARED_TOKEN`
3. sign in to the panel
4. add the host in the `Managed Hosts` section with:
   - host name
   - agent API URL such as `http://GAME_HOST_IP:8081`
   - that host's token
5. create FS25 servers against that host from the website

### Where the env file is

The setup script writes the real env file here:
```text
<repo-root>/.env
```

Example:
```text
/home/davar/FS25-Game-Server-System-Ubuntu/.env
```

The template file stays here:
```text
<repo-root>/.env.example
```

## Production notes

Before exposing this publicly, you should:
- put the panel behind TLS
- restrict the agent to the private Docker network only
- change all default passwords
- restrict who can reach the panel
- optionally place nginx behind Cloudflare / reverse proxy
- configure backups for `/opt/fsg-panel/instances`

## Local node API

This node exposes a small authenticated API from the same website:

- `GET /?route=api_node_status`
- `GET /?route=api_node_hosts`
- `GET /?route=api_node_servers`

Use `Authorization: Bearer <NODE_API_TOKEN>` or `X-Node-Token: <NODE_API_TOKEN>`.

This is intended for future node-to-main-site integration. The current UI remains focused on local server operations.

## How instance creation works

When you create a server in the panel:
1. the web app resolves the selected managed host
2. it calls that host's internal agent API
3. the agent:
   - creates the instance folder
   - copies the FS25 template
   - renders `.env`
   - renders `compose.yml`
   - creates data directories
4. the panel stores which host owns the instance
5. later actions like start, stop, logs, and delete are routed back to that same host

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

### Managed host support
- The node website can manage multiple FS25 hosts from one location if you decide to use it that way.
- Each host runs the same lightweight agent API near its local Docker engine.
- Add hosts in the UI with a name, agent URL, and shared token.
- Each host also stores shared `game`, `dlc`, and `installer` paths used by every instance on that host.
- New server instances are assigned to a managed host when created.
- Existing installs bootstrap a default local host from `AGENT_URL` and `AGENT_SHARED_TOKEN`.

### Website access features
- The panel can upload files directly into an instance on the selected host.
- Per-instance upload targets currently include `mods`, `saves`, and `config`.
- Managed hosts support large streamed uploads to the host-wide `installer` folder.
- Installer uploads use retryable chunked transfer with browser-side progress, current upload speed, and ETA.
- Installer zip files can be extracted from the panel after upload.
- Each server row includes direct launch links for the game host's web admin and noVNC endpoints.
- Each server can also expose its own SFTP endpoint, limited to that server's `FarmingSimulator2025` profile/config folder for mod and log access.
- The host agent now remembers which instances were meant to be running and restores them after a host reboot.
- Combined with Docker restart policies, instances that were online before a reboot are brought back with their previous running/stopped state.

### Admin SFTP
- The main stack now includes a host-level admin SFTP service for full file access.
- This login can reach:
  - all managed instance folders under `instances/`
  - shared FS files under `shared/game`, `shared/dlc`, and `shared/installer`
  - backups under `backups/`
- Use this when you want to upload very large installer or DLC files over SFTP instead of the website.
- Server actions in the panel include `start`, `stop`, and `restart`.
- Instances are generated with Docker `restart: unless-stopped`, and the panel now exposes the image's `AUTOSTART_SERVER` mode as `Auto start server`, `Web panel only`, or `Manual start`.

### Recommended next upgrades
- Discord auth
- mod upload manager
- save backup/restore UI
- CPU / RAM / disk quotas
- scheduled tasks
- websocket log streaming
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

For a combined panel-plus-agent host, this script is the primary install path.

Run it from the repo root with:

```bash
sudo bash scripts/install-ubuntu.sh
```

It writes `<repo-root>/.env`, installs missing software, creates the required directories, and starts the stack automatically.

## Important note about FS25 licensing

Make sure your use of any dedicated server image and FS25 server tooling complies with the game publisher's licensing and distribution requirements.
