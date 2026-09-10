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

function central_snapshot(): array
{
    $host = local_host_record();
    $samples = [];
    $servers = [];
    $keys = array_fill_keys(['cpu_percent', 'memory_used_bytes', 'memory_limit_bytes', 'disk_used_bytes', 'disk_limit_bytes', 'network_in_bytes_sec', 'network_out_bytes_sec', 'uptime_seconds'], true);
    $collect = static function (array $host, string $scope) use (&$samples, $keys): void {
        $result = telemetry_for_host($host, $scope, 1);
        if (($result['ok'] ?? false) && is_array($result['latest'] ?? null) && (int) ($result['sampled_at'] ?? 0) >= time() - 3600) {
            $samples[] = ['scope' => $scope, 'timestamp' => (int) $result['sampled_at'], 'data' => array_intersect_key($result['latest'], $keys)];
        }
    };
    if ($host && (int) $host['is_enabled']) {
        $collect($host, 'host');
        $stmt = db()->prepare('SELECT instance_id,server_name,status FROM server_instances WHERE host_id=? ORDER BY instance_id LIMIT 100');
        $stmt->execute([$host['id']]);
        foreach ($stmt->fetchAll() as $server) {
            $servers[] = $server;
            $collect($host, (string) $server['instance_id']);
        }
    }
    return ['version' => 1, 'samples' => $samples, 'servers' => $servers];
}
