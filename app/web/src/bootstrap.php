<?php

declare(strict_types=1);

session_start();

function env_value(string $key, ?string $default = null): ?string
{
    $value = getenv($key);
    return $value === false ? $default : $value;
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

function host_storage_prepare(array $host): array
{
    return agent_post_for_host($host, '/host/storage/prepare', [
        'shared_game_path' => $host['shared_game_path'] ?? '/opt/fs25/game',
        'shared_dlc_path' => $host['shared_dlc_path'] ?? '/opt/fs25/dlc',
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

function base64url_encode(string $value): string
{
    return rtrim(strtr(base64_encode($value), '+/', '-_'), '=');
}

function generate_host_upload_token(array $host, string $filename, string $target = 'installer', int $ttlSeconds = 900): string
{
    $payload = json_encode([
        'filename' => $filename,
        'target' => $target,
        'path' => (string) ($host['shared_installer_path'] ?? '/opt/fs25/installer'),
        'exp' => time() + $ttlSeconds,
    ], JSON_THROW_ON_ERROR);

    $payloadEncoded = base64url_encode($payload);
    $signature = hash_hmac('sha256', $payloadEncoded, (string) ($host['agent_token'] ?? ''), true);

    return $payloadEncoded . '.' . base64url_encode($signature);
}

function stream_installer_chunk_for_host(array $host, string $filename, int $offset, int $totalSize, bool $isLastChunk): array
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
    $token = generate_host_upload_token($host, $filename);
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
