CREATE TABLE notification_reads (user_id TEXT NOT NULL REFERENCES users(id), notification_id TEXT NOT NULL, read_at INTEGER NOT NULL, PRIMARY KEY(user_id,notification_id));
