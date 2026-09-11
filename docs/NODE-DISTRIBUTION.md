# Install and update nodes from the main site

Main site: https://farmservers.sargentweb.com

## Manage nodes and game servers

Updated nodes use the main site for all management. Open a node for Host settings,
Create game server, Shared files, Export & access and the Operator guide. Open a
game server for Settings, Files, Logs & containers and Maintenance (including
reinstall and delete). Game admin and VNC remain authenticated tunnel viewers.
The old node login/control panel is retired; its backend services remain necessary.
Install the latest published node release before using these management pages.
See [the feature inventory](MAIN-SITE-MANAGEMENT.md) in the project documentation.

This release replaces node-side GitHub access with authenticated downloads from the main site. GitHub can become private AFTER the final bridge release is published and every existing node is enrolled, running the update timer, and has completed a pilot site update. Do not change visibility first. No GitHub deploy keys or personal access tokens are needed on migrated nodes.

## One-time main-site setup (release maintainer)

1. Follow the Discord, Worker, D1, Tunnel and Access setup in [Central setup](CENTRAL-SETUP.md). The website serves a copy at /central-setup.txt. Existing deployments keep their existing database and secrets.
2. From `central/`, run `npm ci`. Create a PRIVATE R2 bucket with `npx wrangler r2 bucket create farmservers-releases` (skip if it exists). Do not enable public R2 access. The Worker streams authenticated downloads through its RELEASES binding.
3. On a trusted release workstation with Git, Python 3 and OpenSSL, create the release key OUTSIDE this repository:

   ```bash
   umask 077
   openssl genpkey -algorithm ED25519 -out /secure/location/farmservers-release.key
   ```

   Back up this private key securely and offline. Never upload it to the site, GitHub, or a game node. Possession permits signing code that runs as root on your nodes.
4. Keep the existing signing key for subsequent releases. Set the base64 public key (not the private key) in the Worker's RELEASE_PUBLIC_KEY secret for a new deployment only. Existing nodes pin this key; do not replace it during normal updates.
5. Set FARMSERVERS_RELEASE_KEY to the private PEM key path on the release workstation. On this Windows workstation the default is ~/Documents/Farmservers-Releases/farmservers-release.key. The private key stays local.
6. From central/, run:

   ```bash
   npm run deploy:all
   ```

   This checks and tests the website, applies database migrations, deploys it, then signs and publishes the current node application to private R2 and the release inventory. Publication verifies the key against the live site, verifies the uploaded archive checksum, and allocates the next unused patch version. Unchanged node source reuses the latest available release. It never queues updates on nodes automatically.

   The publisher snapshots the current allowed application files, including saved uncommitted changes, without changing your Git index or branch. Review changes before deploying. Git-ignored files are excluded and private/generated file paths are rejected. The signed manifest records both the base commit and the exact source tree. Only app, docker, templates, sql, scripts, .env.example, docker-compose.yml and LICENSE are included. Game installations and saves outside these source paths are not packaged. Limits are 12 MiB compressed and 128 MiB expanded.

   For a publication retry without redeploying, use `npm run release:publish`. An upload failure leaves the prior release available; a version collision fails without overwriting the other release. Keep the previous tested release for recovery.
7. Sign in as an administrator, open **Server Nodes**, select a node, and use **Node software** on its Overview tab to update it and follow progress. **Node updates** (under Setup & Update) provides fleet-wide update controls and release withdrawal. There is no release upload form.

## New Ubuntu node: two commands

In **Server Nodes**, create a unique node ID, then copy its publishing token from the node's **Connection & access** tab. On a fresh Ubuntu 24.04 LTS server with sudo and SSH key access:

```bash
sudo apt-get update && sudo apt-get install -y ca-certificates curl python3 openssl
curl --fail --show-error --silent --proto '=https' --tlsv1.2 https://farmservers.sargentweb.com/install.py -o /tmp/farmservers-install.py && sudo python3 /tmp/farmservers-install.py --install
```

The installer asks for the node ID, hidden token, signing-key trust confirmation and release version. Compare the displayed fingerprint with the maintainer's saved fingerprint before typing TRUST. Tokens are not placed in command arguments or shell history. The initial HTTPS bootstrap is a trust step: inspect the downloaded script when your procedure requires it. Future releases are checked against the pinned public key.

The installer creates `/opt/farmservers/node`, installs Docker from Docker's Ubuntu repository, generates unique local passwords, starts the node and publisher, and enables the systemd update timer. Administrative ports bind to loopback from the first start. Local recovery credentials are in the root-readable `.env`; the initial installer also displays them on the terminal. Keep terminal output private. The updater configuration is `/etc/farmservers/updater.json` (root only).

Enable automatic node connections on the administrator-only Cloudflare page. Use a signed release containing connection automation. The node updater installs the connector and gateway token; the site creates the tunnel, DNS and Access credentials and verifies the connection. No NODE_GATEWAYS JSON editing is required. Install licensed game content using the node panel, then create a spare test game. Main-site management becomes available when connection status is Ready.

If the installer stops partway through, preserve the installation and .env, inspect the error and complete Docker startup using `cd /opt/farmservers/node && sudo docker compose --profile central up -d --build`. Then run the bootstrap with `--adopt /opt/farmservers/node`. The installer refuses to overwrite an existing installation or credentials.

## Existing nodes: the final GitHub bridge update

