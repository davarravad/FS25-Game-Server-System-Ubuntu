<?php
// Local-only fixture: shared production templates, synthetic telemetry, no database.
function h($value) { return htmlspecialchars((string) $value, ENT_QUOTES, 'UTF-8'); }
$root = dirname(__DIR__);
require $root . '/app/web/src/telemetry-view.php';
require $root . '/app/web/src/sidebar.php';
$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
if (str_starts_with($path, '/assets/')) {
    $name = basename($path);
    if (!in_array($name, ['telemetry.js', 'telemetry.css', 'sidebar.js', 'sidebar.css'], true)) { http_response_code(404); exit; }
    header('Content-Type: ' . (str_ends_with($name, '.js') ? 'application/javascript' : 'text/css'));
    readfile($root . '/app/web/public/assets/' . $name); exit;
}
if (($_GET['route'] ?? '') === 'telemetry') {
    header('Content-Type: application/json');
    if (($_GET['host_id'] ?? '') === '3') {
        http_response_code(503);
        echo json_encode(['ok'=>false, 'error'=>'The agent rejected authentication. Check the token for this host in Managed Hosts.']); exit;
    }
    if (($_GET['host_id'] ?? '') === '4') {
        echo '<br>Warning: test-only invalid JSON response'; exit;
    }
    if (($_GET['host_id'] ?? '') === '5') {
        echo json_encode(['ok'=>true, 'points'=>[], 'latest'=>null, 'sampled_at'=>null]); exit;
    }
    $hours = (int) ($_GET['hours'] ?? 1);
    $points = [];
    for ($i=0; $i<120; $i++) $points[] = ['timestamp'=>time()-($hours*3600)*(119-$i)/120, 'cpu_percent'=>20+15*sin($i/7), 'memory_used_bytes'=>8e9+1e9*sin($i/17), 'disk_used_bytes'=>140e9+$i*1e7, 'network_in_bytes_sec'=>2e6+1e6*sin($i/5), 'network_out_bytes_sec'=>8e5+4e5*sin($i/9)];
    $latest = end($points) + ['memory_limit_bytes'=>32*1024**3, 'disk_limit_bytes'=>512*1024**3];
    echo json_encode(['ok'=>true, 'points'=>$points, 'latest'=>$latest, 'sampled_at'=>time(), 'bucket_seconds'=>$hours*30]); exit;
}
$source = file_get_contents($root . '/app/web/public/index.php');
preg_match_all('~<style>(.*?)</style>~s', $source, $styles);
$route = $_GET['route'] ?? 'dashboard';
?><!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>FSG sidebar and telemetry preview</title>
<style><?= end($styles[1]) ?></style>
<link rel="stylesheet" href="/assets/telemetry.css"><link rel="stylesheet" href="/assets/sidebar.css">
<script defer src="/assets/telemetry.js"></script><script defer src="/assets/sidebar.js"></script>
</head><body class="panel-layout"><div class="shell">
<?php render_sidebar($route, 'admin'); ?>
<main class="wrap" id="panel-content" tabindex="-1">
<section class="hero"><h1>Your node, at a glance</h1><p>Host resources, historical trends, and a clear path to every game server.</p><div class="flex"><span class="stat-chip">Visual fixture - synthetic data</span></div></section>
<?php render_telemetry([
    ['name'=>'Local Agent', 'query'=>'host_id=1'],
    ['name'=>'Test game server', 'query'=>'instance_id=server0001'],
    ['name'=>'Agent error test', 'query'=>'host_id=3'],
    ['name'=>'Invalid JSON test', 'query'=>'host_id=4'],
    ['name'=>'Empty history test', 'query'=>'host_id=5'],
], 'Host performance'); ?>
</main><footer class="footer"><div class="footer-inner">FSG FS25 Node - preview</div></footer>
</div></body></html>
