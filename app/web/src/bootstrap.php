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

    bootstrap_default_admin($pdo);

    return $pdo;
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

function agent_post(string $path, array $payload): array
{
    $url = rtrim(env_value('AGENT_URL', 'http://agent:8081'), '/') . $path;

    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER => [
            'Content-Type: application/json',
            'X-Agent-Token: ' . env_value('AGENT_SHARED_TOKEN', ''),
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

function h(string $value): string
{
    return htmlspecialchars($value, ENT_QUOTES, 'UTF-8');
}
