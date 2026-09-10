<?php
// Local-only visual fixture; synthetic telemetry, never production data.
$root = dirname(__DIR__);
$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
if (str_starts_with($path, '/assets/')) {
    $name = basename($path);
    if (!in_array($name, ['telemetry.js', 'telemetry.css'], true)) { http_response_code(404); exit; }
    header('Content-Type: ' . (str_ends_with($name, '.js') ? 'application/javascript' : 'text/css'));
    readfile($root . '/app/web/public/assets/' . $name); exit;
}
if (isset($_GET['route'])) {
    $hours = (int) ($_GET['hours'] ?? 1);
    $points = [];
    for ($i=0; $i<120; $i++) $points[] = ['timestamp'=>time()-($hours*3600)*(119-$i)/120, 'cpu_percent'=>20+15*sin($i/7), 'memory_used_bytes'=>8e9+1e9*sin($i/17), 'disk_used_bytes'=>140e9+$i*1e7, 'network_in_bytes_sec'=>2e6+1e6*sin($i/5), 'network_out_bytes_sec'=>8e5+4e5*sin($i/9)];
    header('Content-Type: application/json');
    echo json_encode(['ok'=>true, 'points'=>$points, 'latest'=>end($points), 'sampled_at'=>time(), 'bucket_seconds'=>$hours*30]); exit;
}
function h($value) { return htmlspecialchars((string)$value, ENT_QUOTES, 'UTF-8'); }
require $root . '/app/web/src/telemetry-view.php';
?><!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/assets/telemetry.css"><script defer src="/assets/telemetry.js"></script><style>body{background:#0b1120;color:#e5edf8;font-family:system-ui;margin:0;padding:24px}main{max-width:1200px;margin:auto}</style></head><body><main><h1>Your node, at a glance</h1><p>Visual test fixture - synthetic data</p><?php render_telemetry([['name'=>'Local host','query'=>'host_id=1'],['name'=>'Test game server','query'=>'instance_id=server0001']], 'Host performance'); ?></main></body></html>
