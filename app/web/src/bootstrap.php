<?php

declare(strict_types=1);

session_start();

function env_value(string $key, ?string $default = null): ?string
{
    $value = getenv($key);
    return $value === false ? $default : $value;
}

function slugify(string $value): string
{
    $slug = strtolower(trim(preg_replace('/[^a-zA-Z0-9]+/', '-', $value) ?? '', '-'));
    return $slug !== '' ? $slug : 'fs25-node';
}

function db(): PDO
{
    static $pdo = null;

    if ($pdo instanceof PDO) {
        return $pdo;
    }

    $dsn = sprintf(
        'mysql:host=%s;port=%s;dbname=%s;charset=utf8mb4',
        env_value('DB_HOST', 'db'),
        env_value('DB_PORT', '3306'),
        env_value('DB_NAME', 'fsg_panel')
    );

    $pdo = new PDO($dsn, env_value('DB_USER', 'fsg_panel'), env_value('DB_PASSWORD', ''), [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]);

    ensure_schema($pdo);
    bootstrap_default_admin($pdo);
    bootstrap_default_host($pdo);

    return $pdo;
}

function ensure_schema(PDO $pdo): void
{
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS managed_hosts (
            id INT AUTO_INCREMENT PRIMARY KEY,
            name VARCHAR(150) NOT NULL,
            agent_url VARCHAR(255) NOT NULL,
            agent_token VARCHAR(255) NOT NULL,
            shared_game_path VARCHAR(255) NOT NULL DEFAULT '/opt/fs25/game',
            shared_dlc_path VARCHAR(255) NOT NULL DEFAULT '/opt/fs25/dlc',
            shared_installer_path VARCHAR(255) NOT NULL DEFAULT '/opt/fs25/installer',
            is_enabled TINYINT(1) NOT NULL DEFAULT 1,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )
    ");

    $pdo->exec("ALTER TABLE managed_hosts ADD COLUMN IF NOT EXISTS shared_game_path VARCHAR(255) NOT NULL DEFAULT '/opt/fs25/game' AFTER agent_token");
    $pdo->exec("ALTER TABLE managed_hosts ADD COLUMN IF NOT EXISTS shared_dlc_path VARCHAR(255) NOT NULL DEFAULT '/opt/fs25/dlc' AFTER shared_game_path");
    $pdo->exec("ALTER TABLE managed_hosts ADD COLUMN IF NOT EXISTS shared_installer_path VARCHAR(255) NOT NULL DEFAULT '/opt/fs25/installer' AFTER shared_dlc_path");
    $pdo->exec('ALTER TABLE server_instances ADD COLUMN IF NOT EXISTS host_id INT NULL AFTER id');
    $pdo->exec('ALTER TABLE server_instances ADD COLUMN IF NOT EXISTS sftp_port INT NOT NULL DEFAULT 2222 AFTER novnc_port');
    $pdo->exec("ALTER TABLE server_instances ADD COLUMN IF NOT EXISTS sftp_username VARCHAR(100) NOT NULL DEFAULT 'fs25' AFTER sftp_port");
    $pdo->exec("ALTER TABLE server_instances ADD COLUMN IF NOT EXISTS sftp_password VARCHAR(255) NOT NULL DEFAULT 'changeme' AFTER sftp_username");
    $pdo->exec('ALTER TABLE server_instances ADD INDEX IF NOT EXISTS idx_server_instances_host_id (host_id)');
}

function bootstrap_default_admin(PDO $pdo): void
{
    $username = env_value('ADMIN_DEFAULT_USERNAME', 'admin');
    $password = env_value('ADMIN_DEFAULT_PASSWORD', 'ChangeMeNow!');

    $stmt = $pdo->prepare('SELECT id FROM users WHERE username = ? LIMIT 1');
    $stmt->execute([$username]);

    if (!$stmt->fetch()) {
        $insert = $pdo->prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)');
        $insert->execute([$username, password_hash($password, PASSWORD_DEFAULT)]);
    }
}

