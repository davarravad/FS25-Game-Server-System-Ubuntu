<?php

declare(strict_types=1);

require __DIR__ . '/../src/bootstrap.php';

function redirect_route(string $route): void
{
    header('Location: /?route=' . rawurlencode($route));
    exit;
}

$route = $_GET['route'] ?? 'dashboard';

if ($route === 'login' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    $username = trim($_POST['username'] ?? '');
    $password = (string)($_POST['password'] ?? '');

    $stmt = db()->prepare('SELECT * FROM users WHERE username = ? LIMIT 1');
    $stmt->execute([$username]);
    $user = $stmt->fetch();

    if ($user && password_verify($password, $user['password_hash'])) {
        $_SESSION['user'] = ['id' => $user['id'], 'username' => $user['username']];
        redirect_route('game_servers');
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
    $sharedGamePath = trim((string) ($_POST['shared_game_path'] ?? '/opt/fs25/game'));
    $sharedDlcPath = trim((string) ($_POST['shared_dlc_path'] ?? '/opt/fs25/dlc'));
    $sharedInstallerPath = trim((string) ($_POST['shared_installer_path'] ?? '/opt/fs25/installer'));

    if ($name === '' || $agentUrl === '' || $agentToken === '') {
        flash('Host name, API URL, and token are required.');
        redirect_route('managed_hosts');
    }

    $stmt = db()->prepare('
        INSERT INTO managed_hosts (name, agent_url, agent_token, shared_game_path, shared_dlc_path, shared_installer_path, is_enabled)
        VALUES (?, ?, ?, ?, ?, ?, 1)
    ');
    $stmt->execute([$name, $agentUrl, $agentToken, $sharedGamePath, $sharedDlcPath, $sharedInstallerPath]);

    flash('Managed host added.');
    redirect_route('managed_hosts');
}

if ($route === 'host_prepare' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    require_login();

    $hostId = (int) ($_POST['host_id'] ?? 0);
    $host = find_host($hostId);

    if (!$host || !(int) $host['is_enabled']) {
        flash('Select a valid managed host.');
        redirect_route('managed_hosts');
    }

    $result = host_storage_prepare($host);
    flash(($result['ok'] ?? false) ? 'Shared FS storage prepared on host.' : 'Host prepare failed: ' . ($result['error'] ?? 'Unknown error'));
    redirect_route('managed_hosts');
}

if ($route === 'installer_unzip' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    require_login();

    $hostId = (int) ($_POST['host_id'] ?? 0);
    $filename = trim((string) ($_POST['filename'] ?? ''));
    $host = find_host($hostId);

    if (!$host || !(int) $host['is_enabled']) {
        flash('Select a valid managed host.');
        redirect_route('file_management');
    }

    if ($filename === '') {
        flash('Installer zip filename is required.');
        redirect_route('file_management');
    }

    $result = unzip_installer_archive_for_host($host, $filename);
    flash(($result['ok'] ?? false)
        ? 'Installer zip extracted.'
        : 'Installer unzip failed: ' . ($result['error'] ?? 'Unknown error'));
    redirect_route('file_management');
}

if ($route === 'installer_upload_token') {
    require_login();

    $hostId = (int) ($_GET['host_id'] ?? 0);
    $filename = basename((string) ($_GET['filename'] ?? ''));
    $host = find_host($hostId);

    if (!$host || !(int) $host['is_enabled']) {
        header('Content-Type: application/json', true, 404);
        echo json_encode(['ok' => false, 'error' => 'Host not found']);
        exit;
    }

    if ($filename === '') {
        header('Content-Type: application/json', true, 400);
        echo json_encode(['ok' => false, 'error' => 'Filename is required']);
        exit;
    }

    header('Content-Type: application/json');
    echo json_encode([
        'ok' => true,
        'upload_url' => '/?route=installer_upload_chunk&host_id=' . rawurlencode((string) $host['id']) . '&filename=' . rawurlencode($filename),
        'filename' => $filename,
    ]);
    exit;
}

if ($route === 'installer_upload_chunk' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    require_login();
    session_write_close();

    $hostId = (int) ($_GET['host_id'] ?? 0);
    $filename = basename((string) ($_GET['filename'] ?? ''));
    $offset = (int) ($_GET['offset'] ?? 0);
    $totalSize = (int) ($_GET['total_size'] ?? 0);
    $isLastChunk = (string) ($_GET['is_last'] ?? '0') === '1';
    $host = find_host($hostId);

    if (!$host || !(int) $host['is_enabled']) {
        header('Content-Type: application/json', true, 404);
        echo json_encode(['ok' => false, 'error' => 'Host not found']);
        exit;
    }

    $result = stream_installer_chunk_for_host($host, $filename, $offset, $totalSize, $isLastChunk);
    header('Content-Type: application/json', true, ($result['ok'] ?? false) ? 200 : 502);
    echo json_encode($result);
    exit;
}

if ($route === 'installer_upload') {
    require_login();

    $hostId = (int) ($_GET['host_id'] ?? 0);
    $host = find_host($hostId);

    if (!$host || !(int) $host['is_enabled']) {
        flash('Select a valid managed host.');
        redirect_route('file_management');
    }

    ?><!doctype html>
    <html lang="en">
    <head>
        <meta charset="utf-8">
        <title><?= h($host['name']) ?> Installer Upload</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
            * { box-sizing: border-box; }
            body { margin: 0; font-family: Arial, sans-serif; background: #0b1020; color: #f2f4f8; }
            .page { max-width: 860px; margin: 0 auto; padding: 32px 20px; }
            .card { background: #171c25; border: 1px solid #2a3240; border-radius: 14px; padding: 24px; }
            .muted { color: #a8b3c7; }
            .button-link, button { display: inline-block; padding: 10px 14px; border-radius: 8px; border: 0; background: #2563eb; color: #fff; text-decoration: none; cursor: pointer; }
            .button-link.gray { background: #475569; }
            input[type="file"] { width: 100%; padding: 12px; border-radius: 8px; border: 1px solid #334155; background: #0f172a; color: #fff; }
            .actions { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 18px; }
            .progress-shell { margin-top: 24px; display: grid; gap: 12px; }
            .progress-bar { width: 100%; height: 20px; border-radius: 999px; overflow: hidden; background: #0f172a; border: 1px solid #243041; }
            .progress-fill { width: 0%; height: 100%; background: linear-gradient(90deg, #2563eb, #06b6d4); transition: width 0.15s linear; }
            .stats { display: grid; gap: 8px; }
            .error { color: #fca5a5; }
            .ok { color: #86efac; }
        </style>
    </head>
    <body>
    <div class="page">
        <div class="card">
            <h1>Installer Upload</h1>
            <p class="muted">Upload large installer files directly to <strong><?= h($host['shared_installer_path'] ?? '/opt/fs25/installer') ?></strong> on <?= h($host['name']) ?>.</p>
            <p class="muted">This path uploads retryable chunks through the panel to the host agent and supports multi-GB uploads. Installer folder only.</p>
            <input id="upload-file" type="file" required>
            <div class="actions">
                <button id="start-upload" type="button">Start Upload</button>
                <a class="button-link gray" href="/?route=file_management">Back to File Management</a>
            </div>
            <div class="progress-shell">
                <div class="progress-bar"><div id="progress-fill" class="progress-fill"></div></div>
                <div class="stats">
                    <div id="progress-text" class="muted">No upload in progress.</div>
                    <div id="speed-text" class="muted">Speed: n/a</div>
                    <div id="eta-text" class="muted">ETA: n/a</div>
                    <div id="status-text" class="muted">Status: idle</div>
                </div>
            </div>
        </div>
    </div>
    <script>
    const fileInput = document.getElementById('upload-file');
    const startButton = document.getElementById('start-upload');
    const progressFill = document.getElementById('progress-fill');
    const progressText = document.getElementById('progress-text');
    const speedText = document.getElementById('speed-text');
    const etaText = document.getElementById('eta-text');
    const statusText = document.getElementById('status-text');
    const hostId = <?= json_encode((string) $host['id']) ?>;

    function formatBytes(bytes) {
        if (!Number.isFinite(bytes) || bytes < 0) return 'n/a';
        const units = ['B', 'KB', 'MB', 'GB', 'TB'];
        let value = bytes;
        let unitIndex = 0;
        while (value >= 1024 && unitIndex < units.length - 1) {
            value /= 1024;
            unitIndex += 1;
        }
        return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[unitIndex]}`;
    }

    function formatDuration(seconds) {
        if (!Number.isFinite(seconds) || seconds < 0) return 'n/a';
        const hrs = Math.floor(seconds / 3600);
        const mins = Math.floor((seconds % 3600) / 60);
        const secs = Math.floor(seconds % 60);
        if (hrs > 0) return `${hrs}h ${mins}m ${secs}s`;
        if (mins > 0) return `${mins}m ${secs}s`;
        return `${secs}s`;
    }

    startButton.addEventListener('click', async () => {
        const file = fileInput.files[0];
        if (!file) {
            statusText.textContent = 'Status: choose a file first';
            statusText.className = 'error';
            return;
        }

        startButton.disabled = true;
        statusText.textContent = 'Status: requesting upload token';
        statusText.className = 'muted';

        try {
            const tokenResponse = await fetch(`/?route=installer_upload_token&host_id=${encodeURIComponent(hostId)}&filename=${encodeURIComponent(file.name)}`, {
                credentials: 'same-origin',
            });
            const tokenData = await tokenResponse.json();

            if (!tokenData.ok) {
                throw new Error(tokenData.error || 'Failed to get upload token');
            }

            const startedAt = Date.now();
            const chunkSize = 64 * 1024 * 1024;
            let uploadedBytes = 0;

            async function uploadChunk(start, attempt = 1) {
                const end = Math.min(start + chunkSize, file.size);
                const chunk = file.slice(start, end);
                const isLastChunk = end >= file.size;
                const uploadUrl = `${tokenData.upload_url}&offset=${encodeURIComponent(start)}&total_size=${encodeURIComponent(file.size)}&is_last=${isLastChunk ? '1' : '0'}`;

                return new Promise((resolve, reject) => {
                    const xhr = new XMLHttpRequest();
                    xhr.open('POST', uploadUrl, true);

                    xhr.upload.onprogress = (event) => {
                        if (!event.lengthComputable) {
                            return;
                        }

                        const currentUploaded = start + event.loaded;
                        const elapsedSeconds = Math.max((Date.now() - startedAt) / 1000, 0.001);
                        const percent = (currentUploaded / file.size) * 100;
                        const bytesPerSecond = currentUploaded / elapsedSeconds;
                        const remainingSeconds = bytesPerSecond > 0 ? (file.size - currentUploaded) / bytesPerSecond : Infinity;

                        progressFill.style.width = `${percent.toFixed(2)}%`;
                        progressText.textContent = `Progress: ${percent.toFixed(2)}% (${formatBytes(currentUploaded)} / ${formatBytes(file.size)})`;
                        speedText.textContent = `Speed: ${formatBytes(bytesPerSecond)}/s`;
                        etaText.textContent = `ETA: ${formatDuration(remainingSeconds)}`;
                        statusText.textContent = `Status: uploading chunk ${Math.floor(start / chunkSize) + 1}`;
                        statusText.className = 'muted';
                    };

                    xhr.onload = () => {
                        if (xhr.status >= 200 && xhr.status < 300) {
                            resolve(end);
                            return;
                        }

                        reject(new Error(`Chunk upload failed (${xhr.status})`));
                    };

                    xhr.onerror = () => reject(new Error('Network error'));
                    xhr.send(chunk);
                }).catch(async (error) => {
                    if (attempt >= 5) {
                        throw error;
                    }

                    statusText.textContent = `Status: retrying chunk after error (${attempt}/5)`;
                    statusText.className = 'error';
                    await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
                    return uploadChunk(start, attempt + 1);
                });
            }

            while (uploadedBytes < file.size) {
                uploadedBytes = await uploadChunk(uploadedBytes);
            }

            progressFill.style.width = '100%';
            progressText.textContent = `Progress: 100.00% (${formatBytes(file.size)} / ${formatBytes(file.size)})`;
            etaText.textContent = 'ETA: 0s';
            statusText.textContent = 'Status: upload completed';
            statusText.className = 'ok';
            startButton.disabled = false;
        } catch (error) {
            startButton.disabled = false;
            statusText.textContent = `Status: ${error.message}`;
            statusText.className = 'error';
        }
    });
    </script>
    </body>
    </html>
    <?php
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
        redirect_route('create_server');
    }

    $payload = [
        'instance_id' => $instanceId,
        'server_name' => $serverName ?: $instanceId,
        'image_name' => $imageName,
        'shared_game_path' => (string) ($host['shared_game_path'] ?? '/opt/fs25/game'),
        'shared_dlc_path' => (string) ($host['shared_dlc_path'] ?? '/opt/fs25/dlc'),
        'shared_installer_path' => (string) ($host['shared_installer_path'] ?? '/opt/fs25/installer'),
        'server_password' => (string)($_POST['server_password'] ?? ''),
        'server_admin' => (string)($_POST['server_admin'] ?? ''),
        'server_players' => (int)($_POST['server_players'] ?? 16),
        'server_port' => (int)($_POST['server_port'] ?? 10823),
        'web_port' => (int)($_POST['web_port'] ?? 18000),
        'vnc_port' => (int)($_POST['vnc_port'] ?? 5900),
        'novnc_port' => (int)($_POST['novnc_port'] ?? 6080),
        'sftp_port' => (int)($_POST['sftp_port'] ?? 2222),
        'sftp_username' => (string)($_POST['sftp_username'] ?? 'fs25'),
        'sftp_password' => (string)($_POST['sftp_password'] ?? 'changeme'),
        'server_region' => (string)($_POST['server_region'] ?? 'en'),
        'server_map' => (string)($_POST['server_map'] ?? 'MapUS'),
        'server_difficulty' => (int)($_POST['server_difficulty'] ?? 3),
        'server_pause' => (int)($_POST['server_pause'] ?? 2),
        'server_save_interval' => (float)($_POST['server_save_interval'] ?? 180),
        'server_stats_interval' => (int)($_POST['server_stats_interval'] ?? 31536000),
        'server_crossplay' => isset($_POST['server_crossplay']),
        'autostart_server' => (string)($_POST['autostart_server'] ?? 'true'),
        'puid' => (int)($_POST['puid'] ?? 1000),
        'pgid' => (int)($_POST['pgid'] ?? 1000),
        'vnc_password' => (string)($_POST['vnc_password'] ?? 'changeme'),
        'web_username' => (string)($_POST['web_username'] ?? 'admin'),
        'web_password' => (string)($_POST['web_password'] ?? 'changeme'),
    ];

    $agent = agent_post_for_host($host, '/instance/create', $payload);

    if (!($agent['ok'] ?? false)) {
        flash('Create failed: ' . ($agent['error'] ?? 'Unknown error'));
        redirect_route('create_server');
    }

    $stmt = db()->prepare('
        INSERT INTO server_instances
        (host_id, instance_id, server_name, image_name, server_port, web_port, vnc_port, novnc_port, sftp_port, sftp_username, sftp_password, server_players, server_region, server_map, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        $payload['sftp_port'],
        $payload['sftp_username'],
        $payload['sftp_password'],
        $payload['server_players'],
        $payload['server_region'],
        $payload['server_map'],
        'created',
    ]);

    flash('Server created.');
    redirect_route('game_servers');
}

if ($route === 'action' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    require_login();

    $instanceId = (string)($_POST['instance_id'] ?? '');
    $action = (string)($_POST['action'] ?? '');
    $server = find_instance_with_host($instanceId);

    if (!$server || !(int) ($server['is_enabled'] ?? 0)) {
        flash('Managed host for this server is missing or disabled.');
        redirect_route('game_servers');
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

    redirect_route('game_servers');
}

if ($route === 'logs') {
    require_login();

    $instanceId = (string) ($_GET['instance_id'] ?? '');
    $server = find_instance_with_host($instanceId);

    if (!$server || !(int) ($server['is_enabled'] ?? 0)) {
        flash('Managed host for this server is missing or disabled.');
        redirect_route('game_servers');
    }

    $agent = agent_post_for_host($server, '/instance/action', [
        'instance_id' => $instanceId,
        'action' => 'logs',
    ]);

    $logOutput = $agent['result']['stdout'] ?? ($agent['result']['stderr'] ?? 'No logs returned');
    ?><!doctype html>
    <html lang="en">
    <head>
        <meta charset="utf-8">
        <title><?= h($server['server_name']) ?> Logs</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
            * { box-sizing: border-box; }
            body { margin: 0; font-family: Arial, sans-serif; background: #0b1020; color: #f2f4f8; }
            .page { min-height: 100vh; display: grid; grid-template-rows: auto 1fr; }
            .topbar { display: flex; justify-content: space-between; align-items: center; gap: 16px; padding: 16px 20px; border-bottom: 1px solid #243041; background: #121826; }
            .meta { display: grid; gap: 4px; }
            .muted { color: #a8b3c7; font-size: 14px; }
            .actions { display: flex; gap: 10px; flex-wrap: wrap; }
            .button-link { display: inline-block; padding: 10px 14px; border-radius: 8px; background: #475569; color: #fff; text-decoration: none; }
            .button-link.primary { background: #2563eb; }
            .content { padding: 20px; }
            pre { margin: 0; white-space: pre-wrap; word-break: break-word; background: #050814; border: 1px solid #243041; border-radius: 12px; padding: 16px; min-height: calc(100vh - 120px); overflow: auto; }
        </style>
    </head>
    <body>
    <div class="page">
        <div class="topbar">
            <div class="meta">
                <strong><?= h($server['server_name']) ?></strong>
                <div class="muted"><?= h($server['instance_id']) ?> on <?= h($server['host_name'] ?? 'managed host') ?></div>
            </div>
            <div class="actions">
                <a class="button-link" href="/?route=game_servers">Back to Game Servers</a>
                <a class="button-link primary" href="/?route=logs&amp;instance_id=<?= h($server['instance_id']) ?>">Refresh Logs</a>
            </div>
        </div>
        <div class="content">
            <pre><?= h($logOutput) ?></pre>
        </div>
    </div>
    </body>
    </html>
    <?php
    exit;
}

if ($route === 'delete' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    require_login();

    $instanceId = (string)($_POST['instance_id'] ?? '');
    $server = find_instance_with_host($instanceId);

    if (!$server || !(int) ($server['is_enabled'] ?? 0)) {
        flash('Managed host for this server is missing or disabled.');
        redirect_route('game_servers');
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

    redirect_route('game_servers');
}

if ($route === 'upload' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    require_login();

    $instanceId = (string) ($_POST['instance_id'] ?? '');
    $target = (string) ($_POST['target'] ?? 'mods');
    $server = find_instance_with_host($instanceId);

    if (!$server || !(int) ($server['is_enabled'] ?? 0)) {
        flash('Managed host for this server is missing or disabled.');
        redirect_route('game_servers');
    }

    $result = upload_instance_file_for_host($server, $instanceId, $target, $_FILES['upload_file'] ?? []);

    flash(($result['ok'] ?? false)
        ? 'File uploaded.'
        : 'Upload failed: ' . ($result['error'] ?? 'Unknown error'));

    redirect_route('game_servers');
}

if ($route === 'console') {
    require_login();

    $instanceId = (string) ($_GET['instance_id'] ?? '');
    $server = find_instance_with_host($instanceId);

    if (!$server || !(int) ($server['is_enabled'] ?? 0)) {
        flash('Managed host for this server is missing or disabled.');
        redirect_route('game_servers');
    }

    $novncUrl = instance_access_url($server, 'novnc');

    if (!$novncUrl) {
        flash('noVNC URL is not available for this server.');
        redirect_route('game_servers');
    }

    $webUrl = instance_access_url($server, 'web');
    $flash = flash();
    ?><!doctype html>
    <html lang="en">
    <head>
        <meta charset="utf-8">
        <title><?= h($server['server_name']) ?> VNC Viewer</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
            * { box-sizing: border-box; }
            body { margin: 0; font-family: Arial, sans-serif; background: #0b1020; color: #f2f4f8; }
            .console-shell { min-height: 100vh; display: grid; grid-template-rows: auto 1fr; }
            .console-bar { display: flex; justify-content: space-between; align-items: center; gap: 16px; padding: 16px 20px; border-bottom: 1px solid #243041; background: #121826; }
            .console-meta { display: grid; gap: 4px; }
            .console-actions { display: flex; gap: 10px; flex-wrap: wrap; }
            .button-link { display: inline-block; padding: 10px 14px; border-radius: 8px; background: #475569; color: #fff; text-decoration: none; }
            .button-link.primary { background: #2563eb; }
            .muted { color: #a8b3c7; font-size: 14px; }
            .flash { margin: 12px 20px 0; padding: 12px; background: #1d4ed8; border-radius: 10px; }
            iframe { width: 100%; height: calc(100vh - 81px); border: 0; background: #050814; }
        </style>
    </head>
    <body>
    <div class="console-shell">
        <div>
            <?php if ($flash): ?><div class="flash"><?= h($flash) ?></div><?php endif; ?>
            <div class="console-bar">
                <div class="console-meta">
                    <strong><?= h($server['server_name']) ?></strong>
                    <div class="muted"><?= h($server['instance_id']) ?> on <?= h($server['host_name'] ?? 'managed host') ?></div>
                </div>
                <div class="console-actions">
                    <a class="button-link" href="/?route=game_servers">Back to Game Servers</a>
                    <?php if ($webUrl): ?>
                        <a class="button-link" href="/?route=web_admin&amp;instance_id=<?= h($server['instance_id']) ?>">Game Webpage</a>
                    <?php endif; ?>
                    <a class="button-link primary" href="<?= h($novncUrl) ?>" target="_blank" rel="noreferrer">Open Direct VNC</a>
                </div>
            </div>
        </div>
        <iframe src="<?= h($novncUrl) ?>" allowfullscreen loading="eager"></iframe>
    </div>
    </body>
    </html>
    <?php
    exit;
}

if ($route === 'web_admin') {
    require_login();

    $instanceId = (string) ($_GET['instance_id'] ?? '');
    $server = find_instance_with_host($instanceId);

    if (!$server || !(int) ($server['is_enabled'] ?? 0)) {
        flash('Managed host for this server is missing or disabled.');
        redirect_route('game_servers');
    }

    $webUrl = instance_access_url($server, 'web');

    if (!$webUrl) {
        flash('Web admin URL is not available for this server.');
        redirect_route('game_servers');
    }

    $flash = flash();
    ?><!doctype html>
    <html lang="en">
    <head>
        <meta charset="utf-8">
        <title><?= h($server['server_name']) ?> Web Admin</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
            * { box-sizing: border-box; }
            body { margin: 0; font-family: Arial, sans-serif; background: #0b1020; color: #f2f4f8; }
            .console-shell { min-height: 100vh; display: grid; grid-template-rows: auto 1fr; }
            .console-bar { display: flex; justify-content: space-between; align-items: center; gap: 16px; padding: 16px 20px; border-bottom: 1px solid #243041; background: #121826; }
            .console-meta { display: grid; gap: 4px; }
            .console-actions { display: flex; gap: 10px; flex-wrap: wrap; }
            .button-link { display: inline-block; padding: 10px 14px; border-radius: 8px; background: #475569; color: #fff; text-decoration: none; }
            .button-link.primary { background: #2563eb; }
            .muted { color: #a8b3c7; font-size: 14px; }
            .flash { margin: 12px 20px 0; padding: 12px; background: #1d4ed8; border-radius: 10px; }
            iframe { width: 100%; height: calc(100vh - 81px); border: 0; background: #fff; }
        </style>
    </head>
    <body>
    <div class="console-shell">
        <div>
            <?php if ($flash): ?><div class="flash"><?= h($flash) ?></div><?php endif; ?>
            <div class="console-bar">
                <div class="console-meta">
                    <strong><?= h($server['server_name']) ?></strong>
                    <div class="muted"><?= h($server['instance_id']) ?> on <?= h($server['host_name'] ?? 'managed host') ?> | use this viewer to install FS25 and enter the CD key when needed</div>
                </div>
                <div class="console-actions">
                    <a class="button-link" href="/?route=game_servers">Back to Game Servers</a>
                    <a class="button-link" href="/?route=console&amp;instance_id=<?= h($server['instance_id']) ?>">VNC Viewer</a>
                    <a class="button-link primary" href="<?= h($webUrl) ?>" target="_blank" rel="noreferrer">Open Direct</a>
                </div>
            </div>
        </div>
        <iframe src="<?= h($webUrl) ?>" loading="eager"></iframe>
    </div>
    </body>
    </html>
    <?php
    exit;
}

if (!current_user() && $route !== 'login') {
    header('Location: /?route=login');
    exit;
}

$flash = flash();
$logs = $_SESSION['logs'] ?? null;
unset($_SESSION['logs']);
$pageRoute = in_array($route, ['managed_hosts', 'file_management', 'game_servers', 'create_server'], true)
    ? $route
    : 'game_servers';

?><!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <title>FSG FS25 Panel</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
        * { box-sizing: border-box; }
        body { font-family: Arial, sans-serif; background: linear-gradient(180deg, #0c1118 0%, #101722 45%, #0d131d 100%); color: #f2f4f8; margin: 0; }
        .shell { min-height: 100vh; display: grid; grid-template-rows: auto 1fr auto; }
        .topbar { position: sticky; top: 0; z-index: 20; backdrop-filter: blur(12px); background: rgba(10, 14, 22, 0.92); border-bottom: 1px solid #243041; }
        .topbar-inner { max-width: 1240px; margin: 0 auto; padding: 16px 24px; display: flex; justify-content: space-between; align-items: center; gap: 20px; }
        .brand { display: grid; gap: 4px; }
        .brand-title { font-size: 20px; font-weight: 700; letter-spacing: 0.02em; }
        .brand-copy { color: #8ea0bc; font-size: 13px; }
        .nav { display: flex; gap: 10px; flex-wrap: wrap; }
        .nav-link { display: inline-block; padding: 10px 14px; border-radius: 999px; color: #c5d0e0; border: 1px solid #243041; background: rgba(17, 24, 38, 0.72); text-decoration: none; }
        .nav-link.active { background: linear-gradient(135deg, #2563eb, #0891b2); border-color: transparent; color: #fff; }
        .wrap { max-width: 1240px; margin: 0 auto; padding: 28px 24px 40px; }
        .hero { display: grid; gap: 10px; margin-bottom: 24px; padding: 24px; border-radius: 18px; border: 1px solid #243041; background: radial-gradient(circle at top left, rgba(37, 99, 235, 0.18), rgba(14, 20, 32, 0.98) 45%), #121826; }
        .hero h1 { margin: 0; font-size: 34px; }
        .hero p { margin: 0; max-width: 880px; color: #b2bfd3; }
        .page-grid { display: grid; gap: 20px; }
        .page-grid.two { grid-template-columns: minmax(0, 1.2fr) minmax(320px, 0.8fr); align-items: start; }
        .card { background: rgba(23, 28, 37, 0.96); border: 1px solid #2a3240; border-radius: 16px; padding: 20px; margin-bottom: 20px; box-shadow: 0 18px 40px rgba(0, 0, 0, 0.18); }
        input, select { width: 100%; padding: 10px 12px; border-radius: 8px; border: 1px solid #334155; background: #0f172a; color: #fff; }
        button { padding: 10px 14px; border-radius: 8px; border: 0; cursor: pointer; background: #2563eb; color: #fff; }
        button.danger { background: #b91c1c; }
        button.gray { background: #475569; }
        .button-link { display: inline-block; padding: 10px 14px; border-radius: 8px; background: #475569; color: #fff; }
        .stack { display: grid; gap: 10px; }
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
        .server-cell { min-width: 260px; }
        .server-actions { margin-top: 12px; padding-top: 12px; border-top: 1px solid #243041; }
        .server-meta { display: grid; gap: 6px; }
        .small { font-size: 13px; }
        .dir-list { display: grid; gap: 8px; margin-top: 12px; }
        .dir-item { display: grid; gap: 6px; padding: 10px; border: 1px solid #243041; border-radius: 10px; background: #0f172a; }
        .notice { padding: 14px 16px; border-radius: 12px; background: #101827; border: 1px solid #243041; color: #bdc8d8; }
        .footer { border-top: 1px solid #243041; background: rgba(10, 14, 22, 0.9); }
        .footer-inner { max-width: 1240px; margin: 0 auto; padding: 18px 24px 24px; display: flex; justify-content: space-between; gap: 18px; flex-wrap: wrap; color: #8ea0bc; font-size: 13px; }
        @media (max-width: 900px) {
            .grid-2, .grid-4, .page-grid.two { grid-template-columns: 1fr; }
            .topbar-inner { align-items: start; flex-direction: column; }
        }
    </style>
</head>
<body>
<div class="shell">
    <?php if ($route === 'login'): ?>
        <div class="wrap" style="display:grid;place-items:center;">
            <div class="card" style="width:min(100%, 440px); margin: 80px auto;">
                <h1>FSG FS25 Panel</h1>
                <p class="muted">Sign in to manage hosts, installer files, and FS25 server instances from one control plane.</p>
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
        <header class="topbar">
            <div class="topbar-inner">
                <div class="brand">
                    <div class="brand-title">FSG FS25 Control Panel</div>
                    <div class="brand-copy">Logged in as <?= h(current_user()['username']) ?>. Manage hosts, files, and servers from one place.</div>
                </div>
                <nav class="nav">
                    <a class="nav-link <?= $pageRoute === 'managed_hosts' ? 'active' : '' ?>" href="/?route=managed_hosts">Managed Hosts</a>
                    <a class="nav-link <?= $pageRoute === 'file_management' ? 'active' : '' ?>" href="/?route=file_management">File Management</a>
                    <a class="nav-link <?= $pageRoute === 'game_servers' ? 'active' : '' ?>" href="/?route=game_servers">Game Servers</a>
                    <a class="nav-link <?= $pageRoute === 'create_server' ? 'active' : '' ?>" href="/?route=create_server">Create Server</a>
                    <a class="nav-link" href="/?route=logout">Logout</a>
                </nav>
            </div>
        </header>
        <main class="wrap">
        <?php if ($flash): ?><div class="flash"><?= h($flash) ?></div><?php endif; ?>

        <?php if ($pageRoute === 'managed_hosts'): ?>
            <section class="hero">
                <h1>Managed Hosts</h1>
                <p>This page defines which machines the panel can control. Add a host once, set its shared FS paths, prepare storage, and confirm the agent is reachable before creating servers on it.</p>
            </section>
        <?php elseif ($pageRoute === 'file_management'): ?>
            <section class="hero">
                <h1>File Management</h1>
                <p>Use this page to handle shared installer files and host-level content. This is where you upload large installer archives, review what is present, and unzip installer packages in place.</p>
            </section>
        <?php elseif ($pageRoute === 'create_server'): ?>
            <section class="hero">
                <h1>Create Server</h1>
                <p>Build a new FS25 server instance on a managed host. Choose a prepared host, set unique ports, and provision a new server from one form.</p>
            </section>
        <?php else: ?>
            <section class="hero">
                <h1>Game Servers</h1>
                <p>This page is the operational view for existing servers. Open the VNC viewer, inspect logs, upload per-server files, and run lifecycle actions from here.</p>
            </section>
        <?php endif; ?>

        <?php if ($pageRoute === 'managed_hosts'): ?>
        <div class="page-grid two">
        <div class="card">
            <h2>Managed Hosts</h2>
            <div class="notice" style="margin-bottom:16px;">Register a machine running the internal agent. The shared paths tell the panel where host-wide game files, DLC, and installers live.</div>
            <form method="post" action="/?route=host_create" class="grid">
                <div><label>Host Name</label><input name="name" placeholder="Node A" required></div>
                <div><label>Agent API URL</label><input name="agent_url" placeholder="http://host-or-agent:8081" required></div>
                <div><label>Agent Token</label><input name="agent_token" type="password" required></div>
                <div><label>Shared Game Path</label><input name="shared_game_path" value="/opt/fs25/game" required></div>
                <div><label>Shared DLC Path</label><input name="shared_dlc_path" value="/opt/fs25/dlc" required></div>
                <div><label>Shared Installer Path</label><input name="shared_installer_path" value="/opt/fs25/installer" required></div>
                <div><button type="submit">Add Managed Host</button></div>
            </form>
        </div>
        <div class="card">
            <h2>How To Use This Page</h2>
            <div class="stack muted">
                <div>1. Add the host with its agent URL and token.</div>
                <div>2. Verify the host shows as online.</div>
                <div>3. Prepare storage once so shared folders exist.</div>
                <div>4. Use File Management to upload installer archives or DLC.</div>
                <div>5. Create servers on this host after the shared files are ready.</div>
            </div>
        </div>
        </div>
        <div class="card">
            <h2>Registered Hosts</h2>
            <table>
                        <thead>
                            <tr>
                                <th>Name</th>
                                <th>API URL</th>
                                <th>Shared FS</th>
                                <th>Status</th>
                                <th>Setup</th>
                            </tr>
                        </thead>
                        <tbody>
                        <?php foreach ($hosts as $host): ?>
                            <?php $health = agent_health_for_host($host); ?>
                            <tr>
                                <td><?= h($host['name']) ?></td>
                                <td><?= h($host['agent_url']) ?></td>
                                <td>
                                    <div class="stack muted">
                                        <div>game: <?= h($host['shared_game_path'] ?? '/opt/fs25/game') ?></div>
                                        <div>dlc: <?= h($host['shared_dlc_path'] ?? '/opt/fs25/dlc') ?></div>
                                        <div>installer: <?= h($host['shared_installer_path'] ?? '/opt/fs25/installer') ?></div>
                                    </div>
                                </td>
                                <td><?= h(($health['ok'] ?? false) ? 'online' : 'offline') ?></td>
                                <td>
                                    <form method="post" action="/?route=host_prepare" style="margin-bottom:10px;">
                                        <input type="hidden" name="host_id" value="<?= h((string) $host['id']) ?>">
                                        <button class="gray" type="submit">prepare storage</button>
                                    </form>
                                    <a class="button-link" href="/?route=file_management">open file management</a>
                                </td>
                            </tr>
                        <?php endforeach; ?>
                        <?php if (!$hosts): ?>
                            <tr><td colspan="5" class="muted">No managed hosts configured yet.</td></tr>
                        <?php endif; ?>
                        </tbody>
                    </table>
        </div>
        <?php endif; ?>

        <?php if ($pageRoute === 'file_management'): ?>
        <div class="page-grid two">
            <div class="card">
                <h2>How To Use This Page</h2>
                <div class="stack muted">
                    <div>1. Open installer upload for the host you want to prepare.</div>
                    <div>2. Verify uploaded files appear in the installer listing.</div>
                    <div>3. Use the unzip button on any zip archive found in that folder.</div>
                    <div>4. Use the Game Servers page for per-server uploads like mods and saves.</div>
                </div>
            </div>
            <div class="card">
                <h2>What This Page Does</h2>
                <div class="notice">This page is focused on host-wide file operations. It shows the shared installer folder for each host and gives you upload and unzip actions in one place.</div>
            </div>
        </div>
        <?php if (!$hosts): ?>
            <div class="card">
                <div class="notice">No managed hosts are configured yet. Add a host on the Managed Hosts page before using file operations.</div>
            </div>
        <?php endif; ?>
        <?php foreach ($hosts as $host): ?>
            <?php
                $health = agent_health_for_host($host);
                $installerListing = ($health['ok'] ?? false) ? installer_directory_listing_for_host($host) : ['ok' => false, 'files' => []];
            ?>
            <div class="card">
                <div class="flex" style="justify-content:space-between;align-items:center;">
                    <div>
                        <h2 style="margin-bottom:6px;"><?= h($host['name']) ?></h2>
                        <div class="muted">Installer path: <?= h($host['shared_installer_path'] ?? '/opt/fs25/installer') ?> | Status: <?= h(($health['ok'] ?? false) ? 'online' : 'offline') ?></div>
                    </div>
                    <a class="button-link" href="/?route=installer_upload&amp;host_id=<?= h((string) $host['id']) ?>">installer upload</a>
                </div>
                <div class="dir-list">
                    <?php foreach (($installerListing['files'] ?? []) as $entry): ?>
                        <div class="dir-item">
                            <div class="muted"><?= h($entry['name']) ?></div>
                            <div class="muted small"><?= h($entry['is_dir'] ? 'directory' : 'file') ?><?php if ($entry['is_file']): ?> | <?= h((string) $entry['size']) ?> bytes<?php endif; ?></div>
                            <?php if (($entry['is_zip'] ?? false) === true): ?>
                                <form method="post" action="/?route=installer_unzip">
                                    <input type="hidden" name="host_id" value="<?= h((string) $host['id']) ?>">
                                    <input type="hidden" name="filename" value="<?= h($entry['name']) ?>">
                                    <button class="gray" type="submit">unzip zip</button>
                                </form>
                            <?php endif; ?>
                        </div>
                    <?php endforeach; ?>
                    <?php if (!(($installerListing['files'] ?? []))): ?>
                        <div class="muted small">No installer files found.</div>
                    <?php endif; ?>
                </div>
            </div>
        <?php endforeach; ?>
        <?php endif; ?>

        <?php if ($pageRoute === 'create_server'): ?>
        <div class="page-grid two">
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

                <div><label>SFTP Port</label><input name="sftp_port" type="number" value="2222"></div>
                <div><label>SFTP Username</label><input name="sftp_username" value="fs25"></div>
                <div><label>SFTP Password</label><input name="sftp_password" value="changeme"></div>
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
                <div>
                    <label>Startup Mode</label>
                    <select name="autostart_server">
                        <option value="true" selected>Auto start server</option>
                        <option value="web_only">Web panel only</option>
                        <option value="false">Manual start</option>
                    </select>
                </div>
                <div style="display:flex;align-items:end;"><button type="submit">Create Server</button></div>
            </form>
        </div>
        <div class="card">
            <h2>How To Use This Page</h2>
            <div class="stack muted">
                <div>1. Pick a managed host that already has shared files ready.</div>
                <div>2. Set unique ports for game, web admin, VNC, noVNC, and SFTP.</div>
                <div>3. Choose startup behavior based on whether the server should boot automatically.</div>
                <div>4. Create the server, then switch to Game Servers to start it and open the viewer pages.</div>
            </div>
        </div>
        </div>
        <?php endif; ?>

        <?php if ($pageRoute === 'game_servers'): ?>
        <div class="page-grid two">
            <div class="card">
                <h2>How To Use This Page</h2>
                <div class="stack muted">
                    <div>1. Use the access section to open VNC Viewer or the game webpage.</div>
                    <div>2. Use the action row for lifecycle tasks like start, stop, restart, pull, and rebuild.</div>
                    <div>3. Use the logs button to inspect runtime output for one server.</div>
                    <div>4. Upload mods, saves, or config files in the per-server upload form.</div>
                </div>
            </div>
            <div class="card">
                <h2>Current Estate</h2>
                <div class="stack muted">
                    <div>Managed hosts: <?= h((string) count($hosts)) ?></div>
                    <div>Game servers: <?= h((string) count($servers)) ?></div>
                    <div>Page purpose: day-to-day server operations</div>
                </div>
            </div>
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
                        <th>SFTP</th>
                        <th>Access</th>
                    </tr>
                </thead>
                <tbody>
                <?php foreach ($servers as $server): ?>
                    <?php
                        $webUrl = instance_access_url($server, 'web');
                        $novncUrl = instance_access_url($server, 'novnc');
                        $vncPanelUrl = '/?route=console&instance_id=' . rawurlencode((string) $server['instance_id']);
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
                            <div class="stack muted">
                                <div><?= h((string)$server['sftp_port']) ?></div>
                                <div><?= h($server['sftp_username'] ?? 'fs25') ?></div>
                            </div>
                        </td>
                        <td class="server-cell">
                            <div class="server-meta">
                                <div class="flex">
                                <?php if ($novncUrl): ?>
                                    <a class="button-link" href="<?= h($vncPanelUrl) ?>">VNC Viewer</a>
                                <?php endif; ?>
                                <?php if ($webUrl): ?>
                                    <a class="button-link" href="<?= h($webUrl) ?>" target="_blank" rel="noreferrer">game webpage</a>
                                <?php endif; ?>
                                </div>
                                <div class="stack muted small">
                                    <div>VNC page: <a href="<?= h($vncPanelUrl) ?>"><?= h($vncPanelUrl) ?></a></div>
                                <div>SFTP host: <?= h(parse_url((string)($server['agent_url'] ?? ''), PHP_URL_HOST) ?: 'host') ?></div>
                                <div>SFTP user: <?= h($server['sftp_username'] ?? 'fs25') ?></div>
                                <div>SFTP pass: <?= h($server['sftp_password'] ?? 'changeme') ?></div>
                                <div>Profile path: FarmingSimulator2025</div>
                            </div>
                            </div>
                            <div class="flex server-actions">
                                <?php foreach (['start','stop','restart','pull','rebuild'] as $act): ?>
                                    <form method="post" action="/?route=action">
                                        <input type="hidden" name="instance_id" value="<?= h($server['instance_id']) ?>">
                                        <input type="hidden" name="action" value="<?= h($act) ?>">
                                        <button class="<?= $act === 'logs' ? 'gray' : '' ?>" type="submit"><?= h($act) ?></button>
                                    </form>
                                <?php endforeach; ?>
                                <a class="button-link" href="/?route=logs&amp;instance_id=<?= h($server['instance_id']) ?>">logs</a>
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
        <?php endif; ?>

        <?php if ($logs): ?>
            <div class="card">
                <h2>Recent Logs</h2>
                <pre><?= h($logs) ?></pre>
            </div>
        <?php endif; ?>
        </main>
        <footer class="footer">
            <div class="footer-inner">
                <div>FSG FS25 Control Panel</div>
                <div>Use Managed Hosts to connect machines, File Management to handle installers, Create Server for provisioning, and Game Servers for day-to-day operations.</div>
            </div>
        </footer>
    <?php endif; ?>
</div>
</body>
</html>
