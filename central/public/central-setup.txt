# Central fleet management

Production address: **https://farmservers.sargentweb.com**. Discord application: `1547412664068866159`. Initial administrator: `513527870258151439`.

The implementation is in `central/`. Deployment and an end-to-end pilot on an Ubuntu node are required before production use. Repository visibility, Discord secrets, Tunnel configuration and wildcard certificates are separate account setup steps; source changes alone do not configure them.

## Architecture and access

The Worker serves the dashboard, handles Discord OAuth, checks approved users on each request, and stores node inventory and 30 days of metrics in D1. Each Ubuntu publisher sends an outgoing heartbeat every 30 seconds with a separate revocable token. Passwords, agent tokens, filesystem paths and configuration files are excluded from snapshots. Offline hosts retain their last values and history; missing values are not zeroes.

Roles (enforced by the API, not only the interface): **Pending** accounts can sign in but see only an approval-waiting page. **Viewer** has read-only access to nodes, game servers, resource history, node software status and notifications. **Staff** (stored as the `operator` role) sees only the Game Servers list and can start, stop or restart a game server; staff cannot open node pages, management tabs, game admin or VNC. **Administrator** can do everything: approve and block users, create and configure nodes, view and rotate gateway and publishing tokens, run Cloudflare automation, manage the game library, publish and withdraw signed releases, queue node updates, and use every node and game server management tab. Signed-out users receive only the sign-in screen. There is no per-node user permission model in this version.

Interactive access runs through a Cloudflare Tunnel and Access **Service Auth** policy. The Worker holds that service token and a separate node gateway secret. It creates single-use 60-second viewer tickets, then a 15-minute session on a separate hostname for each node/resource. Viewer sessions depend on a valid central session and current administrator approval. Game admin traffic is relayed by the Worker; its WebSocket relay checks revocation at most every 15 seconds. The VNC console is different: the Cloudflare edge never types a Worker subrequest as a WebSocket upgrade into a Tunnel (the node answers 101 but the response is held until the idle timeout), so noVNC connects straight to the node gateway hostname instead. Node setup therefore creates a second, more specific Access application per node that bypasses Access for `origin-…/central/view/*/vnc/websockify` only, and the Worker signs a ticket into that socket path (HMAC of the instance, expiry and a nonce, keyed by the node gateway token) which the node verifies together with a `https://…sargentweb.com` Origin. The ticket expires with the viewer session, so a console socket that is already open is not cut off by later revocation. Nodes provisioned before this existed receive their bypass application automatically on their next connection poll; the ticket check needs a node release that includes it. Open a new console after expiry. Cookies for the central panel are host-only and never sent to a node or game server.

## 1. Prepare the transition before making GitHub private

Follow [Site-hosted node installation and updates](NODE-DISTRIBUTION.md) first. Publish the final bridge release, configure the main-site release bucket and signing key, and migrate every existing node to the site updater. Keep GitHub public until every node has completed a successful site update. Migrated nodes do not need GitHub deploy keys or tokens.

## 2. Configure Discord

In the Discord Developer Portal, open application `1547412664068866159`. Add the exact OAuth2 redirect:

```text
https://farmservers.sargentweb.com/auth/callback
```

Use the client secret, not a bot token. No bot or guild-wide permission is required; login requests only `identify`. Put the secret in an ignored local `central/.dev.vars` file for setup. Never put it in Git, screenshots or chat. Production secrets must also be uploaded to the Worker with Wrangler; `.dev.vars` is not automatically a production secret.

## 3. Prepare Cloudflare

Use the Cloudflare account that manages `sargentweb.com`. Install Node.js and run from the repository:

```bash
cd central
npm ci
npx wrangler login
npx wrangler whoami
npx wrangler d1 create farmservers
```

Copy the returned `database_id` into the existing `d1_databases` entry in `wrangler.jsonc`. Do not create a second database if `farmservers` already exists; list databases first with `npx wrangler d1 list`.

New game panel and VNC links use individually provisioned Custom Domains; see [Game panel URLs](GAME-PANEL-URLS.md) for rollout, permissions and public access. Deploy with `npm run deploy` to preserve these domains.

