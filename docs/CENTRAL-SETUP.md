# Central fleet management

Production address: **https://farmservers.sargentweb.com**. Discord application: `1547412664068866159`. Initial administrator: `513527870258151439`.

The implementation is in `central/`. Deployment and an end-to-end pilot on an Ubuntu node are required before production use. Repository visibility, Discord secrets, Tunnel configuration and wildcard certificates are separate account setup steps; source changes alone do not configure them.

## Architecture and access

The Worker serves the dashboard, handles Discord OAuth, checks approved users on each request, and stores node inventory and 30 days of metrics in D1. Each Ubuntu publisher sends an outgoing heartbeat every 30 seconds with a separate revocable token. Passwords, agent tokens, filesystem paths and configuration files are excluded from snapshots. Offline hosts retain their last values and history; missing values are not zeroes.

Roles: only administrators and staff (stored as the operator role) can access the website, setup guides and fleet data. Signed-out users receive only the sign-in screen; pending and legacy viewer accounts remain blocked. Operators can control servers and open full node panels, VNC and game-admin pages; administrators can additionally approve users and enroll/disable nodes. Operators have broad administrative power through the full node panel. Do not approve someone as staff unless they should be able to edit files, credentials and hosts. The legacy viewer role no longer grants site access. There is no per-node user permission model in this version.

Interactive access runs through a Cloudflare Tunnel and Access **Service Auth** policy. The Worker holds that service token and a separate node gateway secret. It creates single-use 60-second viewer tickets, then a 15-minute session on a separate hostname for each node/resource. Viewer sessions depend on a valid central session and current operator approval. Active WebSocket traffic checks revocation at most every 15 seconds and stops forwarding after viewer expiry. Open a new console after expiry. Cookies for the central panel are host-only and never sent to a node or game server.

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

The main hostname uses a Workers custom domain. Viewer hosts use `*.farmservers.sargentweb.com`, routed to this Worker by the wildcard route in `wrangler.jsonc`. Create a proxied wildcard DNS record for this viewer hostname and provision an edge certificate covering it. **Ordinary Universal SSL for `sargentweb.com` does not cover these extra-level viewer names.** Use an appropriate Advanced Certificate/Total TLS setup and verify certificate coverage before launching consoles. Do not deploy a wildcard route over unrelated `sargentweb.com` applications.

```bash
npm run types
npm run check
npm test
npm run build
npm run db:remote
npx wrangler secret put DISCORD_CLIENT_SECRET
npx wrangler secret put NODE_GATEWAYS
npm run deploy
```

`secret put` prompts securely for each value. Start `NODE_GATEWAYS` with `{}` if only testing the dashboard; remote actions will fail closed until nodes are configured. Configure WAF/rate limits for `/auth/*` and `/api/*` according to expected usage before public rollout. Keep OAuth callback and heartbeat requests reachable; do not require a browser challenge for node heartbeats.

Sign in as the initial administrator. Other users sign in once to create a pending request; approve them under Access & nodes. Role changes revoke their existing sessions, so they must sign in again.

## 4. Enroll an existing Ubuntu node

Back up `.env`, the panel database and game saves first. Update one pilot node before the other two. In the central dashboard, enroll a unique ID such as `node-1` and copy its one-time publishing token. Re-enrolling an ID rotates its token.

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

Setting `CENTRAL_MODE=1` changes **newly rendered** game configurations to bind VNC, noVNC, game web/admin and SFTP published ports to loopback, and attaches the game service to the management Docker network. Existing running containers retain their old bindings until their configuration is synchronized and the container is recreated. Schedule a maintenance window and restart each server through the panel to apply the new configuration. This interrupts that server's players. Check `docker port INSTANCE_ID`: administrative ports must show `127.0.0.1`, while game ports remain public. Docker port publishing can bypass UFW; verify from another computer that administrative ports are inaccessible directly. Use Docker Engine 28 or newer for loopback-publishing protections.

