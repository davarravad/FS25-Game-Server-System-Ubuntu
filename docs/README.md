# Documentation map

Start here. The system has three parts, each with its own place in this repository.

| Part | Where | What it does |
| --- | --- | --- |
| Main site (control plane) | `central/` | Cloudflare Worker at https://farmservers.sargentweb.com. Discord sign-in and roles, node inventory, 30 days of metrics, node and game server management, Cloudflare tunnel automation, signed node releases and the shared game library. Data lives in the D1 database `farmservers` and the private R2 bucket `farmservers-releases`. |
| Node backend | `app/web/`, `docker/`, `templates/`, `sql/`, `scripts/` | Runs on each Ubuntu host as Docker Compose: PHP API, MariaDB, the Docker agent, nginx, the heartbeat publisher and admin SFTP. It has no login page of its own; the main site drives it through a Cloudflare Tunnel. |
| Game runtime | `docker/fs25-runtime/` | Wine-based FS25 dedicated server image. One container per game server under `/opt/fsg-panel/instances/<id>/`. |

## Guides

| Read this when | Document |
| --- | --- |
| Setting up or changing the main site: Discord, Worker secrets, D1, roles, enrolling nodes, Cloudflare automation, pilot checks | [CENTRAL-SETUP.md](CENTRAL-SETUP.md) |
| Installing a new Ubuntu node, adopting an existing one, publishing signed releases, updating nodes, rollback | [NODE-DISTRIBUTION.md](NODE-DISTRIBUTION.md) |
| Finding a former node-panel feature on the main site | [MAIN-SITE-MANAGEMENT.md](MAIN-SITE-MANAGEMENT.md) |
| Publishing, approving and syncing the shared FS25 installation and DLC between nodes | [GAME-SYNC.md](GAME-SYNC.md) |
| Public game admin and VNC console hostnames (`game-fs25-NNNN`, `console-fs25-NNNN`) | [GAME-PANEL-URLS.md](GAME-PANEL-URLS.md) |
| Game version, player count and map shown on server cards | [GAME-DETAILS.md](GAME-DETAILS.md) |

The main site serves copies of the first two guides at `/central-setup.txt` and `/node-distribution.txt`. `central/prepare-assets.mjs` refreshes them, and `/install.py`, on every build and deploy.

## Where things are on the main site

Sidebar, by role:

- **Fleet**: Overview (`/`), Game Servers (`/servers`), Server Nodes (`/nodes`). Viewers and administrators. Staff see Game Servers only.
- **Administration**: Users & permissions (`/users`, includes the audit log), Cloudflare (`/cloudflare`), Game status (`/game-status`). Administrators only.
- **Setup & Update**: Node updates (`/setup`), Install a node (`/install`). Administrators only.

Node page (`/nodes/ID`) tabs:

- **Overview**: status, game servers on the node, node software and update progress, resource history, admin notes.
- **Host settings**: the node's local agent URL and token, game access hostname, shared game/DLC/installer paths, prepare storage, agent health.
- **Connection & access**: display name and enabled state, recreate all servers after configuration changes, Cloudflare connection progress, gateway credentials, publishing token.
- **Create game server**, **Shared files**, **Export & access**, **Operator guide**.

Game server page (`/servers/NODE/INSTANCE`) tabs: **Overview** (start, stop, restart, game admin, VNC console), **Logs & containers**, **Settings**, **Files**, **Maintenance**, **Operator guide**.

## Roles

| Role | Can |
| --- | --- |
| Pending | Sign in and wait for approval. |
| Viewer | Read everything under Fleet: nodes, servers, history, node software status, notifications. No actions. |
| Staff (`operator`) | Game Servers list with status; start, stop and restart. Nothing else. |
| Administrator | Everything above plus every management tab, files, credentials, Cloudflare, the game library, users, releases and updates. |

## Secrets the Worker needs

Set each with `npx wrangler secret put NAME` from `central/`. For local development, copy `central/.dev.vars.example` to `central/.dev.vars`.

| Secret | Purpose |
| --- | --- |
| `DISCORD_CLIENT_SECRET` | Discord OAuth login. |
| `NODE_TOKEN_KEY` | 64 hex characters. Encrypts node publishing tokens, gateway credentials, Cloudflare settings and OAuth tokens in D1. Back it up; losing it makes those unreadable. |
| `RELEASE_PUBLIC_KEY` | Base64 SPKI Ed25519 public key that nodes pin for signed releases. Do not rotate casually. |
| `NODE_GATEWAYS` | Legacy only. Per-node gateway JSON used before gateways moved to D1; leave unset on new deployments. |

Non-secret settings are in `central/wrangler.jsonc`: `APP_ORIGIN`, `DISCORD_CLIENT_ID`, `BOOTSTRAP_ADMIN_ID`, the D1 and R2 bindings, routes and two crons: hourly cleanup of expired rows, and a ten-minute pass that provisions public game-panel and console hostnames for every server reported by a connected node (see [GAME-PANEL-URLS.md](GAME-PANEL-URLS.md)).

## Release and deploy

From `central/`, `npm run deploy:all` type-checks, runs the tests, applies D1 migrations, deploys the Worker through `deploy.mjs` (which preserves provisioned game domains) and publishes a signed node release with `publish-release.mjs`. Use `npm run deploy` alone for site-only changes. Never run `wrangler deploy` directly.

Node source shipped in a release: `app`, `docker`, `templates`, `sql`, `scripts`, `.env.example`, `docker-compose.yml`, `LICENSE`. Everything else in the repository stays on the workstation.

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

The preview serves a synthetic dashboard at http://127.0.0.1:8766 with no database. The PHP tests under `tests/` need `php` on the PATH.
