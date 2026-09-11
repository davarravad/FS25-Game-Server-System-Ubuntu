# Game details on server cards

Server cards display the reported game version, players / capacity, and map alongside resource statistics. Missing or stale player counts display an em dash, never an assumed zero. The agent reads the instance's cached VERSION and game-generated server stats, falling back to the dedicated server XML feed. Feed tokens and player identities are not included in heartbeats.

Deploy the central app and rebuild/update the node agent to enable collection. No database migration is required. Older nodes continue displaying unavailable game details until updated.

If a runtime does not write a readable serverStats.xml or expose its stats code in dedicatedServerConfig.xml, set GAME_STATS_CODE in that instance's .env to the code shown on the game's web administration Settings page. The agent requests the feed inside the running container on its configured WEB_PORT. Keep this code private. Collection follows the node telemetry interval; the game itself may publish stats less frequently according to its Web Stats Interval setting.

The feed parser follows the Server version/mapName and Slots numUsed/capacity fields used by [GameDig's Farming Simulator implementation](https://github.com/gamedig/node-gamedig/blob/master/protocols/farmingsimulator.js). Real game feed availability must be verified on an updated node.