1. Publish and deploy the main-site changes and publish the bridge release BEFORE making GitHub private. Keep SSH recovery available. Back up game saves off-host, the panel database and .env.
2. Obtain the reviewed bridge commit while GitHub is still public using your existing checkout/update procedure. Do not run the fresh installer on existing nodes. Complete existing-node central enrollment in /central-setup.txt, including CENTRAL_MODE, loopback ports, publisher, Tunnel and Access. Preserve the existing Compose project name and volumes. Confirm the four control services (web, agent, nginx, publisher) are running.
3. Download the site bootstrap as above, then run:

   ```bash
   sudo python3 /tmp/farmservers-install.py --adopt /absolute/path/to/FS25-Game-Server-System-Ubuntu
   ```

   Use the same node ID/token as that node's publisher. Enter its existing panel port. Adoption discovers the running database's Compose project name so a new empty database volume is not created. It preserves the existing directory and .env; it enables the host updater without replacing game data.
4. Check `sudo systemctl status farmservers-update.timer` and `sudo journalctl -u farmservers-update.service -n 50`. Never copy the root updater configuration to another node. Token rotation requires updating BOTH the node's .env publisher credentials and `/etc/farmservers/updater.json`, followed by recreating the publisher. Disabling a node in the central API rejects its future polls/downloads; it cannot stop an update already executing on that host.
5. On **Node updates**, select the pilot node and bridge release, then click **Update selected node**. Verify success, node telemetry, node panel and a spare game's console. Restart the host in a maintenance window and recheck recovery. Repeat for every node. Only after every node passes, change GitHub repository visibility to Private under Settings → General → Danger Zone. Existing public clones remain public copies; visibility does not revoke them.

## Routine updates from the site

1. Review and test changes. Keep database migrations backward compatible. Run `npm --prefix central run deploy:all` on the release workstation to deploy the website and publish changed node source as a signed, immutable release.
2. Open the node's **Node software** section or **Node updates**. Starting node updates requires an administrator session and CSRF protection; operators/viewers cannot deploy root code.
3. Select one pilot node and release. Confirm the update. The outgoing timer claims it within about a minute when the host is reachable. Offline nodes retain a queued job until they return. Only one queued/running job is permitted per node. Cancel a queued job before the node claims it if needed. Running jobs cannot be cancelled from the site.
4. Follow the job list: queued → running → succeeded/failed. Success means the updater verified the archive, backed up the database/configuration, rebuilt the control services, validated nginx and observed the panel responding with all four services running. It does not replace game binaries, run schema upgrades, restart game instances or reboot Ubuntu. Control-panel sessions can disconnect briefly. The updater does not automatically apply a release merely because it was published.
5. Verify telemetry, game admin and VNC manually, then update other nodes one at a time. Avoid simultaneous panel edits while updating. A failed result requires inspection before another job is queued.

## Failure and recovery

If a published release has a problem, select it on **Node updates** and click **Withdraw selected release**. This blocks new downloads, fails queued jobs, and preserves the version record so it cannot be overwritten. An update already executing may finish. Publish corrections as a new version. The initial v1.0.0 pilot was withdrawn before any node enrollment; use v1.0.1 or a newer approved release.

The updater and publisher identify themselves as `Farmservers-Node/1.0`. This is required for compatibility with the site's Browser Integrity Check; Python's default identifier receives Cloudflare error 1010. Keep the explicit client identifier when extending these tools. Do not disable zone-wide security protections to work around client configuration.

Backups are root-only under `/var/backups/farmservers/JOB-ID`: node.env, panel.sql, previous versions of overwritten source files, file inventory and image references. The updater preserves old images with local backup tags. Take separate off-host backups of game saves and databases; local update backups are not disaster recovery. Retain backups until a release is accepted, then prune intentionally to avoid filling disk.

A normal apply failure restores overwritten source and previous control images and recreates control services. Database contents are not automatically rolled back. The source bundle cannot contain .env or saves. Removed upstream source files remain on disk; releases requiring source deletion or incompatible database changes need a reviewed maintenance procedure.

A power loss during apply can leave a partial update. On the next poll, the local job journal reports failure rather than repeating root execution. If a result cannot reach the site, subsequent polls resend it. A permanently offline host may remain running in the job list until it reconnects; do not assume it succeeded. Inspect SSH logs and the backup directory before recovery. No automatic retry of a failed job occurs.

For emergency source recovery, stop `farmservers-update.timer`, use files.json to restore each previous file from backup/source and remove only files explicitly marked false (newly introduced by that update). Restore image tags using images.json (`docker tag OLD_IMAGE_ID ORIGINAL_TAG` for each pair), then run `docker compose --profile central up -d --no-build --no-deps --force-recreate web agent nginx publisher` from the same node directory with its original `-p PROJECT`. Do not run `down -v`. Check local panel/telemetry before restarting the timer. Restore panel.sql only for an explicitly planned incompatible database recovery, with application writes stopped and a fresh backup first.

## Pilot checklist before making GitHub private

- Unsigned/tampered uploads and wrong node tokens are rejected.
- A disabled node cannot fetch a release or claim work.
- A viewer/operator cannot publish or queue updates.
- A fresh Ubuntu pilot installs from the site and survives reboot.
- An existing node retains its database, .env, saves and Compose project during adoption and update.
- A test update succeeds; game uptime remains unchanged.
- A deliberately failing control build restores the previous application.
- A lost result connection does not run the job twice.
- Every production node has completed a site update before GitHub becomes private.

Cloudflare references: https://developers.cloudflare.com/r2/api/workers/workers-api-reference/ and https://developers.cloudflare.com/workers/best-practices/workers-best-practices/
