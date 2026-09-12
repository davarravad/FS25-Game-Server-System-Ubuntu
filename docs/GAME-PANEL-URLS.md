# Game panel and console addresses

New launches provision individual Worker Custom Domains instead of relying on the missing `*.farmservers.sargentweb.com` DNS record. Addresses use `game-fs25-NNNN.sargentweb.com` and `console-fs25-NNNN.sargentweb.com`, where `fs25` identifies the game edition (Farming Simulator 25) and `NNNN` is a sequential ID assigned the first time a given node/instance pair is launched (`game_slots` table). The ID is stable for that server's lifetime, independent of its node or instance name. A future edition would get its own prefix (e.g. `fs27-`) rather than reusing `fs25-`.

Game admin opens a public URL without a dashboard session or expiring ticket. Share it with **Copy public game panel URL**. The game's own web login remains responsible for access to its administration controls. Public requests receive only the gateway permission needed for that instance's game web service; they do not receive a dashboard identity. Game cookies remain on the individual game's hostname.

VNC remains dashboard-admin-only, with one-use launch tickets and expiring sessions. Disabling a node or removing a server from its snapshot also disables its public endpoint. Existing legacy viewer links should be reopened from the dashboard.

## Rollout

1. Apply migrations `0016_game_endpoints.sql` and `0017_game_slot_ids.sql` along with any earlier pending migrations.
2. Deploy central with `npm run deploy`. The deploy wrapper reads registered game domains from D1 and preserves them in Wrangler's domain configuration. Do not deploy directly with `wrangler deploy`: it can remove dynamically provisioned domain bindings.
3. Update the node PHP and nginx services for the scoped public-web authorization header.
4. Grant the saved Cloudflare connection **Workers Scripts Write**, in addition to its existing DNS and zone permissions. OAuth connections need corresponding registered scopes and reconnection. First launch attaches the hostname to the `farmservers` Worker. Existing DNS records or domains belonging to another Worker are left untouched, with an actionable error.
5. Allow Cloudflare DNS/certificate provisioning to finish on first launch. Cloudflare publishes the custom domain's A and AAAA records on a lag that can run to a couple of minutes, and the two can appear at different times; until both exist the launch reports that DNS is still being created and the hostname is not handed to the browser, because a browser sent there early would cache NXDOMAIN for up to an hour. Retry the launch after a minute. Verify Game admin from a signed-out browser and VNC from the dashboard. Provisioning failures are shown on the dashboard instead of returning an unregistered hostname.

The setup uses Cloudflare's [Attach Domain API](https://developers.cloudflare.com/api/resources/workers/subresources/domains/methods/update/). Live DNS, certificate issuance, and the real game/VNC services require deployment validation.
