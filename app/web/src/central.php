<?php
declare(strict_types=1);

function central_gateway_user(): ?array
{
    $expected = (string) env_value('CENTRAL_GATEWAY_TOKEN', '');
    $provided = (string) request_header_value('X-Central-Token');
    $id = (string) request_header_value('X-Central-User');
    $role = (string) request_header_value('X-Central-Role');
    if (strlen($expected) < 64 || !hash_equals($expected, $provided) || !preg_match('/^\d{17,20}$/D', $id) || !in_array($role, ['operator', 'admin'], true)) {
        return null;
    }
    return ['id' => 0, 'username' => 'Discord ' . $id, 'discord_id' => $id, 'role' => $role];
}

/**
 * Browser console sockets connect straight to this node's gateway hostname, where Cloudflare
 * Access is bypassed for that one path, because a Worker cannot relay a WebSocket into a
 * Cloudflare Tunnel. Browsers cannot send the gateway headers on a WebSocket, so the main site
 * signs a ticket into the socket path instead:
 * /central/view/<instance>/vnc/websockify/<expires>.<nonce>.<hmac>
 * The HMAC is keyed by the gateway token and bound to the instance and the viewer session expiry.
 */
function central_console_ticket_valid(string $instance, string $requestUri, ?string $origin): bool
{
    $token = (string) env_value('CENTRAL_GATEWAY_TOKEN', '');
    $path = (string) parse_url($requestUri, PHP_URL_PATH);
    if (strlen($token) < 64 || !preg_match('#^/central/view/([a-zA-Z0-9_-]+)/vnc/websockify/([0-9]{1,12})\.([a-f0-9]{32})\.([a-f0-9]{64})$#D', $path, $m)) {
        return false;
    }
    if ($m[1] !== $instance || (int) $m[2] <= time() || !is_string($origin) || !preg_match('#^https://[a-z0-9.-]+\.sargentweb\.com$#D', $origin)) {
        return false;
    }
    $expected = hash_hmac('sha256', 'console|' . $instance . '|' . $m[2] . '|' . $m[3], $token);
    return hash_equals($expected, $m[4]);
}

function central_snapshot(): array
{
    $host = local_host_record();
    $samples = [];
    $servers = [];
    $keys = array_fill_keys(['cpu_percent', 'memory_used_bytes', 'memory_limit_bytes', 'disk_used_bytes', 'disk_limit_bytes', 'network_in_bytes_sec', 'network_out_bytes_sec', 'uptime_seconds'], true);
    // One agent call returns the latest reading for every scope; agents without it are asked
    // per scope as before.
    $latestByScope = null;
    if ($host && (int) $host['is_enabled'] && function_exists('agent_post_for_host')) {
        $bulk = agent_post_for_host($host, '/telemetry/latest', [], 10);
        if (($bulk['ok'] ?? false) && is_array($bulk['scopes'] ?? null)) {
            $latestByScope = $bulk['scopes'];
        }
    }
    $collect = static function (array $host, string $scope) use (&$samples, $keys, $latestByScope): ?array {
        if ($latestByScope !== null) {
            $entry = $latestByScope[$scope] ?? null;
            $result = is_array($entry) ? ['ok' => true, 'latest' => $entry['latest'] ?? null, 'sampled_at' => $entry['sampled_at'] ?? 0] : ['ok' => false];
        } else {
            $result = telemetry_for_host($host, $scope, 1);
        }
        if (($result['ok'] ?? false) && is_array($result['latest'] ?? null) && (int) ($result['sampled_at'] ?? 0) >= time() - 3600) {
            $samples[] = ['scope' => $scope, 'timestamp' => (int) $result['sampled_at'], 'data' => array_intersect_key($result['latest'], $keys)];
            return (int) $result['sampled_at'] >= time() - 120 ? $result['latest'] : null;
        }
        return null;
    };
    if ($host && (int) $host['is_enabled']) {
        $collect($host, 'host');
        $stmt = db()->prepare('SELECT instance_id,server_name,status,server_players,server_map,server_region FROM server_instances WHERE host_id=? ORDER BY instance_id LIMIT 100');
        $stmt->execute([$host['id']]);
        foreach ($stmt->fetchAll() as $server) {
            $server['server_players'] = (int) ($server['server_players'] ?? 16);
            $latest = $collect($host, (string) $server['instance_id']);
            $server['status'] = $latest['runtime_state']['label'] ?? ($latest !== null && array_key_exists('running', $latest) ? ($latest['running'] ? 'Running' : 'Stopped') : 'Unknown');
            foreach (['game_version', 'game_map', 'player_count', 'player_capacity', 'game_sampled_at'] as $key) {
                if (isset($latest[$key])) $server[$key] = $latest[$key];
            }
            $servers[] = $server;
        }
    }
    return ['version' => 1, 'samples' => $samples, 'servers' => $servers];
}
