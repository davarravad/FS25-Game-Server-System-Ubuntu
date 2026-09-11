CREATE TABLE cloudflare_settings (id INTEGER PRIMARY KEY CHECK(id=1), encrypted TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 0);
CREATE TABLE node_connections (node_id TEXT PRIMARY KEY REFERENCES nodes(id), encrypted TEXT NOT NULL, stage TEXT NOT NULL DEFAULT 'tunnel', error TEXT, updated INTEGER NOT NULL, lease TEXT, lease_until INTEGER NOT NULL DEFAULT 0);
