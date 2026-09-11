# Game library and node synchronization

The main site's **Game status** page manages the shared FS25 installation independently from node software releases. It uses existing node authentication, the private `RELEASES` R2 bucket under `game-library/`, and migration `0015_game_sync.sql`. Game binaries are never part of the public/signed node software archive.

## Operator workflow

1. Install or update the game normally on one source node. The runner reads the installation's `VERSION` file and hashes its game files. A newer version than the approved library version generates a notification.
2. On **Game status**, choose **Publish installed version** for that source. The node uploads verified 4 MiB chunks to the private library. The browser can close during the transfer.
3. Approve the published version. Approval changes the version offered to new nodes; it does not stop running servers or immediately update existing installations.
4. Choose **Sync other nodes**, or sync an individual node. Nodes download and verify files in the background, and wait until every container using that shared game directory is stopped before applying them.
5. With automatic preparation enabled, an empty new node requests the approved version on its first game inventory report. Once files are ready, **Create server** opens the normal creation form. Each server retains its own game and DLC license activation.

A source is a complete, coherent installation, rather than a merge of different game versions from multiple machines. Other nodes can later publish their versions. The library remains available even while the original source node is offline.

## DLC behavior

The library can include supported `FarmingSimulator25_<package>_<version>.exe` files from the source node's shared DLC folder. It excludes the separate base-game installer folder.

On Game status, expand **DLC to sync per server** and match the DLC enabled in each server's game admin. Save selections, then sync that node. Only the union of selected packages is copied into its shared DLC folder. Each server receives a `.farmservers-enabled-dlcs` list in its profile so the updated runtime installs only its selected packages. Selections control distribution/installation; they do not change in-game enablement, transfer license files, or uninstall previously installed DLC. New nodes without servers receive only the base game. Configure their DLC selections after creating a server, then sync again.

DLC packages must be present in the approved source's shared DLC folder when it publishes. Publishing the same base-game version with additional DLC creates a separate library entry. Approve that entry to expose the new choices.

## Rollout

- Apply central migration `0015_game_sync.sql` before deploying this Worker and its assets.
- Publish a signed node software release containing `scripts/game-sync.py`, the updated node manager, agent, and runtime sources. Deploy it to existing nodes through the normal node update workflow.
- The updated node manager installs `farmservers-game-sync.service` and its timer on its next poll; fresh node installations install them during setup. The timer runs about once a minute when no transfer is running.
- Rebuild/recreate existing game runtime containers with the updated runtime before relying on per-server DLC filtering. Existing old images do not understand the new selection file. Fresh runtime builds include it. The game-file sync itself never stops or restarts game containers.
- Pilot publication and synchronization on a stopped test node before using **Sync other nodes** on the fleet. Local automated tests do not exercise real Ubuntu systemd, Docker/Wine startup, vendor license activation, or large WAN transfers.

## Transfer safety and recovery

- Node tokens are checked against enabled nodes on every request. Dashboard operations require an administrator session and the existing CSRF check. A node can only update its own active job or download its assigned source library.
- Each chunk is SHA-256 checked at upload and download. Downloaded chunks resume from local staging after an interruption. Staging and rollback backups require additional disk space; the runner checks free space before downloading.
- Files are staged outside the live game directory. A shared lock with the agent prevents create/start/configuration operations during application. All containers mounting the game directory must be stopped. A marker prevents startup over an interrupted apply; the next timer run restores the rollback journal before continuing.
- Per-file replacements are atomic. A failed apply restores previous files from its local backup. An interrupted successful result report is retried without reapplying the installation.
- Numeric per-server directories, launchers, saves, mods, game configuration, environment files and node TLS credentials are excluded from publication. Destination files not in the library are retained. Fresh nodes generate their own TLS certificate/key.
- Staging, completion journals and backups are retained under `/var/lib/farmservers-game-sync`; R2 library versions/chunks are also retained. This version does not prune that storage automatically. Account for game-library storage and transfer usage when planning capacity.

Inspect progress and errors on Game status. For local diagnosis:

```sh
sudo systemctl status farmservers-game-sync.timer farmservers-game-sync.service
sudo journalctl -u farmservers-game-sync.service -n 100
```

A failed job can be retried with the relevant Publish or Sync button. Network interruptions keep the active job resumable. A node that remains offline keeps its queued work until it reconnects. Do not manually remove an in-progress marker or rollback journal while an apply or recovery is running.
