<?php
declare(strict_types=1);
require __DIR__ . '/../app/web/src/central.php';
function local_host_record(): array { return ['id' => 1, 'is_enabled' => 1]; }
function db(): object { return new class {
    function prepare(string $sql): object { return new class {
        function execute(array $params): void {}
        function fetchAll(): array { return [['instance_id' => 'fs25-001', 'server_name' => 'Farm', 'status' => 'backend_reboot']]; }
    }; }
}; }
$runtime = ['runtime_state' => ['label' => 'Online'], 'running' => true];
$sampled = time();
function telemetry_for_host(array $host, string $scope, int $hours): array {
    global $runtime, $sampled;
    return ['ok' => true, 'latest' => $scope === 'host' ? [] : $runtime, 'sampled_at' => $sampled];
}
function check_status(string $expected): void {
    $actual = central_snapshot()['servers'][0]['status'];
    if ($actual !== $expected) throw new RuntimeException('Expected '.$expected.'; got '.$actual);
}
check_status('Online');
$runtime = ['running' => false];
check_status('Stopped');
$sampled = time() - 200;
check_status('Unknown');
echo "Snapshot uses fresh runtime status, never the last requested action.\n";
