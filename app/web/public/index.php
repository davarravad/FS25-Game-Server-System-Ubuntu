<?php

declare(strict_types=1);

require __DIR__ . '/../src/bootstrap.php';

$route = $_GET['route'] ?? 'dashboard';

if ($route === 'login' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    $username = trim($_POST['username'] ?? '');
    $password = (string)($_POST['password'] ?? '');

    $stmt = db()->prepare('SELECT * FROM users WHERE username = ? LIMIT 1');
    $stmt->execute([$username]);
    $user = $stmt->fetch();

    if ($user && password_verify($password, $user['password_hash'])) {
        $_SESSION['user'] = ['id' => $user['id'], 'username' => $user['username']];
        header('Location: /');
        exit;
    }

    flash('Invalid username or password.');
    header('Location: /?route=login');
    exit;
}

if ($route === 'logout') {
    session_destroy();
    header('Location: /?route=login');
    exit;
}

if ($route === 'host_create' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    require_login();

    $name = trim((string) ($_POST['name'] ?? ''));
    $agentUrl = trim((string) ($_POST['agent_url'] ?? ''));
    $agentToken = trim((string) ($_POST['agent_token'] ?? ''));

    if ($name === '' || $agentUrl === '' || $agentToken === '') {
        flash('Host name, API URL, and token are required.');
        header('Location: /');
        exit;
    }

    $stmt = db()->prepare('
        INSERT INTO managed_hosts (name, agent_url, agent_token, is_enabled)
        VALUES (?, ?, ?, 1)
    ');
    $stmt->execute([$name, $agentUrl, $agentToken]);

    flash('Managed host added.');
    header('Location: /');
    exit;
}

if ($route === 'create' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    require_login();

    $instanceId = preg_replace('/[^a-zA-Z0-9_-]/', '', (string)($_POST['instance_id'] ?? ''));
    $serverName = trim((string)($_POST['server_name'] ?? ''));
    $imageName = trim((string)($_POST['image_name'] ?? 'toetje585/arch-fs25server:latest'));
    $hostId = (int) ($_POST['host_id'] ?? 0);
    $host = find_host($hostId);

    if (!$host || !(int) $host['is_enabled']) {
        flash('Select a valid managed host.');
        header('Location: /');
        exit;
    }

    $payload = [
        'instance_id' => $instanceId,
        'server_name' => $serverName ?: $instanceId,
        'image_name' => $imageName,
        'server_password' => (string)($_POST['server_password'] ?? ''),
        'server_admin' => (string)($_POST['server_admin'] ?? ''),
        'server_players' => (int)($_POST['server_players'] ?? 16),
        'server_port' => (int)($_POST['server_port'] ?? 10823),
        'web_port' => (int)($_POST['web_port'] ?? 18000),
        'vnc_port' => (int)($_POST['vnc_port'] ?? 5900),
        'novnc_port' => (int)($_POST['novnc_port'] ?? 6080),
        'server_region' => (string)($_POST['server_region'] ?? 'en'),
        'server_map' => (string)($_POST['server_map'] ?? 'MapUS'),
        'server_difficulty' => (int)($_POST['server_difficulty'] ?? 3),
        'server_pause' => (int)($_POST['server_pause'] ?? 2),
        'server_save_interval' => (float)($_POST['server_save_interval'] ?? 180),
        'server_stats_interval' => (int)($_POST['server_stats_interval'] ?? 31536000),
        'server_crossplay' => isset($_POST['server_crossplay']),
        'autostart_server' => isset($_POST['autostart_server']),
        'puid' => (int)($_POST['puid'] ?? 1000),
        'pgid' => (int)($_POST['pgid'] ?? 1000),
        'vnc_password' => (string)($_POST['vnc_password'] ?? 'changeme'),
        'web_username' => (string)($_POST['web_username'] ?? 'admin'),
        'web_password' => (string)($_POST['web_password'] ?? 'changeme'),
    ];

    $agent = agent_post_for_host($host, '/instance/create', $payload);

    if (!($agent['ok'] ?? false)) {
        flash('Create failed: ' . ($agent['error'] ?? 'Unknown error'));
        header('Location: /');
        exit;
    }

    $stmt = db()->prepare('
        INSERT INTO server_instances
        (host_id, instance_id, server_name, image_name, server_port, web_port, vnc_port, novnc_port, server_players, server_region, server_map, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ');

    $stmt->execute([
        $hostId,
        $payload['instance_id'],
        $payload['server_name'],
        $payload['image_name'],
        $payload['server_port'],
        $payload['web_port'],
        $payload['vnc_port'],
        $payload['novnc_port'],
        $payload['server_players'],
        $payload['server_region'],
        $payload['server_map'],
        'created',
    ]);

    flash('Server created.');
    header('Location: /');
    exit;
}

if ($route === 'action' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    require_login();

    $instanceId = (string)($_POST['instance_id'] ?? '');
    $action = (string)($_POST['action'] ?? '');
    $server = find_instance_with_host($instanceId);

    if (!$server || !(int) ($server['is_enabled'] ?? 0)) {
        flash('Managed host for this server is missing or disabled.');
        header('Location: /');
        exit;
    }

    $agent = agent_post_for_host($server, '/instance/action', [
        'instance_id' => $instanceId,
        'action' => $action,
    ]);

    if (($agent['ok'] ?? false) && $action !== 'logs') {
        $stmt = db()->prepare('UPDATE server_instances SET status = ? WHERE instance_id = ?');
        $stmt->execute([$action, $instanceId]);
    }

    if ($action === 'logs') {
        $_SESSION['logs'] = $agent['result']['stdout'] ?? ($agent['result']['stderr'] ?? 'No logs returned');
    } else {
        flash(($agent['ok'] ?? false) ? 'Action completed.' : 'Action failed.');
    }

    header('Location: /');
    exit;
}

if ($route === 'delete' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    require_login();

    $instanceId = (string)($_POST['instance_id'] ?? '');
    $server = find_instance_with_host($instanceId);

    if (!$server || !(int) ($server['is_enabled'] ?? 0)) {
        flash('Managed host for this server is missing or disabled.');
        header('Location: /');
        exit;
    }

    $agent = agent_post_for_host($server, '/instance/delete', [
        'instance_id' => $instanceId,
    ]);

    if (($agent['ok'] ?? false)) {
        $stmt = db()->prepare('DELETE FROM server_instances WHERE instance_id = ?');
        $stmt->execute([$instanceId]);
        flash('Server deleted.');
    } else {
        flash('Delete failed.');
    }

    header('Location: /');
    exit;
}

if ($route === 'upload' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    require_login();

    $instanceId = (string) ($_POST['instance_id'] ?? '');
    $target = (string) ($_POST['target'] ?? 'mods');
    $server = find_instance_with_host($instanceId);

    if (!$server || !(int) ($server['is_enabled'] ?? 0)) {
        flash('Managed host for this server is missing or disabled.');
        header('Location: /');
        exit;
    }

    $result = upload_instance_file_for_host($server, $instanceId, $target, $_FILES['upload_file'] ?? []);

    flash(($result['ok'] ?? false)
        ? 'File uploaded.'
        : 'Upload failed: ' . ($result['error'] ?? 'Unknown error'));

    header('Location: /');
    exit;
}

if (!current_user() && $route !== 'login') {
    header('Location: /?route=login');
    exit;
}

$flash = flash();
$logs = $_SESSION['logs'] ?? null;
unset($_SESSION['logs']);

?><!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <title>FSG FS25 Panel</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
        * { box-sizing: border-box; }
        body { font-family: Arial, sans-serif; background: #10131a; color: #f2f4f8; margin: 0; }
        .wrap { max-width: 1200px; margin: 0 auto; padding: 24px; }
        .card { background: #171c25; border: 1px solid #2a3240; border-radius: 14px; padding: 18px; margin-bottom: 20px; }
        input, select { width: 100%; padding: 10px 12px; border-radius: 8px; border: 1px solid #334155; background: #0f172a; color: #fff; }
        button { padding: 10px 14px; border-radius: 8px; border: 0; cursor: pointer; background: #2563eb; color: #fff; }
        button.danger { background: #b91c1c; }
        button.gray { background: #475569; }
        .button-link { display: inline-block; padding: 10px 14px; border-radius: 8px; background: #475569; color: #fff; }
        .grid { display: grid; gap: 14px; }
        .grid-2 { grid-template-columns: repeat(2, 1fr); }
        .grid-4 { grid-template-columns: repeat(4, 1fr); }
        .flex { display: flex; gap: 10px; flex-wrap: wrap; }
        table { width: 100%; border-collapse: collapse; }
        th, td { text-align: left; padding: 10px; border-bottom: 1px solid #243041; }
        .flash { padding: 12px; background: #1d4ed8; border-radius: 10px; margin-bottom: 16px; }
        .muted { color: #a8b3c7; }
        a { color: #93c5fd; text-decoration: none; }
        pre { white-space: pre-wrap; background: #0b1020; padding: 14px; border-radius: 10px; overflow: auto; }
        form.grid > div, .grid-4 > div, .grid-2 > div { padding: 6px 0; }
        label { display: block; margin-bottom: 8px; font-size: 14px; color: #d9e1ee; }
        .card form { width: 100%; }
        @media (max-width: 900px) {
            .grid-2, .grid-4 { grid-template-columns: 1fr; }
        }
    </style>
</head>
<body>
<div class="wrap">
    <?php if ($route === 'login'): ?>
        <div class="card" style="max-width: 420px; margin: 80px auto;">
            <h1>FSG FS25 Panel</h1>
            <p class="muted">Sign in to manage FS25 server instances.</p>
            <?php if ($flash): ?><div class="flash"><?= h($flash) ?></div><?php endif; ?>
            <form method="post" action="/?route=login" class="grid">
                <div>
                    <label>Username</label>
                    <input name="username" required>
                </div>
                <div>
                    <label>Password</label>
                    <input name="password" type="password" required>
                </div>
                <div>
                    <button type="submit">Login</button>
                </div>
            </form>
        </div>
    <?php else: ?>
        <?php
            $servers = db()->query('
                SELECT
                    si.*,
                    mh.name AS host_name
                FROM server_instances si
                LEFT JOIN managed_hosts mh ON mh.id = si.host_id
                ORDER BY si.created_at DESC
            ')->fetchAll();
            $hosts = all_hosts();
            $createHosts = enabled_hosts();
        ?>
        <div class="flex" style="justify-content: space-between; align-items: center;">
            <div>
                <h1>FSG FS25 Panel</h1>
                <div class="muted">Logged in as <?= h(current_user()['username']) ?> | central API control for managed hosts</div>
            </div>
            <div><a href="/?route=logout">Logout</a></div>
        </div>

        <?php if ($flash): ?><div class="flash"><?= h($flash) ?></div><?php endif; ?>

        <div class="card">
            <h2>Managed Hosts</h2>
            <div class="grid grid-2">
                <div>
                    <form method="post" action="/?route=host_create" class="grid">
                        <div><label>Host Name</label><input name="name" placeholder="Node A" required></div>
                        <div><label>Agent API URL</label><input name="agent_url" placeholder="http://host-or-agent:8081" required></div>
                        <div><label>Agent Token</label><input name="agent_token" type="password" required></div>
                        <div><button type="submit">Add Managed Host</button></div>
                    </form>
                </div>
                <div>
                    <table>
                        <thead>
                            <tr>
                                <th>Name</th>
                                <th>API URL</th>
                                <th>Status</th>
                            </tr>
                        </thead>
                        <tbody>
                        <?php foreach ($hosts as $host): ?>
                            <?php $health = agent_health_for_host($host); ?>
                            <tr>
                                <td><?= h($host['name']) ?></td>
                                <td><?= h($host['agent_url']) ?></td>
                                <td><?= h(($health['ok'] ?? false) ? 'online' : 'offline') ?></td>
                            </tr>
                        <?php endforeach; ?>
                        <?php if (!$hosts): ?>
                            <tr><td colspan="3" class="muted">No managed hosts configured yet.</td></tr>
                        <?php endif; ?>
                        </tbody>
                    </table>
                </div>
            </div>
        </div>

        <div class="card">
            <h2>Create Server</h2>
            <form method="post" action="/?route=create" class="grid grid-4">
                <div>
                    <label>Managed Host</label>
                    <select name="host_id" required>
                        <option value="">Select host</option>
                        <?php foreach ($createHosts as $host): ?>
                            <option value="<?= h((string) $host['id']) ?>"><?= h($host['name']) ?> (<?= h($host['agent_url']) ?>)</option>
                        <?php endforeach; ?>
                    </select>
                </div>
                <div><label>Instance ID</label><input name="instance_id" placeholder="fs25-0001" required></div>
                <div><label>Server Name</label><input name="server_name" placeholder="FSG Server 1" required></div>
                <div><label>Image</label><input name="image_name" value="toetje585/arch-fs25server:latest" required></div>
                <div><label>Players</label><input name="server_players" type="number" value="16"></div>

                <div><label>Game Port</label><input name="server_port" type="number" value="10823"></div>
                <div><label>Admin Web Port</label><input name="web_port" type="number" value="18000"></div>
                <div><label>VNC Port</label><input name="vnc_port" type="number" value="5900"></div>
                <div><label>noVNC Port</label><input name="novnc_port" type="number" value="6080"></div>

                <div><label>Join Password</label><input name="server_password"></div>
                <div><label>Admin Password</label><input name="server_admin"></div>
                <div><label>Web Username</label><input name="web_username" value="admin"></div>
                <div><label>Web Password</label><input name="web_password" value="changeme"></div>

                <div><label>VNC Password</label><input name="vnc_password" value="changeme"></div>
                <div><label>Region</label><input name="server_region" value="en"></div>
                <div><label>Map</label><input name="server_map" value="MapUS"></div>
                <div><label>Difficulty</label><input name="server_difficulty" type="number" value="3"></div>

                <div><label>Pause Mode</label><input name="server_pause" type="number" value="2"></div>
                <div><label>Save Interval</label><input name="server_save_interval" type="number" step="0.1" value="180"></div>
                <div><label>Stats Interval</label><input name="server_stats_interval" type="number" value="31536000"></div>
                <div><label>PUID</label><input name="puid" type="number" value="1000"></div>

                <div><label>PGID</label><input name="pgid" type="number" value="1000"></div>
                <div style="display:flex;align-items:end;"><label><input type="checkbox" name="server_crossplay" checked style="width:auto;"> Crossplay</label></div>
                <div style="display:flex;align-items:end;"><label><input type="checkbox" name="autostart_server" style="width:auto;"> Autostart</label></div>
                <div style="display:flex;align-items:end;"><button type="submit">Create Server</button></div>
            </form>
        </div>

        <div class="card">
            <h2>Server Instances</h2>
            <table>
                <thead>
                    <tr>
                        <th>Host</th>
                        <th>Instance</th>
                        <th>Name</th>
                        <th>Status</th>
                        <th>Game</th>
                        <th>Admin</th>
                        <th>VNC</th>
                        <th>noVNC</th>
                        <th>Access</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody>
                <?php foreach ($servers as $server): ?>
                    <?php
                        $webUrl = instance_access_url($server, 'web');
                        $novncUrl = instance_access_url($server, 'novnc');
                    ?>
                    <tr>
                        <td><?= h($server['host_name'] ?? 'unassigned') ?></td>
                        <td><?= h($server['instance_id']) ?></td>
                        <td><?= h($server['server_name']) ?></td>
                        <td><?= h($server['status']) ?></td>
                        <td><?= h((string)$server['server_port']) ?></td>
                        <td><?= h((string)$server['web_port']) ?></td>
                        <td><?= h((string)$server['vnc_port']) ?></td>
                        <td><?= h((string)$server['novnc_port']) ?></td>
                        <td>
                            <div class="flex">
                                <?php if ($webUrl): ?>
                                    <a class="button-link" href="<?= h($webUrl) ?>" target="_blank" rel="noreferrer">web admin</a>
                                <?php endif; ?>
                                <?php if ($novncUrl): ?>
                                    <a class="button-link" href="<?= h($novncUrl) ?>" target="_blank" rel="noreferrer">noVNC</a>
                                <?php endif; ?>
                            </div>
                        </td>
                        <td>
                            <div class="flex">
                                <?php foreach (['start','stop','restart','pull','rebuild','logs'] as $act): ?>
                                    <form method="post" action="/?route=action">
                                        <input type="hidden" name="instance_id" value="<?= h($server['instance_id']) ?>">
                                        <input type="hidden" name="action" value="<?= h($act) ?>">
                                        <button class="<?= $act === 'logs' ? 'gray' : '' ?>" type="submit"><?= h($act) ?></button>
                                    </form>
                                <?php endforeach; ?>
                                <form method="post" action="/?route=delete" onsubmit="return confirm('Delete this server? This removes the instance folder.');">
                                    <input type="hidden" name="instance_id" value="<?= h($server['instance_id']) ?>">
                                    <button class="danger" type="submit">delete</button>
                                </form>
                            </div>
                            <form method="post" action="/?route=upload" enctype="multipart/form-data" class="flex" style="margin-top:10px;">
                                <input type="hidden" name="instance_id" value="<?= h($server['instance_id']) ?>">
                                <select name="target" style="width:auto;">
                                    <option value="mods">mods</option>
                                    <option value="saves">saves</option>
                                    <option value="config">config</option>
                                    <option value="game">game</option>
                                </select>
                                <input name="upload_file" type="file" required style="max-width:260px;">
                                <button class="gray" type="submit">upload</button>
                            </form>
                        </td>
                    </tr>
                <?php endforeach; ?>
                <?php if (!$servers): ?>
                    <tr><td colspan="10" class="muted">No servers created yet.</td></tr>
                <?php endif; ?>
                </tbody>
            </table>
        </div>

        <?php if ($logs): ?>
            <div class="card">
                <h2>Recent Logs</h2>
                <pre><?= h($logs) ?></pre>
            </div>
        <?php endif; ?>
    <?php endif; ?>
</div>
</body>
</html>
