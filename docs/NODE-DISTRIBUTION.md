# Install and update nodes from the main site

Main site: https://farmservers.sargentweb.com

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
4. Commit and review the bridge changes, then create its signed package from that commit:

   ```bash
   python3 scripts/package-release.py v1.0.0 --key /secure/location/farmservers-release.key --ref HEAD --output /secure/location/v1.0.0.json
   ```

   Use an unused version if v1.0.0 is already published. The packager reads COMMITTED files, not uncommitted edits. The package includes only application/runtime/scripts/templates/schema sources; game installations, saves, .env and private keys are excluded. Packages are limited to 24 MiB compressed and 128 MiB expanded. Inspect the reviewed source for secrets before signing. Game installers and container base images still come from their existing providers; the site hosts the node management software, not licensed game content or a Docker registry.
5. The command prints the public key and its SHA256 fingerprint. Save the fingerprint separately for node operators. Set the base64 public key (not private key) using `npx wrangler secret put RELEASE_PUBLIC_KEY` from `central/`. Keep using the same key for subsequent releases. Changing this Worker secret does not change keys pinned on existing nodes; key rotation requires an explicit maintenance procedure on every node.
6. Run `npm run types`, `npm run check`, `npm test`, `npm run db:remote`, then `npm run deploy`. The migration adds release inventory and update jobs. The build copies the bootstrap script and setup guides into site assets. The bootstrap is public; release archives require an enabled node token or an administrator session. Configure rate limits on `/api/distribution/*`; exempt authenticated machine polling/downloads from browser challenges. The release upload request is up to 34 MiB and must be allowed by your Cloudflare account limits.
7. Sign in as an administrator. Open **Node software & setup**, choose the signed JSON file, and click **Publish signed release**. Versions are immutable; publish a new version for any change. Invalid signatures or checksums are rejected. Keep the previous tested release available for recovery.

## New Ubuntu node: two commands

In **Access & nodes**, enroll a unique node ID and save its publishing token. On a fresh Ubuntu 24.04 LTS server with sudo and SSH key access:

```bash
sudo apt-get update && sudo apt-get install -y ca-certificates curl python3 openssl
curl --fail --show-error --silent --proto '=https' --tlsv1.2 https://farmservers.sargentweb.com/install.py -o /tmp/farmservers-install.py && sudo python3 /tmp/farmservers-install.py --install
```

The installer asks for the node ID, hidden token, signing-key trust confirmation and release version. Compare the displayed fingerprint with the maintainer's saved fingerprint before typing TRUST. Tokens are not placed in command arguments or shell history. The initial HTTPS bootstrap is a trust step: inspect the downloaded script when your procedure requires it. Future releases are checked against the pinned public key.

The installer creates `/opt/farmservers/node`, installs Docker from Docker's Ubuntu repository, generates unique local passwords, starts the node and publisher, and enables the systemd update timer. Administrative ports bind to loopback from the first start. Local recovery credentials are in the root-readable `.env`; the initial installer also displays them on the terminal. Keep terminal output private. The updater configuration is `/etc/farmservers/updater.json` (root only).

Finish the **Tunnel and Access for each node** section in /central-setup.txt. Use `/opt/farmservers/node/.env` for the generated CENTRAL_GATEWAY_TOKEN. Add the matching gateway and Access credentials to the Worker's NODE_GATEWAYS secret. This account-level Tunnel setup is still a one-time operation; the installer does not hold your Cloudflare administrator credentials. Install licensed game content using the node panel, then create a spare test game. Main-site Manage node, Game admin, VNC and server actions become available when the gateway is configured.

If the installer stops partway through, preserve the installation and .env, inspect the error and complete Docker startup using `cd /opt/farmservers/node && sudo docker compose --profile central up -d --build`. Then run the bootstrap with `--adopt /opt/farmservers/node`. The installer refuses to overwrite an existing installation or credentials.

## Existing nodes: the final GitHub bridge update

1. Publish and deploy the main-site changes and upload the bridge package BEFORE making GitHub private. Keep SSH recovery available. Back up game saves off-host, the panel database and .env.
2. Obtain the reviewed bridge commit while GitHub is still public using your existing checkout/update procedure. Do not run the fresh installer on existing nodes. Complete existing-node central enrollment in /central-setup.txt, including CENTRAL_MODE, loopback ports, publisher, Tunnel and Access. Preserve the existing Compose project name and volumes. Confirm the four control services (web, agent, nginx, publisher) are running.
3. Download the site bootstrap as above, then run:

   ```bash
   sudo python3 /tmp/farmservers-install.py --adopt /absolute/path/to/FS25-Game-Server-System-Ubuntu
   ```

   Use the same node ID/token as that node's publisher. Enter its existing panel port. Adoption discovers the running database's Compose project name so a new empty database volume is not created. It preserves the existing directory and .env; it enables the host updater without replacing game data.
4. Check `sudo systemctl status farmservers-update.timer` and `sudo journalctl -u farmservers-update.service -n 50`. Never copy the root updater configuration to another node. Token rotation requires updating BOTH the node's .env publisher credentials and `/etc/farmservers/updater.json`, followed by recreating the publisher. Disabling a node in the central API rejects its future polls/downloads; it cannot stop an update already executing on that host.
5. In **Node software & setup**, select the pilot node and bridge release, then click **Update selected node**. Verify success, node telemetry, node panel and a spare game's console. Restart the host in a maintenance window and recheck recovery. Repeat for every node. Only after every node passes, change GitHub repository visibility to Private under Settings → General → Danger Zone. Existing public clones remain public copies; visibility does not revoke them.

## Routine updates from the site

1. Review and test changes. Keep database migrations backward compatible. Package a new immutable version using the offline signing key.
2. Publish the signed JSON in **Node software & setup**. Upload and update actions require administrator approval and CSRF protection; operators/viewers cannot deploy root code.
3. Select one pilot node and release. Confirm the update. The outgoing timer claims it within about a minute when the host is reachable. Offline nodes retain a queued job until they return. Only one queued/running job is permitted per node. Cancel a queued job before the node claims it if needed. Running jobs cannot be cancelled from the site.
4. Follow the job list: queued → running → succeeded/failed. Success means the updater verified the archive, backed up the database/configuration, rebuilt the control services, validated nginx and observed the panel responding with all four services running. It does not replace game binaries, run schema upgrades, restart game instances or reboot Ubuntu. Control-panel sessions can disconnect briefly. The updater does not automatically apply a release merely because it was published.
5. Verify telemetry, game admin and VNC manually, then update other nodes one at a time. Avoid simultaneous panel edits while updating. A failed result requires inspection before another job is queued.

## Failure and recovery

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
