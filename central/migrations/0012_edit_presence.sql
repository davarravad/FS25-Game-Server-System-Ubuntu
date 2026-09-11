CREATE TABLE edit_presence (session_hash TEXT PRIMARY KEY REFERENCES sessions(hash) ON DELETE CASCADE, resource TEXT NOT NULL, expires INTEGER NOT NULL);
CREATE INDEX edit_presence_resource ON edit_presence(resource, expires);
