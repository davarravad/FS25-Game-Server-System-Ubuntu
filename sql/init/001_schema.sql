CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(100) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS managed_hosts (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(150) NOT NULL,
    agent_url VARCHAR(255) NOT NULL,
    access_host VARCHAR(255) NOT NULL DEFAULT '',
    agent_token VARCHAR(255) NOT NULL,
    shared_game_path VARCHAR(255) NOT NULL DEFAULT '/opt/fs25/game',
    shared_dlc_path VARCHAR(255) NOT NULL DEFAULT '/opt/fs25/dlc',
    shared_installer_path VARCHAR(255) NOT NULL DEFAULT '/opt/fs25/installer',
    is_enabled TINYINT(1) NOT NULL DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS server_instances (
    id INT AUTO_INCREMENT PRIMARY KEY,
    host_id INT NULL,
    instance_id VARCHAR(100) NOT NULL UNIQUE,
    server_name VARCHAR(255) NOT NULL,
    image_name VARCHAR(255) NOT NULL,
    server_port INT NOT NULL,
    web_port INT NOT NULL,
    tls_port INT NOT NULL DEFAULT 28000,
    vnc_port INT NOT NULL,
    novnc_port INT NOT NULL,
    sftp_port INT NOT NULL,
    sftp_username VARCHAR(100) NOT NULL,
    sftp_password VARCHAR(255) NOT NULL,
    web_username VARCHAR(100) NOT NULL DEFAULT 'admin',
    web_password VARCHAR(255) NOT NULL DEFAULT 'changeme',
    server_players INT NOT NULL DEFAULT 16,
    server_region VARCHAR(32) NOT NULL DEFAULT 'en',
    server_map VARCHAR(64) NOT NULL DEFAULT 'MapUS',
    status VARCHAR(32) NOT NULL DEFAULT 'created',
    INDEX idx_server_instances_host_id (host_id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
