CREATE TABLE cloudflare_oauth_client (id INTEGER PRIMARY KEY CHECK(id=1), encrypted TEXT NOT NULL);
CREATE TABLE cloudflare_oauth_states (hash TEXT PRIMARY KEY, session_hash TEXT NOT NULL, verifier TEXT NOT NULL, expires INTEGER NOT NULL);
CREATE TABLE cloudflare_oauth_tokens (id INTEGER PRIMARY KEY CHECK(id=1), encrypted TEXT NOT NULL, expires INTEGER NOT NULL, lease TEXT, lease_until INTEGER NOT NULL DEFAULT 0);