The main hostname uses a Workers custom domain. Legacy viewer hosts use `*.farmservers.sargentweb.com`, routed to this Worker by the wildcard route in `wrangler.jsonc`. Create a proxied wildcard DNS record for this viewer hostname and provision an edge certificate covering it. **Ordinary Universal SSL for `sargentweb.com` does not cover these extra-level viewer names.** Use an appropriate Advanced Certificate/Total TLS setup and verify certificate coverage before launching consoles. Do not deploy a wildcard route over unrelated `sargentweb.com` applications.

```bash
npm run types
npm run check
npm test
npm run build
npm run db:remote
npx wrangler secret put DISCORD_CLIENT_SECRET
npm run deploy
```

`secret put` prompts securely for each value. Gateway settings are stored per node in D1; remote actions remain unavailable until configured. Configure WAF/rate limits for `/auth/*` and `/api/*` according to expected usage before public rollout. Keep OAuth callback and heartbeat requests reachable; do not require a browser challenge for node heartbeats.

Sign in as the initial administrator. Other users sign in once to create a pending request; approve them under **Users & permissions**. Role changes revoke their existing sessions, so they must sign in again.

## 4. Enroll an existing Ubuntu node

Back up `.env`, the panel database and game saves first. Update one pilot node before the other two. In the central dashboard, create a unique ID such as `node-1` under **Server Nodes**, then open the node's **Connection & access** tab and use **View token → Copy token**. **Rotate token** on that tab replaces it.

Before deploying node management, apply D1 migrations (including `0004_node_tokens.sql`) with `npm run db:remote` from `central`. Generate a dedicated key with `openssl rand -hex 32` and save it as the Worker secret `NODE_TOKEN_KEY` using `npx wrangler secret put NODE_TOKEN_KEY`; also configure it in `.dev.vars` for local development. Keep this key backed up and separate from node credentials. Then deploy with `npm run deploy`.

**Overview** (`/`) lists all nodes with status totals, search and filtering. **Game Servers** (`/servers`) lists all published game instances. Open a node (`/nodes/ID`) or server (`/servers/NODE/INSTANCE`) for details, resource history and management. **Server Nodes** (`/nodes`) lists nodes and lets administrators create one. A node page has tabs: **Overview** (status, servers, node software and updates, resource history, admin notes), **Host settings** (local agent, shared paths, storage preparation, agent health), **Connection & access** (display name and enabled state, recreate all servers, Cloudflare connection progress, gateway credentials, publishing token), **Create game server**, **Shared files**, **Export & access** and **Operator guide**. Node IDs remain fixed; creating a duplicate ID is rejected instead of rotating it. A game server page has **Overview**, **Logs & containers**, **Settings**, **Files**, **Maintenance** and **Operator guide** tabs.

**Setup & Update** contains two pages: **Node updates** (`/setup`) for fleet update jobs, release withdrawal and control-plane guidance, and **Install a node** (`/install`) for new installations and adoption. The old `/setup.html` address still opens Node updates.

Node detail pages also show installed software, the newest enabled release (ordered by numeric version), and the latest update job. Administrators can queue an update or cancel a queued job directly on that page. Progress refreshes every five seconds and reports queued, running, succeeded, or failed/cancelled; the updater does not report a percentage. Apply `0005_node_version.sql` before deploying this feature. The updated node manager reports its installed release on each poll and records the initial version on fresh installations. Older nodes use their last successful managed update as a labeled fallback; nodes with neither source show “Not reported.” Ship the changed node manager in the next signed release to enable ongoing version reporting. A disabled node must be enabled before an update can be queued.

The top-right header contains the account menu and in-site notifications. Apply `0006_notification_reads.sql` before deploying notifications. The bell refreshes every 30 seconds while the page is visible and shows current offline nodes, RAM/disk usage at or above 90%, and release/update events from the last seven days. Read state is saved per user. Capacity alerts are grouped per resource per day; offline alerts clear when a node reconnects. These are in-site notifications, not email or operating-system push alerts.

**Users & permissions** (`/users`) lets administrators search users, pre-approve a Discord user ID, and assign fixed roles. Pending has no fleet access; Viewer has read-only fleet, history and notification access; Staff sees the Game Servers list and can start, stop and restart; Administrator has every management page, including user, node, token, Cloudflare, game library and release management. The page also shows the site audit log (most recent 100 events, retained 90 days). Users authenticate through Discord; no local passwords are created. Changing a role revokes that user's sessions. Administrators cannot change their own role or the bootstrap administrator's role. Setting a user to Pending revokes fleet access. These permissions are enforced by the API as well as the interface.