function bootstrap_default_host(PDO $pdo): void
{
    $agentUrl = trim((string) env_value('AGENT_URL', 'http://agent:8081'));
    $agentToken = (string) env_value('AGENT_SHARED_TOKEN', '');
    $defaultName = trim((string) env_value('DEFAULT_HOST_NAME', 'Local Agent'));
    $sharedGamePath = trim((string) env_value('SHARED_GAME_PATH', '/opt/fs25/game'));
    $sharedDlcPath = trim((string) env_value('SHARED_DLC_PATH', '/opt/fs25/dlc'));
    $sharedInstallerPath = trim((string) env_value('SHARED_INSTALLER_PATH', '/opt/fs25/installer'));

    $stmt = $pdo->query('SELECT id FROM managed_hosts ORDER BY id ASC LIMIT 1');
    $firstHostId = $stmt->fetchColumn();

    if (!$firstHostId) {
        $insert = $pdo->prepare('
            INSERT INTO managed_hosts (name, agent_url, agent_token, shared_game_path, shared_dlc_path, shared_installer_path, is_enabled)
            VALUES (?, ?, ?, ?, ?, ?, 1)
        ');
        $insert->execute([$defaultName, $agentUrl, $agentToken, $sharedGamePath, $sharedDlcPath, $sharedInstallerPath]);
        $firstHostId = (int) $pdo->lastInsertId();
    }

    $pdo->prepare('UPDATE server_instances SET host_id = ? WHERE host_id IS NULL')->execute([(int) $firstHostId]);
}

function local_node_config(): array
{
    $nodeName = trim((string) env_value('NODE_NAME', env_value('DEFAULT_HOST_NAME', 'FS25 Local Node')));
    $appUrl = rtrim((string) env_value('APP_URL', 'http://localhost:8080'), '/');
    $appParts = parse_url($appUrl);
    $appHost = is_array($appParts) && !empty($appParts['host']) ? (string) $appParts['host'] : 'localhost';

    return [
        'name' => $nodeName,
        'slug' => slugify((string) env_value('NODE_SLUG', $nodeName)),
        'app_url' => $appUrl,
        'admin_sftp_host' => $appHost,
        'admin_sftp_port' => (string) env_value('ADMIN_SFTP_PORT', '22220'),
        'admin_sftp_username' => (string) env_value('ADMIN_SFTP_USERNAME', 'paneladmin'),
        'admin_sftp_password' => (string) env_value('ADMIN_SFTP_PASSWORD', ''),
        'admin_sftp_root' => 'panel',
        'admin_sftp_opt_path' => 'panel/opt',
        'api_status_url' => $appUrl . '/?route=api_node_status',
        'api_servers_url' => $appUrl . '/?route=api_node_servers',
        'api_hosts_url' => $appUrl . '/?route=api_node_hosts',
    ];
}

function local_host_record(): ?array
{
    $stmt = db()->query('SELECT * FROM managed_hosts ORDER BY id ASC LIMIT 1');
    $host = $stmt->fetch();
    return $host ?: null;
}

function node_api_token(): string
{
    return (string) env_value('NODE_API_TOKEN', '');
}

function node_api_enabled(): bool
{
    return node_api_token() !== '';
}

function request_header_value(string $key): ?string
{
    $serverKey = 'HTTP_' . strtoupper(str_replace('-', '_', $key));
    $value = $_SERVER[$serverKey] ?? null;
    return is_string($value) && $value !== '' ? $value : null;
}

function node_api_request_authorized(): bool
{
    $expected = node_api_token();
    if ($expected === '') {
        return false;
    }

    $authHeader = request_header_value('Authorization');
    $token = null;

    if (is_string($authHeader) && preg_match('/^Bearer\s+(.+)$/i', $authHeader, $matches)) {
        $token = trim($matches[1]);
    }

    if ($token === null || $token === '') {
        $token = trim((string) (request_header_value('X-Node-Token') ?? ''));
    }

    return $token !== '' && hash_equals($expected, $token);
}

function node_summary(): array
{
    $hostCount = (int) db()->query('SELECT COUNT(*) FROM managed_hosts')->fetchColumn();
    $serverCount = (int) db()->query('SELECT COUNT(*) FROM server_instances')->fetchColumn();
    $localHost = local_host_record();
    $localHostHealth = $localHost ? agent_health_for_host($localHost) : ['ok' => false, 'error' => 'No local host'];

    return [
        'node' => local_node_config(),
        'local_host' => $localHost ? [
            'id' => (int) $localHost['id'],
            'name' => (string) $localHost['name'],
            'agent_url' => (string) $localHost['agent_url'],
            'shared_game_path' => (string) ($localHost['shared_game_path'] ?? '/opt/fs25/game'),
            'shared_dlc_path' => (string) ($localHost['shared_dlc_path'] ?? '/opt/fs25/dlc'),
            'shared_installer_path' => (string) ($localHost['shared_installer_path'] ?? '/opt/fs25/installer'),
            'health' => $localHostHealth,
        ] : null,
        'counts' => [
            'managed_hosts' => $hostCount,
            'server_instances' => $serverCount,
        ],
    ];
}

function random_string_from_charset(string $charset, int $length): string
{
    $maxIndex = strlen($charset) - 1;
    $result = '';

    for ($i = 0; $i < $length; $i++) {
        $result .= $charset[random_int(0, $maxIndex)];
    }

    return $result;
}

function generate_game_password(int $length = 10): string
{
    return random_string_from_charset('abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', $length);
}

function generate_secure_password(int $length = 20): string
{
    return random_string_from_charset('abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()-_=+', $length);
}

function next_instance_sequence(): int
{
    $rows = db()->query('SELECT instance_id FROM server_instances ORDER BY id ASC')->fetchAll();
    $max = 0;

    foreach ($rows as $row) {
        $instanceId = (string) ($row['instance_id'] ?? '');
        if (preg_match('/(\d+)(?!.*\d)/', $instanceId, $matches)) {
            $max = max($max, (int) $matches[1]);
        }
    }

    return $max + 1;
}

function next_available_port(string $field, int $basePort): int
{
    $allowedFields = ['server_port', 'web_port', 'vnc_port', 'novnc_port', 'sftp_port'];
    if (!in_array($field, $allowedFields, true)) {
        return $basePort;
    }

    $maxPort = (int) db()->query("SELECT COALESCE(MAX({$field}), 0) FROM server_instances")->fetchColumn();
    return max($basePort, $maxPort + 1);
}

function suggested_create_defaults(): array
{
    $sequence = next_instance_sequence();

    return [
        'instance_id' => sprintf('fs25-%04d', $sequence),
        'server_name' => sprintf('FSG Server %d', $sequence),
        'image_name' => 'toetje585/arch-fs25server:latest',
        'server_players' => 16,
        'server_port' => next_available_port('server_port', 10823),
        'web_port' => next_available_port('web_port', 18000),
        'vnc_port' => next_available_port('vnc_port', 5900),
        'novnc_port' => next_available_port('novnc_port', 6080),
        'sftp_port' => next_available_port('sftp_port', 2222),
        'server_password' => generate_game_password(),
        'server_admin' => generate_game_password(),
        'web_username' => 'admin',
        'web_password' => generate_secure_password(),
        'sftp_username' => 'fs25',
        'sftp_password' => generate_secure_password(),
        'vnc_password' => generate_secure_password(),
        'server_region' => 'en',
        'server_map' => 'MapUS',
        'server_difficulty' => 3,
        'server_pause' => 2,
        'server_save_interval' => 180,
        'server_stats_interval' => 31536000,
        'puid' => 1000,
        'pgid' => 1000,
        'autostart_server' => 'true',
    ];
}

function find_port_conflicts(array $ports, ?string $excludeInstanceId = null): array
{
    $fields = [
        'server_port' => 'Game Port',
        'web_port' => 'Admin Web Port',
        'vnc_port' => 'VNC Port',
        'novnc_port' => 'noVNC Port',
        'sftp_port' => 'SFTP Port',
    ];

    $conflicts = [];
    $sql = '
        SELECT instance_id, server_name, server_port, web_port, vnc_port, novnc_port, sftp_port
        FROM server_instances
        WHERE (server_port = ? OR web_port = ? OR vnc_port = ? OR novnc_port = ? OR sftp_port = ?)
    ';
    $params = [
        (int) ($ports['server_port'] ?? 0),
        (int) ($ports['web_port'] ?? 0),
        (int) ($ports['vnc_port'] ?? 0),
        (int) ($ports['novnc_port'] ?? 0),
        (int) ($ports['sftp_port'] ?? 0),
    ];

    if ($excludeInstanceId !== null && $excludeInstanceId !== '') {
        $sql .= ' AND instance_id <> ?';
        $params[] = $excludeInstanceId;
    }

    $stmt = db()->prepare($sql);
    $stmt->execute($params);

    foreach ($stmt->fetchAll() as $server) {
        foreach ($fields as $field => $label) {
            if ((int) ($server[$field] ?? 0) === (int) ($ports[$field] ?? -1)) {
                $conflicts[] = sprintf(
                    '%s %d is already used by %s (%s)',
                    $label,
                    (int) $ports[$field],
                    (string) ($server['server_name'] ?? 'existing server'),
                    (string) ($server['instance_id'] ?? 'unknown')
                );
            }
        }
    }

    return array_values(array_unique($conflicts));
}

function host_storage_prepare(array $host): array
{
    return agent_post_for_host($host, '/host/storage/prepare', [
        'shared_game_path' => $host['shared_game_path'] ?? '/opt/fs25/game',
        'shared_dlc_path' => $host['shared_dlc_path'] ?? '/opt/fs25/dlc',
        'shared_installer_path' => $host['shared_installer_path'] ?? '/opt/fs25/installer',
    ]);
}

function unzip_installer_archive_for_host(array $host, string $filename): array
{
    return agent_post_for_host($host, '/host/installer/unzip', [
        'filename' => $filename,
        'shared_installer_path' => $host['shared_installer_path'] ?? '/opt/fs25/installer',
    ]);
}

function installer_directory_listing_for_host(array $host): array
{
    return agent_post_for_host($host, '/host/installer/list', [
        'shared_installer_path' => $host['shared_installer_path'] ?? '/opt/fs25/installer',
    ]);
}

function current_user(): ?array
{
    return $_SESSION['user'] ?? null;
}

function require_login(): void
{
    if (!current_user()) {
        header('Location: /?route=login');
        exit;
    }
}

function flash(?string $message = null): ?string
{
    if ($message !== null) {
        $_SESSION['flash'] = $message;
        return null;
    }

    $value = $_SESSION['flash'] ?? null;
    unset($_SESSION['flash']);
    return $value;
}

function agent_post_for_host(array $host, string $path, array $payload): array
{
    $url = rtrim((string) ($host['agent_url'] ?? ''), '/') . $path;

    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER => [
            'Content-Type: application/json',
            'X-Agent-Token: ' . (string) ($host['agent_token'] ?? ''),
        ],
        CURLOPT_POSTFIELDS => json_encode($payload),
    ]);

    $response = curl_exec($ch);
    $error = curl_error($ch);
    $status = curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    curl_close($ch);

    if ($response === false) {
        return ['ok' => false, 'error' => $error ?: 'Agent request failed'];
    }

    $decoded = json_decode($response, true);
    if (!is_array($decoded)) {
        return ['ok' => false, 'error' => 'Invalid agent response', 'raw' => $response, 'status' => $status];
    }

    return $decoded;
}