The local panel is still available through SSH forwarding for recovery:

```bash
ssh -L 8080:127.0.0.1:8080 davar@YOUR_NODE
```

Browse `http://localhost:8080`. Adjust the port if `PANEL_PORT` differs. Native SFTP remains available over an SSH port forward; it is not browser WebSocket traffic.

## 5. Tunnel and Access for each node

Create a remotely managed Cloudflare Tunnel for each Ubuntu machine. Install `cloudflared` using Cloudflare's current Ubuntu instructions and the tunnel's locally entered service token. Run it on the host. Publish a unique origin such as `origin-node-1.sargentweb.com` pointing to `http://127.0.0.1:8080` (match the node's panel port).

Protect that entire origin with a Cloudflare Access self-hosted application. Create a distinct Access service token for the node and a **Service Auth** policy including only that token. Do not add Bypass or Everyone policies. Test that direct origin requests without the token are denied, including WebSocket upgrades.

Update the Worker `NODE_GATEWAYS` secret with a JSON object containing every node (updating the secret replaces the whole value):

```json
{
  "node-1": {
    "origin": "https://origin-node-1.sargentweb.com",
    "token": "same-64-hex-value-as-node-CENTRAL_GATEWAY_TOKEN",
    "accessClientId": "node-access-service-token-client-id",
    "accessClientSecret": "node-access-service-token-secret"
  }
}
```

Repeat for node-2 and node-3. Do not store this JSON in a tracked file. Use `npx wrangler secret put NODE_GATEWAYS` from `central/`.

## 6. Pilot acceptance checks

### Public HTTPS game panels and feed links

Team members open `https://farmservers.sargentweb.com`, sign in with Discord, and choose **Game admin** or **VNC console**. Each resource opens at its own HTTPS hostname under `*.farmservers.sargentweb.com`. These are internet-accessible proxy addresses; the underlying Docker IP and administrative ports remain private. Operators and administrators can open these panels. A viewer role grants dashboard access only.

The proxy forwards the public hostname and HTTPS scheme to the game. It also rewrites GIANTS' embedded private-address XML, map-image and savegame links, including their displayed link text, to the current game-panel HTTPS origin. Feed codes, file choices and other query parameters are preserved. XML/images/downloaded files themselves are streamed unchanged. Unrelated external links are not rewritten.

Copied feed links still require the recipient's own active game-panel session: the recipient signs in and opens **Game admin** for that game first. They are not anonymous public feeds. Do not share the temporary `/_connect?ticket=...` launch URL; it is single-use. Do not bypass Cloudflare Access on a node origin to make a feed accessible.

Apply this proxy update by deploying the updated Worker and reloading node nginx after the new configuration is present:

```bash
sudo docker compose exec nginx nginx -t
sudo docker compose exec nginx nginx -s reload
```

No game-server restart is required for link rewriting. Tunnel routing, wildcard certificate coverage and the initial central setup must already be complete. Validate by opening Game admin through the central site, copying a feed URL, and confirming it begins with the same HTTPS host shown in the address bar. Opening the game directly by its old IP bypasses the rewrite.

References: [nginx proxy headers](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_set_header), [Cloudflare streaming HTML rewriting](https://developers.cloudflare.com/workers/runtime-apis/html-rewriter/).

- An unapproved Discord user cannot list nodes, history or open a console; viewers cannot run actions.
- The initial admin sees actual host CPU/memory and each game server's samples, with history growing over time.
- Stopping the publisher marks the host offline within two minutes without deleting history.
- Operator start/stop/restart targets the intended instance; test with a spare server.
- Open Manage node, VNC console and Game admin. Test mouse, keyboard, reconnects and game-admin redirects. VNC still requires the instance VNC password.
- Revoke the operator while a console is open: new HTTP requests fail, active socket traffic ends within 15 seconds. Test viewer expiry as well.
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