New Discord users are automatically registered with Pending membership and signed in to an approval-waiting page. Administrators approve them by changing their role. Apply `0007_blocked_users.sql` before deploying user blocking. **Block user** immediately revokes sessions and prevents Discord from creating any new session for that account; reconnecting through Discord does not clear the block. **Unblock user** returns the account to Pending for a fresh approval. Blocking yourself or the bootstrap administrator is prohibited.

Publishing tokens are encrypted in D1 and fetched only when an administrator clicks **View token** on a node's **Connection & access** tab. **Hide token**, leaving the page, or switching away from the browser tab clears the visible value. Each reveal requires the administrator session and CSRF token, sends a non-cacheable response, and records an audit event without the token. Token rotation is separate from editing and does not re-enable a disabled node.

Existing token hashes cannot be reversed. Existing nodes automatically save their current token in encrypted form on their next successful heartbeat after the key is configured. Offline nodes must reconnect before their tokens can be viewed, or an administrator can rotate their token and update `CENTRAL_NODE_TOKEN` on that node. Changing the encryption key makes saved tokens unreadable until nodes heartbeat again; retain the original key to preserve access to offline nodes. These controls expose publishing tokens only, not gateway or Cloudflare Access secrets.

In the node's `.env`, set:

```dotenv
CENTRAL_URL=https://farmservers.sargentweb.com
CENTRAL_NODE_ID=node-1
CENTRAL_NODE_TOKEN=the-token-from-the-dashboard
CENTRAL_GATEWAY_TOKEN=a-distinct-64-character-random-hex-secret
CENTRAL_MODE=1
PANEL_BIND_ADDRESS=127.0.0.1
```

Generate the gateway secret locally with `openssl rand -hex 32`. Ensure `NODE_API_TOKEN` is also a unique random value, at least 32 characters; replace the example value. Keep gateway, publisher and agent tokens distinct. Restrict `.env` permissions with `chmod 600 .env`.

```bash
cd ~/FS25-Game-Server-System-Ubuntu
sudo docker compose --profile central up -d --build web agent nginx publisher
sudo docker compose logs --tail=60 publisher agent
```

The publisher should report `Heartbeat accepted`. Within two minutes, the central dashboard should show the node and samples. If it does not, check node credentials, system clock, outbound HTTPS and whether the agent has valid host metrics. Publisher logs deliberately omit response bodies and credentials.

Setting `CENTRAL_MODE=1` changes **newly rendered** game configurations to bind VNC, noVNC and game web/admin published ports to loopback, and attaches the game service to the management Docker network. The per-server SFTP port is left public, like the game port, so third-party SFTP clients can connect to it directly. Existing running containers retain their old bindings until their configuration is synchronized and the container is recreated. Schedule a maintenance window, then use **Apply updates to all servers** on the node's **Connection & access** tab (administrators only): it resyncs and force-recreates every enabled server on that node in one step, no SSH required. This interrupts that node's players. Check `docker port INSTANCE_ID`: VNC, noVNC and web admin ports must show `127.0.0.1`, while game and SFTP ports remain public. Docker port publishing can bypass UFW; verify from another computer that the loopback-bound ports are inaccessible directly. Use Docker Engine 28 or newer for loopback-publishing protections.

The local panel is still available through SSH forwarding for recovery:

```bash
ssh -L 8080:127.0.0.1:8080 davar@YOUR_NODE
```

Browse `http://localhost:8080`. Adjust the port if `PANEL_PORT` differs. Native SFTP remains available over an SSH port forward; it is not browser WebSocket traffic.

## 5. Automatic Cloudflare connections

Deploy the central app and migrations, including `0009_cloudflare_automation.sql`, with `npm --prefix central run deploy:all` on the release workstation. This also signs and publishes changed node source, including the current `scripts/node-manager.py`, `docker-compose.yml`, and web application. Existing nodes must install that release from their Node software section. Publishing a release does not start node updates automatically.

### Connect with Cloudflare (OAuth)

Migration `0010_cloudflare_oauth.sql` adds OAuth registration, temporary authorization states, and encrypted token storage. The normal deploy command applies it.