function agent_health_for_host(array $host): array
{
    $url = rtrim((string) ($host['agent_url'] ?? ''), '/') . '/health';
    $ch = curl_init($url);

    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 3,
    ]);

    $response = curl_exec($ch);
    $error = curl_error($ch);
    $status = curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    curl_close($ch);

    if ($response === false || $status >= 400) {
        return ['ok' => false, 'error' => $error ?: 'Host unreachable'];
    }

    $decoded = json_decode($response, true);
    return is_array($decoded) ? $decoded : ['ok' => false, 'error' => 'Invalid host response'];
}

function all_hosts(): array
{
    return db()->query('SELECT * FROM managed_hosts ORDER BY name ASC, id ASC')->fetchAll();
}

function enabled_hosts(): array
{
    $stmt = db()->prepare('SELECT * FROM managed_hosts WHERE is_enabled = 1 ORDER BY name ASC, id ASC');
    $stmt->execute();
    return $stmt->fetchAll();
}

function find_host(int $hostId): ?array
{
    $stmt = db()->prepare('SELECT * FROM managed_hosts WHERE id = ? LIMIT 1');
    $stmt->execute([$hostId]);
    $host = $stmt->fetch();

    return $host ?: null;
}

function find_instance_with_host(string $instanceId): ?array
{
    $stmt = db()->prepare('
        SELECT
            si.*,
            mh.name AS host_name,
            mh.agent_url,
            mh.agent_token,
            mh.is_enabled
        FROM server_instances si
        LEFT JOIN managed_hosts mh ON mh.id = si.host_id
        WHERE si.instance_id = ?
        LIMIT 1
    ');
    $stmt->execute([$instanceId]);
    $server = $stmt->fetch();

    return $server ?: null;
}

function instance_metrics_for_server(array $server): array
{
    $instanceId = (string) ($server['instance_id'] ?? '');
    if ($instanceId === '') {
        return ['ok' => false, 'error' => 'Missing instance id'];
    }

    return agent_post_for_host($server, '/instance/metrics', [
        'instance_id' => $instanceId,
    ]);
}

function format_bytes_human(int $bytes): string
{
    if ($bytes <= 0) {
        return '0 B';
    }

    $units = ['B', 'KB', 'MB', 'GB', 'TB'];
    $value = (float) $bytes;
    $unitIndex = 0;

    while ($value >= 1024 && $unitIndex < count($units) - 1) {
        $value /= 1024;
        $unitIndex++;
    }

    return number_format($value, $value >= 100 ? 0 : 1) . ' ' . $units[$unitIndex];
}

function upload_instance_file_for_host(array $host, string $instanceId, string $target, array $file): array
{
    if (($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
        return ['ok' => false, 'error' => 'Upload failed before transfer to host'];
    }

    $tmpPath = (string) ($file['tmp_name'] ?? '');
    if ($tmpPath === '' || !is_uploaded_file($tmpPath)) {
        return ['ok' => false, 'error' => 'Invalid upload payload'];
    }

    $filename = basename((string) ($file['name'] ?? ''));
    $content = file_get_contents($tmpPath);

    if ($content === false) {
        return ['ok' => false, 'error' => 'Unable to read uploaded file'];
    }

    return agent_post_for_host($host, '/instance/upload', [
        'instance_id' => $instanceId,
        'target' => $target,
        'filename' => $filename,
        'content_base64' => base64_encode($content),
    ]);
}

function upload_shared_host_file(array $host, string $target, array $file): array
{
    if (($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
        return ['ok' => false, 'error' => 'Upload failed before transfer to host'];
    }

    $tmpPath = (string) ($file['tmp_name'] ?? '');
    if ($tmpPath === '' || !is_uploaded_file($tmpPath)) {
        return ['ok' => false, 'error' => 'Invalid upload payload'];
    }

    $filename = basename((string) ($file['name'] ?? ''));
    $content = file_get_contents($tmpPath);

    if ($content === false) {
        return ['ok' => false, 'error' => 'Unable to read uploaded file'];
    }

    return agent_post_for_host($host, '/host/upload', [
        'target' => $target,
        'filename' => $filename,
        'content_base64' => base64_encode($content),
        'shared_game_path' => $host['shared_game_path'] ?? '/opt/fs25/game',
        'shared_dlc_path' => $host['shared_dlc_path'] ?? '/opt/fs25/dlc',
        'shared_installer_path' => $host['shared_installer_path'] ?? '/opt/fs25/installer',
    ]);
}

function instance_upload_targets(): array
{
    return [
        'profile' => ['label' => 'Profile Folder', 'relative_path' => 'data/config'],
        'mods' => ['label' => 'Mods Folder', 'relative_path' => 'data/mods'],
        'saves' => ['label' => 'Saves Folder', 'relative_path' => 'data/saves'],
        'logs' => ['label' => 'Logs Folder', 'relative_path' => 'data/logs'],
    ];
}

function host_upload_targets(array $host): array
{
    return [
        'game' => [
            'label' => 'Shared Game Folder',
            'path' => (string) ($host['shared_game_path'] ?? '/opt/fs25/game'),
        ],
        'dlc' => [
            'label' => 'Shared DLC Folder',
            'path' => (string) ($host['shared_dlc_path'] ?? '/opt/fs25/dlc'),
        ],
        'installer' => [
            'label' => 'Shared Installer Folder',
            'path' => (string) ($host['shared_installer_path'] ?? '/opt/fs25/installer'),
        ],
    ];
}

function upload_context_for_request(?array $host, ?array $server, string $target): ?array
{
    if ($server) {
        $targets = instance_upload_targets();
        if (!isset($targets[$target])) {
            return null;
        }

        $instanceId = (string) ($server['instance_id'] ?? '');
        if ($instanceId === '' || !safe_instance_id_php($instanceId)) {
            return null;
        }

        $relativePath = (string) $targets[$target]['relative_path'];
        $absolutePath = rtrim((string) env_value('INSTANCE_BASE_PATH', '/opt/fsg-panel/instances'), '/\\') . '/' . $instanceId . '/' . $relativePath;

        return [
            'scope' => 'panel-upload',
            'mode' => 'instance',
            'target' => $target,
            'label' => (string) $targets[$target]['label'],
            'path' => str_replace('\\', '/', $absolutePath),
            'host' => $server,
            'instance_id' => $instanceId,
            'back_route' => 'game_servers',
        ];
    }

    if ($host) {
        $targets = host_upload_targets($host);
        if (!isset($targets[$target])) {
            return null;
        }

        return [
            'scope' => 'panel-upload',
            'mode' => 'host',
            'target' => $target,
            'label' => (string) $targets[$target]['label'],
            'path' => (string) $targets[$target]['path'],
            'host' => $host,
            'back_route' => 'file_management',
        ];
    }

    return null;
}

function file_context_for_request(?array $host, ?array $server, string $target): ?array
{
    return upload_context_for_request($host, $server, $target);
}

function normalize_relative_subpath(string $subpath): ?string
{
    $clean = trim(str_replace('\\', '/', $subpath), '/');
    if ($clean === '') {
        return '';
    }

    foreach (explode('/', $clean) as $segment) {
        if ($segment === '' || $segment === '.' || $segment === '..') {
            return null;
        }
        if (preg_match('/^[a-zA-Z0-9._ -]+$/', $segment) !== 1) {
            return null;
        }
    }

    return $clean;
}

function context_with_subpath(array $context, string $subpath): ?array
{
    $normalized = normalize_relative_subpath($subpath);
    if ($normalized === null) {
        return null;
    }

    if ($normalized === '') {
        return $context;
    }

    $context['path'] = rtrim((string) $context['path'], '/\\') . '/' . $normalized;
    return $context;
}

function file_access_status_for_context(array $context): array
{
    return agent_post_for_host($context['host'], '/fs/check', [
        'path' => $context['path'],
    ]);
}

function directory_listing_for_context(array $context, string $subpath = ''): array
{
    return agent_post_for_host($context['host'], '/fs/list', [
        'path' => $context['path'],
        'subpath' => $subpath,
    ]);
}

function safe_instance_id_php(string $instanceId): bool
{
    return preg_match('/^[a-zA-Z0-9_-]+$/', $instanceId) === 1;
}

function base64url_encode(string $value): string
{
    return rtrim(strtr(base64_encode($value), '+/', '-_'), '=');
}

function generate_path_upload_token(array $host, string $filename, string $path, string $scope = 'panel-upload', int $ttlSeconds = 900): string
{
    $payload = json_encode([
        'filename' => $filename,
        'scope' => $scope,
        'path' => $path,
        'exp' => time() + $ttlSeconds,
    ], JSON_THROW_ON_ERROR);

    $payloadEncoded = base64url_encode($payload);
    $signature = hash_hmac('sha256', $payloadEncoded, (string) ($host['agent_token'] ?? ''), true);

    return $payloadEncoded . '.' . base64url_encode($signature);
}

function stream_upload_chunk_for_host(array $host, string $filename, string $path, int $offset, int $totalSize, bool $isLastChunk): array
{
    $filename = basename($filename);
    if ($filename === '') {
        return ['ok' => false, 'error' => 'Filename is required'];
    }

    if ($offset < 0 || $totalSize < 0) {
        return ['ok' => false, 'error' => 'Invalid upload chunk metadata'];
    }

    $input = fopen('php://input', 'rb');
    if ($input === false) {
        return ['ok' => false, 'error' => 'Unable to read upload stream'];
    }

    $url = rtrim((string) ($host['agent_url'] ?? ''), '/') . '/host/upload/chunk';
    $token = generate_path_upload_token($host, $filename, $path);
    $headers = [
        'Content-Type: application/octet-stream',
        'X-Upload-Token: ' . $token,
        'X-Upload-Filename: ' . $filename,
        'X-Upload-Offset: ' . $offset,
        'X-Upload-Total-Size: ' . $totalSize,
        'X-Upload-Is-Last: ' . ($isLastChunk ? '1' : '0'),
    ];

    $contentLength = $_SERVER['CONTENT_LENGTH'] ?? null;
    if (is_string($contentLength) && ctype_digit($contentLength)) {
        $headers[] = 'Content-Length: ' . $contentLength;
    }

    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_CUSTOMREQUEST => 'POST',
        CURLOPT_UPLOAD => true,
        CURLOPT_INFILE => $input,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER => $headers,
        CURLOPT_TIMEOUT => 0,
    ]);

    if (is_string($contentLength) && ctype_digit($contentLength)) {
        curl_setopt($ch, CURLOPT_INFILESIZE_LARGE, (int) $contentLength);
    }

    $response = curl_exec($ch);
    $error = curl_error($ch);
    $status = curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    curl_close($ch);
    fclose($input);

    if ($response === false) {
        return ['ok' => false, 'error' => $error ?: 'Installer upload proxy failed'];
    }

    $decoded = json_decode($response, true);
    if (!is_array($decoded)) {
        return ['ok' => false, 'error' => 'Invalid upload response', 'status' => $status, 'raw' => $response];
    }

    if ($status >= 400) {
        $decoded['ok'] = false;
    }

    return $decoded;
}

function instance_access_url(array $server, string $kind): ?string
{
    $agentUrl = (string) ($server['agent_url'] ?? '');
    if ($agentUrl === '') {
        return null;
    }

    $parts = parse_url($agentUrl);
    if (!is_array($parts) || empty($parts['host'])) {
        return null;
    }

    $scheme = $parts['scheme'] ?? 'http';
    $host = $parts['host'];
    $port = match ($kind) {
        'web' => (int) ($server['web_port'] ?? 0),
        'novnc' => (int) ($server['novnc_port'] ?? 0),
        'sftp' => (int) ($server['sftp_port'] ?? 0),
        default => 0,
    };

    if ($port <= 0) {
        return null;
    }

    return sprintf('%s://%s:%d', $scheme, $host, $port);
}

function h(string $value): string
{
    return htmlspecialchars($value, ENT_QUOTES, 'UTF-8');
}
