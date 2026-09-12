# Main-site node management

The main site is the operator interface. Updated nodes keep PHP, the local database,
the Docker agent and nginx as a private backend. They no longer offer a login or
management website. Cloudflare Tunnel carries authenticated API requests and the
two embedded service types: game web administration and browser VNC. The main site
does not expose the node's gateway credentials or forward its session cookies.

## Feature inventory and destinations

| Former node-panel feature | Main-site destination |
| --- | --- |
| Dashboard, host resources and historical trends | Node Overview and Resource history |
| Game inventory, status and per-instance trends | Game Servers and server Overview |
| Host name, agent URL/token, access hostname and shared paths | Node → Host settings |
| Node display name, enabled state, Cloudflare connection, gateway credentials, publishing token, recreate all servers | Node → Connection & access |
| Installed node software and remote updates | Node → Overview → Node software; fleet-wide on Node updates |
| Shared storage preparation and agent health | Node → Host settings |
| Shared game, DLC and installer browsing/uploads | Node → Shared files |
| Installer ZIP extraction | Node → Shared files → installer → Extract installer |
| Create server with generated credentials, suggested ports and all existing creation options | Node → Create game server; also reachable from Game Servers |
| Server name (the label shown on the site), image, ports and SFTP/web credential editing | Server → Settings |
| In-game name, join/admin passwords, player limit, region, map and game tuning | Seeded at creation only; afterwards Server → Overview → Game admin. Settings never overwrites them |
| VNC credential reveal | Server → Settings → Connection credentials |
| Per-server SFTP host address, port, username and password with copy buttons | Server → Overview → SFTP access |
| Start, stop and restart | Server → Overview |
| Game process restart, game/SFTP container reinstall | Server → Maintenance |
| Delete instance and its files | Server → Maintenance, with exact instance-ID confirmation |
| Live game logs, optional Docker logs and container status/health | Server → Logs & containers |
| Profile, mods, saves and logs browsing/uploads | Server → Files |
| Large file uploads with progress | Shared files and Server files; 2 MiB browser chunks |
| Excel-compatible settings export | Node → Export & access |
| Administrative SFTP connection information | Node → Export & access |
| Operator documentation | Node/server → Operator guide |
| Game admin website and noVNC/WebSocket viewer | Server → Overview → Game admin / VNC console |
| Existing machine telemetry and publisher APIs | Retained privately for compatibility |

Administrators manage configuration, files, credentials, creation, deletion,
reinstallation and the game admin/VNC viewers. Staff (the `operator` role) see the
Game Servers list and can start, stop and restart only. Viewers retain read-only
fleet summaries and resource history. Every mutation checks
the main-site session and CSRF token; the node independently verifies the gateway
identity, operation method, role and local instance ownership. Writes and credential
reads are recorded in the central audit log without passwords or file contents.

## Rollout

Run `npm --prefix central run deploy:all` from the release workstation. Then install
the newly published release on a pilot node from its Node software section. Old
nodes show an upgrade/connection error on management pages until upgraded. Enable
automatic Cloudflare connections and wait for Ready. Existing tunnels also work;
no per-game manual tunnel entries are needed.

Verify host settings, directory listing, a disposable game create/edit/delete cycle,
and the game admin/VNC viewers on that pilot before updating the remaining nodes.
Publishing the release does not start node upgrades or modify running game servers.

The legacy login URL now returns a simple backend-ready response for older updater
health checks; other legacy panel pages redirect to the main site. Keep the backend
containers: the main site needs them to operate Docker and node-local files.