Register a private OAuth client once in Cloudflare under **Manage Account → OAuth clients**. Use Authorization Code with `client_secret_basic` authentication. Set the exact redirect URL to:

`https://farmservers.sargentweb.com/api/cloudflare/oauth/callback`

Select the scopes covering Zone Read, DNS Edit, Cloudflare Tunnel Edit, Access Apps and Policies Edit, Access Service Tokens Edit, and `offline_access` for background token renewal. Cloudflare's OAuth scope IDs are distinct from display labels; use the exact IDs shown for the registered client. Its authenticated `GET /client/v4/oauth/scopes` API lists available IDs. See [client registration](https://developers.cloudflare.com/fundamentals/oauth/create-an-oauth-client/) and [OAuth endpoints](https://developers.cloudflare.com/fundamentals/oauth/integrate-with-cloudflare/).

On the site's **Cloudflare → One-time OAuth app registration**, save the Client ID, Client Secret, and registered scope IDs. Then choose **Connect with Cloudflare**, sign in on Cloudflare, and approve access. The callback automatically finds the active `sargentweb.com` zone and owning account, verifies API access, and enables node automation. Existing automated nodes prevent switching to a different account or zone accidentally.

Cloudflare authorization is available only to existing site administrators; Discord still controls site sign-in and roles. OAuth state is single-use, expires in ten minutes, and is bound to the initiating site session. PKCE protects the code exchange. Client secrets and access/refresh tokens are encrypted in D1; browsers and nodes never receive them. Refreshes use a database lease to prevent simultaneous refresh-token rotation. If Cloudflare rejects or revokes authorization, reconnect and retry any affected node setup.

**Disconnect Cloudflare** attempts to revoke the refresh token, removes local authorization, and pauses automation. Existing node resources and gateway connections remain. If Cloudflare cannot confirm revocation, the site tells you to revoke the app from your Cloudflare account. Changing the registered client clears previous local authorization and requires reconnecting.

### Manual API token alternative

Open the administrator-only **Cloudflare** page. Enter your Cloudflare Account ID, Zone ID, and a scoped API token for the `sargentweb.com` zone. Required permissions:

- Account: Cloudflare Tunnel — Edit.
- Account: Access: Apps and Policies — Edit.
- Account: Access: Service Tokens — Edit.
- Zone: DNS — Edit; Zone — Read.

Enable automatic node connections and save. The account and zone are checked before enabling; missing write permissions are reported at the affected setup step. The API token is encrypted in D1 with `NODE_TOKEN_KEY` and never returned to the browser or sent to nodes. Leaving the token field blank retains it. Keep `NODE_TOKEN_KEY` backed up; changing it prevents decrypting saved connection credentials.

Each enabled node with the compatible updater advances setup on its regular poll. The central service creates a unique remotely managed tunnel, a per-node Access service token, a self-hosted Access application with a Service Auth policy, a loopback HTTP ingress route, and a proxied DNS record. Hostnames normally use `origin-NODE-ID.sargentweb.com` (very long node IDs are shortened with a hash). Resources use a unique saved name so interrupted creates can be reconciled. Existing DNS and Access applications belonging to another setup are not overwritten; resolve the conflict in Cloudflare and use **Retry setup**.

The node receives only its own tunnel token and generated gateway token. It stores the tunnel token in `/etc/farmservers/tunnel-token` with root-only permissions and runs cloudflared in a dedicated Docker Compose project, `farmservers-connection`. Cloudflared uses host networking to reach `http://127.0.0.1:PANEL_PORT`; the port comes from the enrolled updater configuration. It writes the gateway token to the node’s `.env` and recreates only the web control service. Failed health checks restore the previous gateway value. Running game containers are not restarted.

The website shows setup stages and errors. Once the connector is installed, the central service verifies the protected health endpoint and node identity before saving the active gateway in D1. Status becomes **Ready** only after that succeeds. Access service tokens are renewed within 30 days of expiry while automation remains enabled. Pausing stops setup and renewal, but does not remove resources or stop existing connections. Removing automated resources is a manual Cloudflare operation in this version.

For older nodes, existing D1 gateway settings or valid legacy `NODE_GATEWAYS` entries continue working until automation finishes. No shared JSON secret updates are required for new nodes. The gateway token is separate from the publishing token.

