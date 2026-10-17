CREATE TABLE roles (id TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT NOT NULL DEFAULT '#99aab5', position INTEGER NOT NULL DEFAULT 0, is_admin INTEGER NOT NULL DEFAULT 0 CHECK(is_admin IN (0,1)), permissions TEXT NOT NULL DEFAULT '[]', all_servers INTEGER NOT NULL DEFAULT 0 CHECK(all_servers IN (0,1)), servers TEXT NOT NULL DEFAULT '[]', created INTEGER NOT NULL);
CREATE UNIQUE INDEX roles_name ON roles(lower(name));
CREATE TABLE user_roles (user_id TEXT NOT NULL REFERENCES users(id), role_id TEXT NOT NULL REFERENCES roles(id), PRIMARY KEY(user_id,role_id));
CREATE INDEX user_roles_role ON user_roles(role_id);
CREATE TABLE access_requests (user_id TEXT PRIMARY KEY REFERENCES users(id), message TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','denied')), created INTEGER NOT NULL, updated INTEGER NOT NULL);
INSERT INTO roles(id,name,color,position,is_admin,permissions,all_servers,servers,created) VALUES ('admin','Admin','#e74c3c',0,1,'[]',1,'[]',strftime('%s','now')), ('game-server-team','Game Server Team','#47d8b0',1,0,'["servers.view","servers.control","servers.backend","servers.logs","servers.panel","servers.credentials"]',1,'[]',strftime('%s','now')), ('viewer','Viewer','#74b6ed',2,0,'["servers.view"]',1,'[]',strftime('%s','now'));
INSERT INTO user_roles(user_id,role_id) SELECT id,'admin' FROM users WHERE role='admin';
INSERT INTO user_roles(user_id,role_id) SELECT id,'game-server-team' FROM users WHERE role='operator';
INSERT INTO user_roles(user_id,role_id) SELECT id,'viewer' FROM users WHERE role='viewer';
