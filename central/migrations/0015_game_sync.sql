CREATE TABLE game_inventory ( node_id TEXT PRIMARY KEY REFERENCES nodes(id) ON DELETE CASCADE, version TEXT, fingerprint TEXT, status TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '', updated INTEGER NOT NULL );
CREATE TABLE game_releases ( id TEXT PRIMARY KEY, source_node TEXT NOT NULL REFERENCES nodes(id), version TEXT NOT NULL, fingerprint TEXT NOT NULL, manifest_key TEXT NOT NULL, bytes INTEGER NOT NULL, dlcs TEXT NOT NULL DEFAULT '[]', created INTEGER NOT NULL, UNIQUE(source_node,manifest_key) );
CREATE TABLE game_policy (id INTEGER PRIMARY KEY CHECK(id=1), release_id TEXT REFERENCES game_releases(id), auto_bootstrap INTEGER NOT NULL DEFAULT 1);
INSERT INTO game_policy(id) VALUES(1);
CREATE TABLE game_jobs ( id TEXT PRIMARY KEY, node_id TEXT NOT NULL REFERENCES nodes(id), kind TEXT NOT NULL CHECK(kind IN ('publish','sync')), release_id TEXT REFERENCES game_releases(id), status TEXT NOT NULL DEFAULT 'queued', done_bytes INTEGER NOT NULL DEFAULT 0, total_bytes INTEGER NOT NULL DEFAULT 0, detail TEXT NOT NULL DEFAULT '', created INTEGER NOT NULL, updated INTEGER NOT NULL );
CREATE UNIQUE INDEX game_jobs_active ON game_jobs(node_id) WHERE status IN ('queued','running','waiting');
CREATE TABLE game_dlc_settings ( node_id TEXT NOT NULL REFERENCES nodes(id), instance_id TEXT NOT NULL, packages TEXT NOT NULL DEFAULT '[]', PRIMARY KEY(node_id,instance_id) );