Troubleshooting: run `sudo journalctl -u farmservers-update.service -n 100 --no-pager` on the node. For the connector, use `sudo docker compose -p farmservers-connection -f /etc/farmservers/tunnel-compose.json logs --tail 100`. Confirm the node is running the new signed release, Docker can pull cloudflare/cloudflared, and the host can reach Cloudflare. After correcting a problem, use **Retry setup** on the Cloudflare page. Do not paste credentials into logs or support messages.

Implementation references: [Cloudflare tunnel API setup](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/get-started/create-remote-tunnel-api/), [service tokens](https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/service-tokens/), [cloudflared token files](https://developers.cloudflare.com/tunnel/advanced/run-parameters/#token-file).

## 6. Pilot acceptance checks

### Public HTTPS game panels and feed links

Team members open `https://farmservers.sargentweb.com`, sign in with Discord, and choose **Game admin** or **VNC console**. Each resource opens at its own HTTPS hostname under `*.farmservers.sargentweb.com`. These are internet-accessible proxy addresses; the underlying Docker IP and administrative ports remain private. Only administrators can open these panels from the dashboard; the public game admin address can then be shared with anyone who has the game's web login.

The proxy forwards the public hostname and HTTPS scheme to the game. It also rewrites GIANTS' embedded private-address XML, map-image and savegame links, including their displayed link text, to the current game-panel HTTPS origin. Feed codes, file choices and other query parameters are preserved. XML/images/downloaded files themselves are streamed unchanged. Unrelated external links are not rewritten.

Copied feed links still require the recipient's own active game-panel session: the recipient signs in and opens **Game admin** for that game first. They are not anonymous public feeds. Do not share the temporary `/_connect?ticket=...` launch URL; it is single-use. Do not bypass Cloudflare Access on a node origin to make a feed accessible.

Apply this proxy update by deploying the updated Worker and reloading node nginx after the new configuration is present:

```bash
sudo docker compose exec nginx nginx -t
sudo docker compose exec nginx nginx -s reload
```

No game-server restart is required for link rewriting. Tunnel routing, wildcard certificate coverage and the initial central setup must already be complete. Validate by opening Game admin through the central site, copying a feed URL, and confirming it begins with the same HTTPS host shown in the address bar. Opening the game directly by its old IP bypasses the rewrite.

References: [nginx proxy headers](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_set_header), [Cloudflare streaming HTML rewriting](https://developers.cloudflare.com/workers/runtime-apis/html-rewriter/).

- An unapproved Discord user cannot list nodes, history or open a console; viewers cannot run actions; staff cannot open node pages, management tabs or consoles.
- The initial admin sees actual host CPU/memory and each game server's samples, with history growing over time.
- Stopping the publisher marks the host offline within two minutes without deleting history.
- Operator start/stop/restart targets the intended instance; test with a spare server.
- Open Manage node, VNC console and Game admin. Test mouse, keyboard, reconnects and game-admin redirects. VNC still requires the instance VNC password.
- Demote the administrator while a console is open: new HTTP requests fail, active socket traffic ends within 15 seconds. Test viewer expiry as well.
- Direct node origins, raw VNC/noVNC and admin ports cannot bypass central access.
- Test panel file uploads/downloads. Cloudflare plan request-size and duration limits still apply; use SSH/SFTP for large installers and multi-GB transfers.
- Reboot the pilot host and check Tunnel, publisher, panel and game recovery before enrolling the remaining nodes.

## New Ubuntu servers, remote updates and rollback

Use the [site distribution guide](NODE-DISTRIBUTION.md), also available on the main site under **Setup & update guide**. It covers the two-command Ubuntu installation, adoption of existing nodes, signed release publishing, dashboard-triggered updates, backup/recovery and the acceptance gate before making GitHub private. The previous Git-tag updater is retained only as a legacy bridge path; migrated nodes use the root-owned systemd updater and authenticated site downloads.

## Reference documentation

- [Cloudflare Workers WebSockets](https://developers.cloudflare.com/workers/runtime-apis/websockets/)
- [Cloudflare Access service tokens](https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/service-tokens/)
- [Discord OAuth2](https://docs.discord.com/developers/topics/oauth2)
- [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/)
