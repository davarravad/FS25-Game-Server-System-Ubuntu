# Game details on server cards

Server cards display the reported game version, players / capacity, and map alongside resource statistics. Missing or stale player counts display an em dash, never an assumed zero. Cards show only what the game reports; the player limit and map entered at creation are first-start seeds kept on the node and are not displayed. Feed tokens, panel credentials and player identities are not included in heartbeats.

## Sources

1. **Game admin panel.** While the runtime container is running, the agent signs in to the dedicated server's web admin from inside the container, using the container's own web credentials, and reads the settings page. It reports the version shown there (for example `Farming Simulator 25 (1.23.1.0)`), the configured player slots and the map of the selected savegame. This works while the game itself is stopped and reflects the version the dedicated server really runs, so it takes precedence over the installation's cached VERSION file. The panel is polled at most every five minutes per server (every minute after a failed attempt); each poll creates a short-lived panel session.
2. **Server stats feed.** Game-generated server stats, falling back to the dedicated server XML feed, supply the live player count and map while the game is running.
3. **Cached VERSION file.** The instance's copy of the installation's VERSION file is the fallback when the container is not running.

Deploy the central app and rebuild/update the node agent to enable collection. No database migration is required. Older nodes continue displaying unavailable game details until updated.

If a runtime does not write a readable serverStats.xml or expose its stats code in dedicatedServerConfig.xml, set GAME_STATS_CODE in that instance's .env to the code shown on the game's web administration Settings page. The agent requests the feed inside the running container on its configured WEB_PORT. Keep this code private. Collection follows the node telemetry interval; the game itself may publish stats less frequently according to its Web Stats Interval setting.

The feed parser follows the Server version/mapName and Slots numUsed/capacity fields used by [GameDig's Farming Simulator implementation](https://github.com/gamedig/node-gamedig/blob/master/protocols/farmingsimulator.js). Real game feed availability must be verified on an updated node.
