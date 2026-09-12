# FS FarmServers

Fleet management for Farming Simulator 25 dedicated servers on Ubuntu.

- **Main site**: https://farmservers.sargentweb.com, a Cloudflare Worker in [`central/`](central/). Discord sign-in and roles, node and game server management, resource history, signed node updates, Cloudflare tunnel automation and the shared game library.
- **Node**: a Docker Compose stack on each Ubuntu host, built from the rest of this repository. It runs the FS25 game containers and exposes a private API that the main site reaches through a Cloudflare Tunnel. Nodes have no login page of their own.

**New here? Read [docs/README.md](docs/README.md)** for the system map, a page-by-page guide to the site, roles, required secrets and the deploy procedure.

## Quick start

| Task | Do this |
| --- | --- |
| Install a new node | Create the node on the site under **Server Nodes**, then run the two commands on the site's **Install a node** page. [Details](docs/NODE-DISTRIBUTION.md#new-ubuntu-node-two-commands). |
| Connect a node to the site | Enable automation on the site's **Cloudflare** page; the node connects itself on its next poll. [Details](docs/CENTRAL-SETUP.md#5-automatic-cloudflare-connections). |
| Ship changes | `cd central && npm run deploy:all`, then update nodes from **Node updates**. [Details](docs/NODE-DISTRIBUTION.md#routine-updates-from-the-site). |
| Manage a game server | Open it under **Game Servers** on the site. [Feature map](docs/MAIN-SITE-MANAGEMENT.md). |
| Sync the game installation between nodes | **Game status** on the site. [Details](docs/GAME-SYNC.md). |

## Repository layout

```text
central/              Cloudflare Worker: src/ (API), public/ (dashboard), migrations/ (D1), tests/
app/web/              Node PHP backend: public/index.php routes, src/ helpers (central.php, management.php)
docker/agent/         Node Docker agent (Python): instance lifecycle, telemetry, game details
docker/fs25-runtime/  FS25 game server image (Wine) and its serverFiles template
docker/php, docker/nginx, docker/publisher   Node control containers
templates/fs25/       Per-instance compose.yml and .env templates
sql/init/             Node MariaDB schema
scripts/              node-manager.py (site installer and updater, served as /install.py), game-sync.py,
                      package-release.py, install-ubuntu.sh and update-node.sh (legacy bridge path)
docs/                 Guides; start with docs/README.md
tests/                Node-side Python and PHP tests
```

## How a node works

`docker-compose.yml` runs the node control plane: `web` (PHP API), `nginx`, `db` (MariaDB), `agent` (Docker control and telemetry), `publisher` (heartbeat to the main site, `--profile central`) and `admin-sftp`. The web service always runs in central mode. It serves the machine APIs and the authenticated game admin and VNC viewers, and sends browsers to the main site.

Each game server is an isolated Compose project under `/opt/fsg-panel/instances/<instance-id>/` with `compose.yml`, `.env` and `data/{config,mods,logs,saves}`. Shared game, DLC and installer folders (`/opt/fs25/{game,dlc,installer}` by default) are mounted into every instance. Instances use `restart: unless-stopped`, and the agent remembers which instances should be running and restores them after a reboot. Every container uses `json-file` log rotation (50 MB, 3 files).

With `CENTRAL_MODE=1` in the node `.env`, newly rendered instances bind VNC, noVNC and game web admin ports to loopback and join the `fsg-management` network so only the tunnel can reach them. Game and per-server SFTP ports stay public so players and third-party SFTP clients can reach them directly. Use **Connection & access → Apply updates to all servers** on the site to recreate existing instances after changing this.

Admin SFTP (`ADMIN_SFTP_PORT`, default 22220) gives full file access to instances, shared folders and backups for large uploads that should not go through the browser. Its connection details are on the node's **Export & access** tab.

## Telemetry

The agent samples about every 30 seconds and keeps 30 days in `<INSTANCE_BASE_PATH>/.telemetry.sqlite3`. The publisher forwards the latest samples to the main site, which keeps its own 30 days in D1. Long ranges show bucket averages. CPU and network rates need two samples, and a gap in a graph is missing data, not zero.

- Host CPU covers the physical host, memory uses Linux `MemAvailable`, and disk is the filesystem holding the instances directory.
- Server CPU follows Docker's convention (100% is one logical core), server RAM is Docker's cache-adjusted usage, and server disk is the instance directory only.
- Host network excludes loopback and Docker bridge and veth interfaces. Server network covers the game container, not its SFTP container.

## Legacy paths

`scripts/install-ubuntu.sh` and `scripts/update-node.sh` are the pre-site installation and Git-tag update path. They remain only as the bridge for nodes that predate site-hosted releases. New nodes use the site installer. Because the node web service no longer serves a login page, a node installed this way still has to be created and connected on the main site before it can be managed.

## Local checks

```bash
cd central && npm run check && npm test
```

```bash
python -B -m unittest discover -s tests -p 'test_*.py' -v
```

```bash
node central/tests/preview.mjs
```

## Licensing

Make sure your use of the FS25 dedicated server files and tooling complies with the game publisher's licensing and distribution requirements. Game binaries are never part of a signed node release. They move between nodes only through the private game library.
