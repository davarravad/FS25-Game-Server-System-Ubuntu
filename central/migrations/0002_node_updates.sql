CREATE TABLE releases (version TEXT PRIMARY KEY, manifest TEXT NOT NULL, signature TEXT NOT NULL, object_key TEXT NOT NULL, created INTEGER NOT NULL);
CREATE TABLE node_updates (id TEXT PRIMARY KEY, node_id TEXT NOT NULL REFERENCES nodes(id), version TEXT NOT NULL REFERENCES releases(version), status TEXT NOT NULL CHECK(status IN ('queued','running','succeeded','failed')), created INTEGER NOT NULL, updated INTEGER NOT NULL);
CREATE UNIQUE INDEX one_active_update ON node_updates(node_id) WHERE status IN ('queued','running');
