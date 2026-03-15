<?php

declare(strict_types=1);

require __DIR__ . '/../src/bootstrap.php';

function redirect_route(string $route): void
{
    header('Location: /?route=' . rawurlencode($route));
    exit;
}

function json_response(array $payload, int $status = 200): void
{
    http_response_code($status);
    header('Content-Type: application/json');
    echo json_encode($payload, JSON_PRETTY_PRINT);
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

if ($route === 'api_node_status') {
    if (!node_api_request_authorized()) {
        json_response(['ok' => false, 'error' => node_api_enabled() ? 'Unauthorized' : 'Node API is disabled'], node_api_enabled() ? 401 : 503);
    }

    json_response([
        'ok' => true,
        'api_version' => '1.0',
        'summary' => node_summary(),
    ]);
}

if ($route === 'api_node_hosts') {
    if (!node_api_request_authorized()) {
        json_response(['ok' => false, 'error' => node_api_enabled() ? 'Unauthorized' : 'Node API is disabled'], node_api_enabled() ? 401 : 503);
    }

    $hosts = array_map(static function (array $host): array {
        $health = agent_health_for_host($host);

        return [
            'id' => (int) $host['id'],
            'name' => (string) $host['name'],
            'agent_url' => (string) $host['agent_url'],
            'access_host' => (string) ($host['access_host'] ?? ''),
            'shared_game_path' => (string) ($host['shared_game_path'] ?? '/opt/fs25/game'),
            'shared_dlc_path' => (string) ($host['shared_dlc_path'] ?? '/opt/fs25/dlc'),
            'shared_installer_path' => (string) ($host['shared_installer_path'] ?? '/opt/fs25/installer'),
            'is_enabled' => (bool) ($host['is_enabled'] ?? false),
            'health' => $health,
        ];
    }, all_hosts());

    json_response([
        'ok' => true,
        'node' => local_node_config(),
        'hosts' => $hosts,
    ]);
}

if ($route === 'api_node_servers') {
    if (!node_api_request_authorized()) {
        json_response(['ok' => false, 'error' => node_api_enabled() ? 'Unauthorized' : 'Node API is disabled'], node_api_enabled() ? 401 : 503);
    }

    $servers = db()->query('
        SELECT
            si.*,
            mh.name AS host_name,
            mh.agent_url,
            mh.access_host
        FROM server_instances si
        LEFT JOIN managed_hosts mh ON mh.id = si.host_id
        ORDER BY si.created_at DESC
    ')->fetchAll();

    $payload = array_map(static function (array $server): array {
        return [
            'instance_id' => (string) $server['instance_id'],
            'server_name' => (string) $server['server_name'],
            'status' => (string) $server['status'],
            'host_id' => isset($server['host_id']) ? (int) $server['host_id'] : null,
            'host_name' => (string) ($server['host_name'] ?? ''),
            'server_port' => (int) ($server['server_port'] ?? 0),
            'web_port' => (int) ($server['web_port'] ?? 0),
            'vnc_port' => (int) ($server['vnc_port'] ?? 0),
            'novnc_port' => (int) ($server['novnc_port'] ?? 0),
            'sftp_port' => (int) ($server['sftp_port'] ?? 0),
            'sftp_username' => (string) ($server['sftp_username'] ?? ''),
            'web_url' => instance_access_url($server, 'web'),
            'vnc_url' => instance_access_url($server, 'vnc'),
            'novnc_url' => instance_access_url($server, 'novnc'),
            'sftp_url' => instance_access_url($server, 'sftp'),
            'created_at' => (string) ($server['created_at'] ?? ''),
            'updated_at' => (string) ($server['updated_at'] ?? ''),
        ];
    }, $servers);

    json_response([
        'ok' => true,
        'node' => local_node_config(),
        'servers' => $payload,
    ]);
}

if ($route === 'host_update' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    require_login();

    $hostId = (int) ($_POST['host_id'] ?? 0);
    $host = find_host($hostId);
    $name = trim((string) ($_POST['name'] ?? ''));
    $agentUrl = trim((string) ($_POST['agent_url'] ?? ''));
    $accessHost = trim((string) ($_POST['access_host'] ?? ''));
    $agentToken = trim((string) ($_POST['agent_token'] ?? ''));
    $sharedGamePath = trim((string) ($_POST['shared_game_path'] ?? '/opt/fs25/game'));
    $sharedDlcPath = trim((string) ($_POST['shared_dlc_path'] ?? '/opt/fs25/dlc'));
    $sharedInstallerPath = trim((string) ($_POST['shared_installer_path'] ?? '/opt/fs25/installer'));

    if (!$host) {
        flash('Default host record was not found.');
        redirect_route('managed_hosts');
    }

    if ($name === '' || $agentUrl === '' || $agentToken === '') {
        flash('Host name, API URL, and token are required.');
        redirect_route('managed_hosts');
    }

    $stmt = db()->prepare('
        UPDATE managed_hosts
        SET name = ?, agent_url = ?, access_host = ?, agent_token = ?, shared_game_path = ?, shared_dlc_path = ?, shared_installer_path = ?
        WHERE id = ?
    ');
    $stmt->execute([$name, $agentUrl, $accessHost, $agentToken, $sharedGamePath, $sharedDlcPath, $sharedInstallerPath, $hostId]);

    flash('Default host updated.');
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

if ($route === 'upload_token') {
    require_login();

    $hostId = (int) ($_GET['host_id'] ?? 0);
    $instanceId = (string) ($_GET['instance_id'] ?? '');
    $target = trim((string) ($_GET['target'] ?? 'installer'));
    $filename = basename((string) ($_GET['filename'] ?? ''));
    $server = $instanceId !== '' ? find_instance_with_host($instanceId) : null;
    $host = $server ?: find_host($hostId);
    $subpath = trim((string) ($_GET['subpath'] ?? ''));
    $context = upload_context_for_request($server ? null : $host, $server, $target);
    $context = $context ? context_with_subpath($context, $subpath) : null;

    if (!$host || !(int) ($host['is_enabled'] ?? 0) || !$context) {
        // Log target resolution failures so path issues can be traced from the web container logs.
        error_log(sprintf(
            '[upload_token] invalid target host_id=%d instance_id=%s target=%s subpath=%s',
            $hostId,
            $instanceId,
            $target,
            $subpath
        ));
        header('Content-Type: application/json', true, 404);
        echo json_encode(['ok' => false, 'error' => 'Upload target not found']);
        exit;
    }

    $access = file_access_status_for_context($context);
    if (!(bool) ($access['ok'] ?? false) || !(bool) (($access['status']['writable'] ?? false))) {
        error_log(sprintf(
            '[upload_token] target not writable path=%s host_id=%d instance_id=%s target=%s subpath=%s access=%s',
            (string) $context['path'],
            $hostId,
            $instanceId,
            $target,
            $subpath,
            json_encode($access)
        ));
        header('Content-Type: application/json', true, 409);
        echo json_encode([
            'ok' => false,
            'error' => 'Upload target is not writable from the agent container',
            'access' => $access,
        ]);
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
        // Preserve the validated subpath so the chunk endpoint writes to the same directory context.
        'upload_url' => '/?route=upload_chunk'
            . '&host_id=' . rawurlencode((string) ($host['id'] ?? 0))
            . '&target=' . rawurlencode($target)
            . ($server ? '&instance_id=' . rawurlencode($instanceId) : '')
            . ($subpath !== '' ? '&subpath=' . rawurlencode($subpath) : '')
            . '&filename=' . rawurlencode($filename),
        'filename' => $filename,
        'target_label' => $context['label'],
        'path' => $context['path'],
        'subpath' => $subpath,
    ]);
    exit;
}

if ($route === 'upload_chunk' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    require_login();
    session_write_close();

    $hostId = (int) ($_GET['host_id'] ?? 0);
    $instanceId = (string) ($_GET['instance_id'] ?? '');
    $target = trim((string) ($_GET['target'] ?? 'installer'));
    $filename = basename((string) ($_GET['filename'] ?? ''));
    $offset = (int) ($_GET['offset'] ?? 0);
    $totalSize = (int) ($_GET['total_size'] ?? 0);
    $isLastChunk = (string) ($_GET['is_last'] ?? '0') === '1';
    $server = $instanceId !== '' ? find_instance_with_host($instanceId) : null;
    $host = $server ?: find_host($hostId);
    $subpath = trim((string) ($_GET['subpath'] ?? ''));
    $context = upload_context_for_request($server ? null : $host, $server, $target);
    $context = $context ? context_with_subpath($context, $subpath) : null;

    if (!$host || !(int) ($host['is_enabled'] ?? 0) || !$context) {
        error_log(sprintf(
            '[upload_chunk] invalid target host_id=%d instance_id=%s target=%s subpath=%s filename=%s offset=%d',
            $hostId,
            $instanceId,
            $target,
            $subpath,
            $filename,
            $offset
        ));
        header('Content-Type: application/json', true, 404);
        echo json_encode(['ok' => false, 'error' => 'Upload target not found']);
        exit;
    }

    $access = file_access_status_for_context($context);
    if (!(bool) ($access['ok'] ?? false) || !(bool) (($access['status']['writable'] ?? false))) {
        error_log(sprintf(
            '[upload_chunk] target not writable path=%s host_id=%d instance_id=%s target=%s subpath=%s filename=%s offset=%d access=%s',
            (string) $context['path'],
            $hostId,
            $instanceId,
            $target,
            $subpath,
            $filename,
            $offset,
            json_encode($access)
        ));
        header('Content-Type: application/json', true, 409);
        echo json_encode([
            'ok' => false,
            'error' => 'Upload target is not writable from the agent container',
            'access' => $access,
        ]);
        exit;
    }

    $result = stream_upload_chunk_for_host($host, $filename, (string) $context['path'], $offset, $totalSize, $isLastChunk);
    if (!(bool) ($result['ok'] ?? false)) {
        error_log(sprintf(
            '[upload_chunk] upload failed path=%s host_id=%d instance_id=%s target=%s subpath=%s filename=%s offset=%d result=%s',
            (string) $context['path'],
            $hostId,
            $instanceId,
            $target,
            $subpath,
            $filename,
            $offset,
            json_encode($result)
        ));
    }
    header('Content-Type: application/json', true, ($result['ok'] ?? false) ? 200 : 502);
    echo json_encode($result);
    exit;
}

if ($route === 'upload_large' || $route === 'installer_upload') {
    require_login();

    $hostId = (int) ($_GET['host_id'] ?? 0);
    $instanceId = (string) ($_GET['instance_id'] ?? '');
    $target = trim((string) ($_GET['target'] ?? ($route === 'installer_upload' ? 'installer' : '')));
    $subpath = trim((string) ($_GET['subpath'] ?? ''));
    $server = $instanceId !== '' ? find_instance_with_host($instanceId) : null;
    $host = $server ?: find_host($hostId);
    $context = upload_context_for_request($server ? null : $host, $server, $target);
    $context = $context ? context_with_subpath($context, $subpath) : null;

    if (!$host || !(int) ($host['is_enabled'] ?? 0) || !$context) {
        flash('Select a valid upload target.');
        redirect_route($server ? 'game_servers' : 'file_management');
    }

    $access = file_access_status_for_context($context);

    ?><!doctype html>
    <html lang="en">
    <head>
        <meta charset="utf-8">
        <title><?= h(($server['server_name'] ?? $host['name']) . ' ' . $context['label'] . ' Upload') ?></title>
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
            <h1><?= h($context['label']) ?> Upload</h1>
            <p class="muted">Upload large files directly to <strong><?= h((string) $context['path']) ?></strong> on <?= h((string) ($server['server_name'] ?? $host['name'])) ?>.</p>
            <p class="muted">This path uploads retryable chunks through the panel to the host agent and supports multi-GB uploads for shared `/opt/fs25/*` folders and per-server profile storage.</p>
            <p class="muted">Path access: <?= h((bool) (($access['status']['writable'] ?? false)) ? 'writable' : 'not writable') ?><?php if (!empty($access['status']['error'])): ?> | <?= h((string) $access['status']['error']) ?><?php endif; ?></p>
            <input id="upload-file" type="file" required>
            <div class="actions">
                <button id="start-upload" type="button" <?= (bool) (($access['status']['writable'] ?? false)) ? '' : 'disabled' ?>>Start Upload</button>
                <a class="button-link gray" href="/?route=<?= h($context['back_route']) ?>">Back</a>
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
    const instanceId = <?= json_encode($server['instance_id'] ?? '') ?>;
    const target = <?= json_encode($target) ?>;

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
            const tokenResponse = await fetch(`/?route=upload_token&host_id=${encodeURIComponent(hostId)}&target=${encodeURIComponent(target)}${instanceId ? `&instance_id=${encodeURIComponent(instanceId)}` : ''}<?= $subpath !== '' ? '&subpath=' . rawurlencode($subpath) : '' ?>&filename=${encodeURIComponent(file.name)}`, {
                credentials: 'same-origin',
            });
            const tokenData = await tokenResponse.json();

            if (!tokenData.ok) {
                throw new Error(tokenData.error || 'Failed to get upload token');
            }

            statusText.textContent = `Status: uploading to ${tokenData.target_label}`;
            statusText.className = 'muted';

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

    $defaults = suggested_create_defaults();
    $instanceId = preg_replace('/[^a-zA-Z0-9_-]/', '', (string)($_POST['instance_id'] ?? ''));
    $serverName = trim((string)($_POST['server_name'] ?? ''));
    $imageName = canonical_fs25_image_name((string)($_POST['image_name'] ?? (string) $defaults['image_name']));
    $hostId = (int) ($_POST['host_id'] ?? 0);
    $host = find_host($hostId);

    if (!$host || !(int) $host['is_enabled']) {
        flash('Select a valid managed host.');
        redirect_route('create_server');
    }

    $payload = [
        'instance_id' => $instanceId !== '' ? $instanceId : (string) $defaults['instance_id'],
        'server_name' => $serverName !== '' ? $serverName : (string) $defaults['server_name'],
        'image_name' => $imageName,
        'shared_game_path' => (string) ($host['shared_game_path'] ?? '/opt/fs25/game'),
        'shared_dlc_path' => (string) ($host['shared_dlc_path'] ?? '/opt/fs25/dlc'),
        'shared_installer_path' => (string) ($host['shared_installer_path'] ?? '/opt/fs25/installer'),
        'server_password' => trim((string)($_POST['server_password'] ?? '')) ?: (string) $defaults['server_password'],
        'server_admin' => trim((string)($_POST['server_admin'] ?? '')) ?: (string) $defaults['server_admin'],
        'server_players' => (int)($_POST['server_players'] ?? (int) $defaults['server_players']),
        'server_port' => (int)($_POST['server_port'] ?? (int) $defaults['server_port']),
        'web_port' => (int)($_POST['web_port'] ?? (int) $defaults['web_port']),
        'vnc_port' => (int)($_POST['vnc_port'] ?? (int) $defaults['vnc_port']),
        'novnc_port' => (int)($_POST['novnc_port'] ?? (int) $defaults['novnc_port']),
        'sftp_port' => (int)($_POST['sftp_port'] ?? (int) $defaults['sftp_port']),
        'sftp_username' => trim((string)($_POST['sftp_username'] ?? '')) ?: (string) $defaults['sftp_username'],
        'sftp_password' => trim((string)($_POST['sftp_password'] ?? '')) ?: (string) $defaults['sftp_password'],
        'server_region' => trim((string)($_POST['server_region'] ?? '')) ?: (string) $defaults['server_region'],
        'server_map' => trim((string)($_POST['server_map'] ?? '')) ?: (string) $defaults['server_map'],
        'server_difficulty' => (int)($_POST['server_difficulty'] ?? (int) $defaults['server_difficulty']),
        'server_pause' => (int)($_POST['server_pause'] ?? (int) $defaults['server_pause']),
        'server_save_interval' => (float)($_POST['server_save_interval'] ?? (float) $defaults['server_save_interval']),
        'server_stats_interval' => (int)($_POST['server_stats_interval'] ?? (int) $defaults['server_stats_interval']),
        'server_crossplay' => isset($_POST['server_crossplay']),
        'autostart_server' => (string)($_POST['autostart_server'] ?? (string) $defaults['autostart_server']),
        'puid' => (int)($_POST['puid'] ?? (int) $defaults['puid']),
        'pgid' => (int)($_POST['pgid'] ?? (int) $defaults['pgid']),
        'vnc_password' => trim((string)($_POST['vnc_password'] ?? '')) ?: (string) $defaults['vnc_password'],
        'web_username' => trim((string)($_POST['web_username'] ?? '')) ?: (string) $defaults['web_username'],
        'web_password' => trim((string)($_POST['web_password'] ?? '')) ?: (string) $defaults['web_password'],
    ];

    if (!is_safe_sftp_credential((string) $payload['sftp_username']) || !is_safe_sftp_credential((string) $payload['sftp_password'])) {
        flash('SFTP username and password may only contain letters, numbers, dot, dash, and underscore.');
        redirect_route('create_server');
    }

    $portConflicts = find_port_conflicts($payload);
    if ($portConflicts) {
        flash('Create failed: ' . implode('; ', $portConflicts));
        redirect_route('create_server');
    }

    $agent = agent_post_for_host($host, '/instance/create', $payload);

    if (!($agent['ok'] ?? false)) {
        flash('Create failed: ' . ($agent['error'] ?? 'Unknown error'));
        redirect_route('create_server');
    }

    $stmt = db()->prepare('
        INSERT INTO server_instances
        (host_id, instance_id, server_name, image_name, server_port, web_port, vnc_port, novnc_port, sftp_port, sftp_username, sftp_password, web_username, web_password, server_players, server_region, server_map, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        $payload['web_username'],
        $payload['web_password'],
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
    $wantsJson = strtolower((string) ($_SERVER['HTTP_X_REQUESTED_WITH'] ?? '')) === 'xmlhttprequest'
        || (string) ($_POST['response_format'] ?? '') === 'json';
    $server = find_instance_with_host($instanceId);

    if (!$server || !(int) ($server['is_enabled'] ?? 0)) {
        if ($wantsJson) {
            json_response(['ok' => false, 'error' => 'Managed host for this server is missing or disabled.'], 404);
        }
        flash('Managed host for this server is missing or disabled.');
        redirect_route('game_servers');
    }

    if (in_array($action, ['start', 'restart', 'rebuild', 'pull'], true)) {
        $sync = sync_instance_config_for_server($server);
        if (!($sync['ok'] ?? false)) {
            if ($wantsJson) {
                json_response(['ok' => false, 'error' => 'Config sync failed: ' . ($sync['error'] ?? 'Unknown error')], 500);
            }
            flash('Config sync failed: ' . ($sync['error'] ?? 'Unknown error'));
            redirect_route('game_servers');
        }
    }

    $agent = agent_post_for_host($server, '/instance/action', [
        'instance_id' => $instanceId,
        'action' => $action,
    ]);

    if (($agent['ok'] ?? false) && $action !== 'logs') {
        $stmt = db()->prepare('UPDATE server_instances SET status = ? WHERE instance_id = ?');
        $stmt->execute([$action, $instanceId]);
    }

    if ($wantsJson) {
        json_response([
            'ok' => (bool) ($agent['ok'] ?? false),
            'action' => $action,
            'instance_id' => $instanceId,
            'panel_status' => $action !== 'logs' && ($agent['ok'] ?? false) ? $action : (string) ($server['status'] ?? 'unknown'),
            'message' => ($agent['ok'] ?? false) ? 'Action completed.' : 'Action failed.',
            'result' => $agent['result'] ?? null,
            'error' => $agent['error'] ?? null,
        ], ($agent['ok'] ?? false) ? 200 : 500);
    }

    if ($action === 'logs') {
        $_SESSION['logs'] = $agent['result']['stdout'] ?? ($agent['result']['stderr'] ?? 'No logs returned');
    } else {
        flash(($agent['ok'] ?? false) ? 'Action completed.' : 'Action failed.');
    }

    $redirectTo = (string) ($_POST['redirect_to'] ?? 'game_servers');
    if ($redirectTo === 'server') {
        header('Location: /?route=server&instance_id=' . rawurlencode($instanceId));
        exit;
    }

    redirect_route('game_servers');
}

if ($route === 'server_command' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    require_login();

    $instanceId = (string) ($_POST['instance_id'] ?? '');
    $action = (string) ($_POST['action'] ?? '');
    $server = find_instance_with_host($instanceId);

    if (!$server || !(int) ($server['is_enabled'] ?? 0)) {
        json_response(['ok' => false, 'error' => 'Managed host for this server is missing or disabled.'], 404);
    }

    if (in_array($action, ['start', 'restart', 'rebuild', 'pull'], true)) {
        $sync = sync_instance_config_for_server($server);
        if (!($sync['ok'] ?? false)) {
            json_response(['ok' => false, 'error' => 'Config sync failed: ' . ($sync['error'] ?? 'Unknown error')], 500);
        }
    }

    $agent = agent_post_for_host($server, '/instance/action', [
        'instance_id' => $instanceId,
        'action' => $action,
    ]);

    if (($agent['ok'] ?? false) && $action !== 'logs') {
        $stmt = db()->prepare('UPDATE server_instances SET status = ? WHERE instance_id = ?');
        $stmt->execute([$action, $instanceId]);
    }

    $updatedServer = find_instance_with_host($instanceId) ?: $server;

    json_response([
        'ok' => (bool) ($agent['ok'] ?? false),
        'action' => $action,
        'instance_id' => $instanceId,
        'panel_status' => (string) ($updatedServer['status'] ?? 'unknown'),
        'message' => ($agent['ok'] ?? false) ? 'Action completed.' : 'Action failed.',
        'result' => $agent['result'] ?? null,
        'error' => $agent['error'] ?? null,
    ], ($agent['ok'] ?? false) ? 200 : 500);
}

if ($route === 'server_delete' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    require_login();

    $instanceId = (string) ($_POST['instance_id'] ?? '');
    $server = find_instance_with_host($instanceId);

    if (!$server || !(int) ($server['is_enabled'] ?? 0)) {
        json_response(['ok' => false, 'error' => 'Managed host for this server is missing or disabled.'], 404);
    }

    $agent = agent_post_for_host($server, '/instance/delete', [
        'instance_id' => $instanceId,
    ]);

    if (($agent['ok'] ?? false)) {
        $stmt = db()->prepare('DELETE FROM server_instances WHERE instance_id = ?');
        $stmt->execute([$instanceId]);
    }

    json_response([
        'ok' => (bool) ($agent['ok'] ?? false),
        'instance_id' => $instanceId,
        'message' => ($agent['ok'] ?? false) ? 'Server deleted.' : 'Delete failed.',
        'result' => $agent['result'] ?? null,
        'error' => $agent['error'] ?? null,
        'redirect' => '/?route=game_servers',
    ], ($agent['ok'] ?? false) ? 200 : 500);
}

if ($route === 'server_live') {
    require_login();

    $instanceId = (string) ($_GET['instance_id'] ?? '');
    $server = find_instance_with_host($instanceId);

    if (!$server || !(int) ($server['is_enabled'] ?? 0)) {
        json_response(['ok' => false, 'error' => 'Managed host for this server is missing or disabled.'], 404);
    }

    $metricsResult = instance_metrics_for_server($server);
    $logsAgent = agent_post_for_host($server, '/instance/action', [
        'instance_id' => $instanceId,
        'action' => 'logs',
    ]);
    $metrics = ($metricsResult['metrics'] ?? []);

    json_response([
        'ok' => true,
        'instance_id' => $instanceId,
        'panel_status' => (string) ($server['status'] ?? 'unknown'),
        'metrics_ok' => (bool) ($metricsResult['ok'] ?? false),
        'metrics' => [
            'running' => (bool) ($metrics['running'] ?? false),
            'desired_running' => (bool) ($metrics['desired_running'] ?? false),
            'cpu_percent' => (float) ($metrics['cpu_percent'] ?? 0),
            'memory_percent' => (float) ($metrics['memory_percent'] ?? 0),
            'memory_used_bytes' => (int) ($metrics['memory_used_bytes'] ?? 0),
            'memory_limit_bytes' => (int) ($metrics['memory_limit_bytes'] ?? 0),
            'disk_used_bytes' => (int) ($metrics['disk_used_bytes'] ?? 0),
            'disk_percent' => (float) ($metrics['disk_percent'] ?? 0),
            'runtime_state' => [
                'state' => (string) (($metrics['runtime_state']['state'] ?? 'offline')),
                'label' => (string) (($metrics['runtime_state']['label'] ?? 'Offline')),
                'detail' => (string) (($metrics['runtime_state']['detail'] ?? 'Required containers are not running.')),
            ],
            'containers' => array_map(static function (array $container): array {
                return [
                    'service' => (string) ($container['service'] ?? ''),
                    'name' => (string) ($container['name'] ?? ''),
                    'status' => (string) ($container['status'] ?? 'unknown'),
                    'running' => (bool) ($container['running'] ?? false),
                    'restarting' => (bool) ($container['restarting'] ?? false),
                    'exit_code' => $container['exit_code'] ?? null,
                    'health' => isset($container['health']) ? (string) $container['health'] : null,
                ];
            }, is_array($metrics['containers'] ?? null) ? $metrics['containers'] : []),
        ],
        'status_output' => implode("\n", [
            'Panel status: ' . (string) ($server['status'] ?? 'unknown'),
            'Container runtime: ' . (($metrics['running'] ?? false) ? 'running' : 'stopped'),
            'Metrics query: ' . (($metricsResult['ok'] ?? false) ? 'ok' : 'failed'),
        ]),
        'log_output' => (string) ($logsAgent['result']['stdout'] ?? ($logsAgent['result']['stderr'] ?? 'No runtime logs returned')),
    ]);
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
    $metricsResult = instance_metrics_for_server($server);
    $metrics = ($metricsResult['metrics'] ?? []);

    $logOutput = $agent['result']['stdout'] ?? ($agent['result']['stderr'] ?? 'No logs returned');
    $runtimeStatus = ($metrics['running'] ?? false) ? 'running' : 'stopped';
    $panelStatus = (string) ($server['status'] ?? 'unknown');
    $statusSummary = [
        'Panel status: ' . $panelStatus,
        'Container runtime: ' . $runtimeStatus,
        'Metrics query: ' . (($metricsResult['ok'] ?? false) ? 'ok' : 'failed'),
    ];
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
            .content { padding: 20px; display: grid; gap: 16px; }
            .grid { display: grid; gap: 16px; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); }
            .card { background: #121826; border: 1px solid #243041; border-radius: 12px; padding: 16px; }
            .stack { display: grid; gap: 8px; }
            pre { margin: 0; white-space: pre-wrap; word-break: break-word; background: #050814; border: 1px solid #243041; border-radius: 12px; padding: 16px; overflow: auto; }
            .status-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; }
            .status-tile { background: #0b1020; border: 1px solid #243041; border-radius: 10px; padding: 12px; }
            .status-label { color: #a8b3c7; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; }
            .status-value { margin-top: 6px; font-size: 18px; font-weight: 700; }
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
            <div class="card">
                <div class="status-grid">
                    <div class="status-tile">
                        <div class="status-label">Panel</div>
                        <div class="status-value"><?= h($panelStatus) ?></div>
                    </div>
                    <div class="status-tile">
                        <div class="status-label">Container</div>
                        <div class="status-value"><?= h($runtimeStatus) ?></div>
                    </div>
                    <div class="status-tile">
                        <div class="status-label">CPU</div>
                        <div class="status-value"><?= h(number_format((float) ($metrics['cpu_percent'] ?? 0), 1)) ?>%</div>
                    </div>
                    <div class="status-tile">
                        <div class="status-label">RAM</div>
                        <div class="status-value"><?= h(number_format((float) ($metrics['memory_percent'] ?? 0), 1)) ?>%</div>
                    </div>
                </div>
                <div class="stack muted" style="margin-top:12px;">
                    <?php foreach ($statusSummary as $line): ?>
                        <div><?= h($line) ?></div>
                    <?php endforeach; ?>
                </div>
            </div>
            <div class="grid">
                <div class="card">
                    <div class="muted" style="margin-bottom:10px;">Runtime lifecycle log</div>
                    <pre><?= h($logOutput) ?></pre>
                </div>
            </div>
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

if ($route === 'server_update' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    require_login();

    $instanceId = (string) ($_POST['instance_id'] ?? '');
    $server = find_instance_with_host($instanceId);

    if (!$server || !(int) ($server['is_enabled'] ?? 0)) {
        flash('Managed host for this server is missing or disabled.');
        redirect_route('game_servers');
    }

    $payload = [
        'server_name' => trim((string) ($_POST['server_name'] ?? '')),
        'image_name' => canonical_fs25_image_name((string) ($_POST['image_name'] ?? '')),
        'server_port' => (int) ($_POST['server_port'] ?? 0),
        'web_port' => (int) ($_POST['web_port'] ?? 0),
        'vnc_port' => (int) ($_POST['vnc_port'] ?? 0),
        'novnc_port' => (int) ($_POST['novnc_port'] ?? 0),
        'sftp_port' => (int) ($_POST['sftp_port'] ?? 0),
        'sftp_username' => trim((string) ($_POST['sftp_username'] ?? '')),
        'sftp_password' => trim((string) ($_POST['sftp_password'] ?? '')),
        'web_username' => trim((string) ($_POST['web_username'] ?? '')),
        'web_password' => trim((string) ($_POST['web_password'] ?? '')),
        'server_players' => (int) ($_POST['server_players'] ?? 16),
        'server_region' => trim((string) ($_POST['server_region'] ?? 'en')),
        'server_map' => trim((string) ($_POST['server_map'] ?? 'MapUS')),
    ];

    if ($payload['server_name'] === '' || $payload['image_name'] === '' || $payload['sftp_username'] === '' || $payload['sftp_password'] === '' || $payload['web_username'] === '' || $payload['web_password'] === '') {
        flash('Server name, image, SFTP credentials, and web admin credentials are required.');
        header('Location: /?route=server&instance_id=' . rawurlencode($instanceId));
        exit;
    }

    if (!is_safe_sftp_credential($payload['sftp_username']) || !is_safe_sftp_credential($payload['sftp_password'])) {
        flash('SFTP username and password may only contain letters, numbers, dot, dash, and underscore.');
        header('Location: /?route=server&instance_id=' . rawurlencode($instanceId));
        exit;
    }

    $portConflicts = find_port_conflicts($payload, $instanceId);
    if ($portConflicts) {
        flash('Update failed: ' . implode('; ', $portConflicts));
        header('Location: /?route=server&instance_id=' . rawurlencode($instanceId));
        exit;
    }

    $stmt = db()->prepare('
        UPDATE server_instances
        SET server_name = ?, image_name = ?, server_port = ?, web_port = ?, vnc_port = ?, novnc_port = ?, sftp_port = ?, sftp_username = ?, sftp_password = ?, web_username = ?, web_password = ?, server_players = ?, server_region = ?, server_map = ?
        WHERE instance_id = ?
    ');
    $stmt->execute([
        $payload['server_name'],
        $payload['image_name'],
        $payload['server_port'],
        $payload['web_port'],
        $payload['vnc_port'],
        $payload['novnc_port'],
        $payload['sftp_port'],
        $payload['sftp_username'],
        $payload['sftp_password'],
        $payload['web_username'],
        $payload['web_password'],
        $payload['server_players'],
        $payload['server_region'],
        $payload['server_map'],
        $instanceId,
    ]);

    $updatedServer = find_instance_with_host($instanceId);
    if ($updatedServer && (int) ($updatedServer['is_enabled'] ?? 0)) {
        $sync = sync_instance_config_for_server($updatedServer);
        if (!($sync['ok'] ?? false)) {
            flash('Server details saved, but runtime sync failed: ' . ($sync['error'] ?? 'Unknown error'));
            header('Location: /?route=server&instance_id=' . rawurlencode($instanceId));
            exit;
        }
    }

    flash('Server details updated and runtime config synced.');
    header('Location: /?route=server&instance_id=' . rawurlencode($instanceId));
    exit;
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

if ($route === 'server') {
    require_login();

    $instanceId = (string) ($_GET['instance_id'] ?? '');
    $server = find_instance_with_host($instanceId);

    if (!$server || !(int) ($server['is_enabled'] ?? 0)) {
        flash('Managed host for this server is missing or disabled.');
        redirect_route('game_servers');
    }

    $metricsResult = instance_metrics_for_server($server);
    $metrics = ($metricsResult['metrics'] ?? []);
    $webUrl = instance_access_url($server, 'web');
    $vncUrl = instance_access_url($server, 'vnc');
    $novncUrl = instance_access_url($server, 'novnc');
    $logsAgent = agent_post_for_host($server, '/instance/action', [
        'instance_id' => $instanceId,
        'action' => 'logs',
    ]);
    $secretsResult = instance_secrets_for_server($server);
    $vncPassword = (string) ($secretsResult['secrets']['vnc_password'] ?? '');
    $statusOutput = implode("\n", [
        'Panel status: ' . (string) ($server['status'] ?? 'unknown'),
        'Container runtime: ' . (($metrics['running'] ?? false) ? 'running' : 'stopped'),
        'Metrics query: ' . (($metricsResult['ok'] ?? false) ? 'ok' : 'failed'),
    ]);
    $logOutput = $logsAgent['result']['stdout'] ?? ($logsAgent['result']['stderr'] ?? 'No runtime logs returned');
    $flash = flash();
    ?><!doctype html>
    <html lang="en">
    <head>
        <meta charset="utf-8">
        <title><?= h($server['server_name']) ?> Details</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
            * { box-sizing: border-box; }
            body { margin: 0; font-family: Arial, sans-serif; background: #0b1020; color: #f2f4f8; }
            .page { max-width: 1180px; margin: 0 auto; padding: 24px; }
            .card { background: #171c25; border: 1px solid #2a3240; border-radius: 16px; padding: 20px; margin-bottom: 20px; }
            .grid { display: grid; gap: 16px; }
            .grid.two { grid-template-columns: 1.2fr 0.8fr; }
            .grid.form { grid-template-columns: repeat(3, 1fr); }
            .muted { color: #a8b3c7; }
            .actions { display: flex; gap: 10px; flex-wrap: wrap; }
            .button-link, button { display: inline-block; padding: 10px 14px; border-radius: 8px; border: 0; background: #2563eb; color: #fff; text-decoration: none; cursor: pointer; }
            .button-link.gray, button.gray { background: #475569; }
            button.danger { background: #b91c1c; }
            input { width: 100%; padding: 10px 12px; border-radius: 8px; border: 1px solid #334155; background: #0f172a; color: #fff; }
            label { display: block; margin-bottom: 8px; color: #dbe4f0; }
            .flash { padding: 12px; background: #1d4ed8; border-radius: 10px; margin-bottom: 16px; }
            .meter { display: grid; gap: 6px; }
            .meter-bar { height: 12px; border-radius: 999px; background: #0f172a; overflow: hidden; border: 1px solid #243041; }
            .meter-fill { height: 100%; background: linear-gradient(90deg, #0ea5e9, #22c55e); }
            .status-chip { display:inline-flex; align-items:center; padding:6px 10px; border-radius:999px; font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:0.05em; }
            .status-chip.online { background:#14532d; color:#bbf7d0; }
            .status-chip.booting { background:#78350f; color:#fde68a; }
            .status-chip.degraded { background:#7f1d1d; color:#fecaca; }
            .status-chip.offline { background:#334155; color:#e2e8f0; }
            .container-status-list { display:grid; gap:10px; margin-top:16px; }
            .container-status-item { background:#0f172a; border:1px solid #243041; border-radius:10px; padding:12px; }
            .log-grid { display: grid; gap: 16px; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); align-items: stretch; }
            .log-block { display: grid; gap: 10px; grid-template-rows: auto minmax(0, 1fr); }
            .log-view { margin: 0; white-space: pre-wrap; word-break: break-word; background: #050814; border: 1px solid #243041; border-radius: 12px; padding: 16px; height: 500px; overflow: auto; }
            .inline-status { padding: 12px; background: #1e293b; border: 1px solid #334155; border-radius: 10px; margin-bottom: 16px; display: none; }
            .secret-row { display: flex; gap: 10px; align-items: end; }
            .secret-row input { flex: 1; }
            @media (max-width: 900px) { .grid.two, .grid.form { grid-template-columns: 1fr; } }
        </style>
    </head>
    <body>
    <div class="page">
        <?php if ($flash): ?><div class="flash"><?= h($flash) ?></div><?php endif; ?>
        <div class="inline-status" id="server-inline-status"></div>
        <div class="actions" style="margin-bottom:16px;">
            <a class="button-link gray" href="/?route=game_servers">Back to Game Servers</a>
            <?php if ($novncUrl): ?><a class="button-link" href="/?route=console&amp;instance_id=<?= h($server['instance_id']) ?>">VNC Viewer</a><?php endif; ?>
            <?php if ($webUrl): ?><a class="button-link" href="<?= h($webUrl) ?>" target="_blank" rel="noreferrer">Game Webpage</a><?php endif; ?>
            <?php if ($vncUrl): ?><a class="button-link" href="<?= h($vncUrl) ?>">Direct VNC</a><?php endif; ?>
            <a class="button-link" href="/?route=logs&amp;instance_id=<?= h($server['instance_id']) ?>">Logs</a>
            <?php foreach (['start', 'stop', 'restart', 'pull', 'rebuild'] as $act): ?>
                <form method="post" action="/?route=server_command" style="display:inline;" class="server-action-form">
                    <input type="hidden" name="instance_id" value="<?= h($server['instance_id']) ?>">
                    <input type="hidden" name="action" value="<?= h($act) ?>">
                    <button class="<?= in_array($act, ['pull', 'rebuild'], true) ? 'gray' : '' ?>" type="submit"><?= h($act) ?></button>
                </form>
            <?php endforeach; ?>
            <form method="post" action="/?route=server_delete" style="display:inline;" class="server-delete-form">
                <input type="hidden" name="instance_id" value="<?= h($server['instance_id']) ?>">
                <button class="danger" type="submit">Delete Server</button>
            </form>
        </div>

        <div class="grid two">
            <div class="card">
                <h1 style="margin-top:0;"><?= h($server['server_name']) ?></h1>
                <div class="muted"><?= h($server['instance_id']) ?> on <?= h($server['host_name'] ?? 'managed host') ?></div>
                <?php $serverImageOptions = fs25_image_options((string) ($server['image_name'] ?? '')); ?>
                <form method="post" action="/?route=server_update" class="grid form" style="margin-top:18px;">
                    <input type="hidden" name="instance_id" value="<?= h($server['instance_id']) ?>">
                    <div><label>Server Name</label><input name="server_name" value="<?= h($server['server_name']) ?>"></div>
                    <div>
                        <label>Image</label>
                        <select name="image_name">
                            <?php foreach ($serverImageOptions as $imageValue => $imageLabel): ?>
                                <option value="<?= h((string) $imageValue) ?>" <?= (string) $server['image_name'] === (string) $imageValue ? 'selected' : '' ?>><?= h((string) $imageLabel) ?></option>
                            <?php endforeach; ?>
                        </select>
                    </div>
                    <div><label>Players</label><input name="server_players" type="number" value="<?= h((string) $server['server_players']) ?>"></div>
                    <div><label>Game Port</label><input name="server_port" type="number" value="<?= h((string) $server['server_port']) ?>"></div>
                    <div><label>Admin Web Port</label><input name="web_port" type="number" value="<?= h((string) $server['web_port']) ?>"></div>
                    <div><label>VNC Port</label><input name="vnc_port" type="number" value="<?= h((string) $server['vnc_port']) ?>"></div>
                    <div><label>noVNC Port</label><input name="novnc_port" type="number" value="<?= h((string) $server['novnc_port']) ?>"></div>
                    <div><label>SFTP Port</label><input name="sftp_port" type="number" value="<?= h((string) $server['sftp_port']) ?>"></div>
                    <div><label>SFTP Username</label><input name="sftp_username" value="<?= h($server['sftp_username'] ?? 'fs25') ?>"></div>
                    <div><label>SFTP Password</label><input name="sftp_password" value="<?= h($server['sftp_password'] ?? 'changeme') ?>"></div>
                    <div><label>Web Username</label><input name="web_username" value="<?= h($server['web_username'] ?? 'admin') ?>"></div>
                    <div><label>Web Password</label><input name="web_password" value="<?= h($server['web_password'] ?? 'changeme') ?>"></div>
                    <div><label>Region</label><input name="server_region" value="<?= h($server['server_region'] ?? 'en') ?>"></div>
                    <div><label>Map</label><input name="server_map" value="<?= h($server['server_map'] ?? 'MapUS') ?>"></div>
                    <div style="display:flex;align-items:end;"><button type="submit">Save Panel Details</button></div>
                </form>
            </div>
            <div class="card">
                <h2 style="margin-top:0;">Runtime Health</h2>
                <?php
                    $cpuPercent = (float) ($metrics['cpu_percent'] ?? 0);
                    $memoryPercent = (float) ($metrics['memory_percent'] ?? 0);
                    $diskPercent = (float) ($metrics['disk_percent'] ?? 0);
                ?>
                <div class="meter">
                    <div id="cpu-label">CPU: <?= h(number_format($cpuPercent, 1)) ?>%</div>
                    <div class="meter-bar"><div class="meter-fill" id="cpu-fill" style="width: <?= h((string) min(max($cpuPercent, 0), 100)) ?>%"></div></div>
                </div>
                <div class="meter" style="margin-top:16px;">
                    <div id="memory-label">RAM: <?= h(format_bytes_human((int) ($metrics['memory_used_bytes'] ?? 0))) ?> / <?= h(format_bytes_human((int) ($metrics['memory_limit_bytes'] ?? 0))) ?> (<?= h(number_format($memoryPercent, 1)) ?>%)</div>
                    <div class="meter-bar"><div class="meter-fill" id="memory-fill" style="width: <?= h((string) min(max($memoryPercent, 0), 100)) ?>%"></div></div>
                </div>
                <div class="meter" style="margin-top:16px;">
                    <div id="disk-label">Disk: <?= h(format_bytes_human((int) ($metrics['disk_used_bytes'] ?? 0))) ?> (<?= h(number_format($diskPercent, 1)) ?>%)</div>
                    <div class="meter-bar"><div class="meter-fill" id="disk-fill" style="width: <?= h((string) min(max($diskPercent, 0), 100)) ?>%"></div></div>
                </div>
                <?php $runtimeState = $metrics['runtime_state'] ?? ['state' => (($metrics['running'] ?? false) ? 'online' : 'offline'), 'label' => (($metrics['running'] ?? false) ? 'Online' : 'Offline'), 'detail' => '']; ?>
                <div style="margin-top:16px;">
                    <span class="status-chip <?= h((string) ($runtimeState['state'] ?? 'offline')) ?>" id="runtime-state-chip"><?= h((string) ($runtimeState['label'] ?? 'Offline')) ?></span>
                </div>
                <div class="muted" style="margin-top:10px;" id="runtime-status-detail"><?= h((string) ($runtimeState['detail'] ?? '')) ?></div>
                <div class="muted" style="margin-top:8px;" id="runtime-status">Desired: <?= h((bool) ($metrics['desired_running'] ?? false) ? 'start' : 'stop') ?></div>
                <div class="container-status-list" id="container-status-list">
                    <?php foreach (($metrics['containers'] ?? []) as $container): ?>
                        <div class="container-status-item">
                            <div><strong><?= h((string) ($container['service'] ?? 'container')) ?></strong> <span class="muted">(<?= h((string) ($container['name'] ?? '')) ?>)</span></div>
                            <div class="muted">Status: <?= h((string) ($container['status'] ?? 'unknown')) ?><?php if (isset($container['exit_code']) && $container['exit_code'] !== null): ?> | Exit: <?= h((string) $container['exit_code']) ?><?php endif; ?><?php if (!empty($container['health'])): ?> | Health: <?= h((string) $container['health']) ?><?php endif; ?></div>
                        </div>
                    <?php endforeach; ?>
                </div>
                <div style="margin-top:16px;">
                    <label>VNC Password</label>
                    <div class="secret-row">
                        <input id="vnc-password-field" value="<?= h($vncPassword) ?>" readonly>
                        <button class="gray" type="button" id="copy-vnc-password">Copy</button>
                    </div>
                </div>
                <div class="muted" style="margin-top:8px;">Panel detail edits update stored panel metadata. If ports or image settings must also change in the runtime container config, recreate or sync the instance afterward.</div>
            </div>
        </div>
        <div class="card">
            <div class="actions" style="justify-content:space-between; align-items:center; margin-bottom:12px;">
                <div>
                    <h2 style="margin:0;">Runtime Status and Lifecycle Log</h2>
                    <div class="muted">Panel status summary plus the structured runtime lifecycle log for this server.</div>
                </div>
                <a class="button-link primary" href="/?route=server&amp;instance_id=<?= h($server['instance_id']) ?>">Refresh Server View</a>
            </div>
            <div class="log-grid">
                <div class="log-block">
                    <div class="muted">Runtime summary</div>
                    <pre class="log-view" id="server-status-view"><?= h($statusOutput) ?></pre>
                </div>
                <div class="log-block">
                    <div class="muted">Lifecycle log</div>
                    <pre class="log-view" id="server-log-view"><?= h($logOutput) ?></pre>
                </div>
            </div>
        </div>
    </div>
    <script>
        const instanceId = <?= json_encode((string) $server['instance_id']) ?>;
        const serverLogView = document.getElementById('server-log-view');
        const serverStatusView = document.getElementById('server-status-view');
        const inlineStatus = document.getElementById('server-inline-status');
        const cpuLabel = document.getElementById('cpu-label');
        const cpuFill = document.getElementById('cpu-fill');
        const memoryLabel = document.getElementById('memory-label');
        const memoryFill = document.getElementById('memory-fill');
        const diskLabel = document.getElementById('disk-label');
        const diskFill = document.getElementById('disk-fill');
        const runtimeStatus = document.getElementById('runtime-status');
        const runtimeStateChip = document.getElementById('runtime-state-chip');
        const runtimeStatusDetail = document.getElementById('runtime-status-detail');
        const containerStatusList = document.getElementById('container-status-list');
        const vncPasswordField = document.getElementById('vnc-password-field');
        const copyVncPassword = document.getElementById('copy-vnc-password');
        const actionForms = document.querySelectorAll('.server-action-form');
        const deleteForm = document.querySelector('.server-delete-form');

        function scrollToBottom(element) {
            if (element) {
                element.scrollTop = element.scrollHeight;
            }
        }

        function isNearBottom(element, threshold = 24) {
            if (!element) {
                return true;
            }
            return (element.scrollHeight - element.scrollTop - element.clientHeight) <= threshold;
        }

        function updateScrollableText(element, nextText) {
            if (!element) {
                return;
            }
            const previousScrollTop = element.scrollTop;
            const shouldStickToBottom = isNearBottom(element);
            element.textContent = nextText;
            if (shouldStickToBottom) {
                scrollToBottom(element);
            } else {
                element.scrollTop = previousScrollTop;
            }
        }

        function appendLogText(element, nextText) {
            if (!element) {
                return;
            }
            const currentText = element.textContent || '';
            const incomingText = nextText || '';
            const shouldStickToBottom = isNearBottom(element);
            const previousScrollTop = element.scrollTop;

            if (incomingText.startsWith(currentText)) {
                const appendedText = incomingText.slice(currentText.length);
                if (appendedText !== '') {
                    element.textContent = currentText + appendedText;
                }
            } else {
                element.textContent = incomingText;
            }

            if (shouldStickToBottom) {
                scrollToBottom(element);
            } else {
                element.scrollTop = previousScrollTop;
            }
        }

        function formatBytes(bytes) {
            const value = Number(bytes) || 0;
            const units = ['B', 'KB', 'MB', 'GB', 'TB'];
            let size = value;
            let unitIndex = 0;
            while (size >= 1024 && unitIndex < units.length - 1) {
                size /= 1024;
                unitIndex += 1;
            }
            return `${size.toFixed(size >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
        }

        function setInlineStatus(message, isError = false) {
            if (!inlineStatus) {
                return;
            }
            inlineStatus.style.display = 'block';
            inlineStatus.textContent = message;
            inlineStatus.style.background = isError ? '#7f1d1d' : '#1e293b';
            inlineStatus.style.borderColor = isError ? '#b91c1c' : '#334155';
        }

        function fallbackCopyText(value) {
            if (!vncPasswordField) {
                return false;
            }
            vncPasswordField.removeAttribute('readonly');
            vncPasswordField.focus();
            vncPasswordField.select();
            vncPasswordField.setSelectionRange(0, value.length);
            let copied = false;
            try {
                copied = document.execCommand('copy');
            } catch (error) {
                copied = false;
            }
            vncPasswordField.setAttribute('readonly', 'readonly');
            window.getSelection()?.removeAllRanges?.();
            return copied;
        }

        function renderContainerStatuses(containers) {
            if (!containerStatusList) {
                return;
            }
            const items = Array.isArray(containers) ? containers : [];
            containerStatusList.innerHTML = items.map((container) => {
                const exitText = container.exit_code === null || container.exit_code === undefined ? '' : ` | Exit: ${container.exit_code}`;
                const healthText = container.health ? ` | Health: ${container.health}` : '';
                return `<div class="container-status-item"><div><strong>${container.service || 'container'}</strong> <span class="muted">(${container.name || ''})</span></div><div class="muted">Status: ${container.status || 'unknown'}${exitText}${healthText}</div></div>`;
            }).join('');
        }

        function updateLiveView(payload) {
            if (!payload || !payload.metrics) {
                return;
            }
            const cpuPercent = Number(payload.metrics.cpu_percent || 0);
            const memoryPercent = Number(payload.metrics.memory_percent || 0);
            const diskPercent = Number(payload.metrics.disk_percent || 0);
            const memoryUsed = Number(payload.metrics.memory_used_bytes || 0);
            const memoryLimit = Number(payload.metrics.memory_limit_bytes || 0);
            const diskUsed = Number(payload.metrics.disk_used_bytes || 0);

            if (cpuLabel) cpuLabel.textContent = `CPU: ${cpuPercent.toFixed(1)}%`;
            if (cpuFill) cpuFill.style.width = `${Math.max(0, Math.min(cpuPercent, 100))}%`;
            if (memoryLabel) memoryLabel.textContent = `RAM: ${formatBytes(memoryUsed)} / ${formatBytes(memoryLimit)} (${memoryPercent.toFixed(1)}%)`;
            if (memoryFill) memoryFill.style.width = `${Math.max(0, Math.min(memoryPercent, 100))}%`;
            if (diskLabel) diskLabel.textContent = `Disk: ${formatBytes(diskUsed)} (${diskPercent.toFixed(1)}%)`;
            if (diskFill) diskFill.style.width = `${Math.max(0, Math.min(diskPercent, 100))}%`;
            if (runtimeStateChip) {
                const runtimeState = payload.metrics.runtime_state || { state: 'offline', label: 'Offline' };
                runtimeStateChip.textContent = runtimeState.label || 'Offline';
                runtimeStateChip.className = `status-chip ${runtimeState.state || 'offline'}`;
            }
            if (runtimeStatusDetail) {
                runtimeStatusDetail.textContent = (payload.metrics.runtime_state && payload.metrics.runtime_state.detail) || '';
            }
            if (runtimeStatus) runtimeStatus.textContent = `Desired: ${payload.metrics.desired_running ? 'start' : 'stop'}`;
            renderContainerStatuses(payload.metrics.containers || []);
            updateScrollableText(serverStatusView, payload.status_output || 'No runtime summary returned');
            if (serverLogView) {
                appendLogText(serverLogView, payload.log_output || 'No runtime logs returned');
            }
        }

        async function refreshLiveView() {
            try {
                const response = await fetch(`/?route=server_live&instance_id=${encodeURIComponent(instanceId)}`, {
                    headers: { 'X-Requested-With': 'XMLHttpRequest' },
                    credentials: 'same-origin',
                });
                if (!response.ok) {
                    throw new Error(`Live status failed (${response.status})`);
                }
                const payload = await response.json();
                updateLiveView(payload);
            } catch (error) {
                setInlineStatus(error.message, true);
            }
        }

        actionForms.forEach((form) => {
            form.addEventListener('submit', async (event) => {
                event.preventDefault();
                const button = form.querySelector('button[type="submit"]');
                if (button) button.disabled = true;
                setInlineStatus(`Running ${form.querySelector('input[name="action"]').value}...`);
                try {
                    const submitUrl = form.getAttribute('action') || '/?route=server_command';
                    const response = await fetch(submitUrl, {
                        method: 'POST',
                        body: new FormData(form),
                        headers: { 'X-Requested-With': 'XMLHttpRequest' },
                        credentials: 'same-origin',
                    });
                    const payload = await response.json();
                    if (!response.ok || !payload.ok) {
                        throw new Error(payload.error || payload.message || `Action failed (${response.status})`);
                    }
                    setInlineStatus(payload.message || 'Action completed.');
                    await refreshLiveView();
                } catch (error) {
                    setInlineStatus(error.message, true);
                } finally {
                    if (button) button.disabled = false;
                }
            });
        });

        if (deleteForm) {
            deleteForm.addEventListener('submit', async (event) => {
                event.preventDefault();
                if (!window.confirm(`Delete server ${instanceId}? This removes the panel record and the instance files on the managed host.`)) {
                    return;
                }

                const button = deleteForm.querySelector('button[type="submit"]');
                if (button) button.disabled = true;
                setInlineStatus('Deleting server...');

                try {
                    const response = await fetch(deleteForm.getAttribute('action') || '/?route=server_delete', {
                        method: 'POST',
                        body: new FormData(deleteForm),
                        headers: { 'X-Requested-With': 'XMLHttpRequest' },
                        credentials: 'same-origin',
                    });
                    const payload = await response.json();
                    if (!response.ok || !payload.ok) {
                        throw new Error(payload.error || payload.message || `Delete failed (${response.status})`);
                    }
                    window.location.href = payload.redirect || '/?route=game_servers';
                } catch (error) {
                    setInlineStatus(error.message, true);
                    if (button) button.disabled = false;
                }
            });
        }

        scrollToBottom(serverLogView);
        refreshLiveView();
        window.setInterval(refreshLiveView, 5000);

        if (copyVncPassword && vncPasswordField) {
            copyVncPassword.addEventListener('click', async () => {
                try {
                    if (navigator.clipboard && window.isSecureContext) {
                        await navigator.clipboard.writeText(vncPasswordField.value);
                        setInlineStatus('VNC password copied.');
                        return;
                    }
                    if (fallbackCopyText(vncPasswordField.value)) {
                        setInlineStatus('VNC password copied.');
                        return;
                    }
                    throw new Error('Copy is not available in this browser context.');
                } catch (error) {
                    setInlineStatus('Unable to copy VNC password.', true);
                }
            });
        }
    </script>
    </body>
    </html>
    <?php
    exit;
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
    $vncUrl = instance_access_url($server, 'vnc');

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
                    <?php if ($vncUrl): ?>
                        <a class="button-link" href="<?= h($vncUrl) ?>">Direct VNC</a>
                    <?php endif; ?>
                    <a class="button-link primary" href="<?= h($novncUrl) ?>" target="_blank" rel="noreferrer">Open noVNC Direct</a>
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
        <title>FSG FS25 Node</title>
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
        .server-grid { display: grid; gap: 18px; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); }
        .server-card { display: grid; gap: 14px; }
        .server-card-head { display: flex; justify-content: space-between; gap: 12px; align-items: start; }
        .server-card-title { margin: 0; font-size: 22px; }
        .server-card-link { color: inherit; text-decoration: none; display: block; }
        .health-grid { display: grid; gap: 12px; }
        .health-meter { display: grid; gap: 6px; }
        .health-label { display: flex; justify-content: space-between; gap: 10px; font-size: 13px; color: #dbe4f0; }
        .health-bar { height: 10px; border-radius: 999px; background: #0f172a; overflow: hidden; border: 1px solid #243041; }
        .health-fill { height: 100%; background: linear-gradient(90deg, #0ea5e9, #22c55e); }
        .health-fill.warn { background: linear-gradient(90deg, #f59e0b, #ef4444); }
        .stat-chip { display: inline-flex; align-items: center; gap: 6px; padding: 8px 10px; border-radius: 999px; background: #0f172a; border: 1px solid #243041; font-size: 13px; color: #c7d2e3; }
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
                <h1>FSG FS25 Node</h1>
                <p class="muted">Sign in to manage this node's hosts, installer files, and FS25 server instances from one local control plane.</p>
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
                    mh.name AS host_name,
                    mh.agent_url,
                    mh.access_host,
                    mh.agent_token,
                    mh.is_enabled
                FROM server_instances si
                LEFT JOIN managed_hosts mh ON mh.id = si.host_id
                ORDER BY si.created_at DESC
            ')->fetchAll();
            foreach ($servers as &$serverRow) {
                $metricsResult = instance_metrics_for_server($serverRow);
                $serverRow['metrics'] = $metricsResult['metrics'] ?? [
                    'cpu_percent' => 0,
                    'memory_used_bytes' => 0,
                    'memory_limit_bytes' => 0,
                    'memory_percent' => 0,
                    'disk_used_bytes' => 0,
                    'disk_percent' => 0,
                    'running' => false,
                ];
                $serverRow['metrics_ok'] = (bool) ($metricsResult['ok'] ?? false);
            }
            unset($serverRow);
            $hosts = all_hosts();
            $createHosts = enabled_hosts();
            $localHost = local_host_record();
            $node = local_node_config();
            $nodeSummary = node_summary();
            $createDefaults = suggested_create_defaults();
            $createImageOptions = fs25_image_options((string) $createDefaults['image_name']);
            $fileScope = (string) ($_GET['fm_scope'] ?? 'host');
            $fileTarget = (string) ($_GET['fm_target'] ?? 'installer');
            $fileHostId = (int) ($_GET['fm_host_id'] ?? ($localHost['id'] ?? 0));
            $fileInstanceId = (string) ($_GET['fm_instance_id'] ?? '');
            $fileSubpath = trim((string) ($_GET['fm_subpath'] ?? ''));
            $fileServer = ($fileScope === 'instance' && $fileInstanceId !== '') ? find_instance_with_host($fileInstanceId) : null;
            $fileHost = $fileServer ?: ($fileHostId > 0 ? find_host($fileHostId) : $localHost);
            $fileContext = file_context_for_request($fileServer ? null : $fileHost, $fileServer, $fileTarget);
            $fileAccess = $fileContext ? file_access_status_for_context($fileContext) : ['ok' => false];
            $fileListing = $fileContext ? directory_listing_for_context($fileContext, $fileSubpath) : ['ok' => false, 'files' => []];
        ?>
        <header class="topbar">
            <div class="topbar-inner">
                <div class="brand">
                    <div class="brand-title">FSG FS25 Node</div>
                    <div class="brand-copy">Logged in as <?= h(current_user()['username']) ?>. Run this node locally now, and connect it to a main site later if needed.</div>
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
                <p>This install acts as its own FS25 node. Use this page to maintain the default local host record, confirm connectivity, and prepare the shared FS paths used by this node.</p>
            </section>
            <div class="card">
                <div class="page-grid two">
                    <div>
                        <h2 style="margin-top:0;">Local Node</h2>
                        <div class="stack muted">
                            <div>Name: <?= h($node['name']) ?></div>
                            <div>Slug: <?= h($node['slug']) ?></div>
                            <div>Panel URL: <a href="<?= h($node['app_url']) ?>" target="_blank" rel="noreferrer"><?= h($node['app_url']) ?></a></div>
                            <div>Local host: <?= h((string) ($nodeSummary['local_host']['name'] ?? 'not configured')) ?></div>
                            <div>Node API: <?= h(node_api_enabled() ? 'enabled' : 'disabled') ?></div>
                        </div>
                    </div>
                    <div>
                        <h2 style="margin-top:0;">Future Main-Site API</h2>
                        <div class="stack muted">
                            <div>Status: <code>GET <?= h($node['api_status_url']) ?></code></div>
                            <div>Servers: <code>GET <?= h($node['api_servers_url']) ?></code></div>
                            <div>Hosts: <code>GET <?= h($node['api_hosts_url']) ?></code></div>
                            <div>Auth: <code>Authorization: Bearer &lt;NODE_API_TOKEN&gt;</code></div>
                        </div>
                    </div>
                </div>
            </div>
            <div class="card">
                <div class="page-grid two">
                    <div>
                        <h2 style="margin-top:0;">Admin SFTP</h2>
                        <div class="stack muted">
                            <div>Host: <?= h((string) $node['admin_sftp_host']) ?></div>
                            <div>Port: <?= h((string) $node['admin_sftp_port']) ?></div>
                            <div>Username: <?= h((string) $node['admin_sftp_username']) ?></div>
                            <div>Password: <?= h((string) $node['admin_sftp_password']) ?></div>
                        </div>
                    </div>
                    <div>
                        <h2 style="margin-top:0;">SFTP Paths</h2>
                        <div class="stack muted">
                            <div>SFTP root: <code><?= h((string) $node['admin_sftp_root']) ?></code></div>
                            <div>Full `/opt` access: <code><?= h((string) $node['admin_sftp_opt_path']) ?></code></div>
                            <div>Instances: <code>panel/instances</code></div>
                            <div>Backups: <code>panel/backups</code></div>
                            <div>Shared FS: <code>panel/shared</code></div>
                        </div>
                    </div>
                </div>
            </div>
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
            <h2>Default Host Settings</h2>
            <div class="notice" style="margin-bottom:16px;">This node manages its default local host here. Update the agent endpoint, token, and shared FS paths as needed instead of creating additional host entries from this screen.</div>
            <?php if ($localHost): ?>
                <form method="post" action="/?route=host_update" class="grid">
                    <input type="hidden" name="host_id" value="<?= h((string) $localHost['id']) ?>">
                    <div><label>Host Name</label><input name="name" value="<?= h((string) $localHost['name']) ?>" required></div>
                    <div><label>Agent API URL</label><input name="agent_url" value="<?= h((string) $localHost['agent_url']) ?>" required></div>
                    <div><label>Access Host/IP</label><input name="access_host" value="<?= h((string) ($localHost['access_host'] ?? '')) ?>" placeholder="15.204.86.248"></div>
                    <div><label>Agent Token</label><input name="agent_token" type="password" value="<?= h((string) $localHost['agent_token']) ?>" required></div>
                    <div><label>Shared Game Path</label><input name="shared_game_path" value="<?= h((string) ($localHost['shared_game_path'] ?? '/opt/fs25/game')) ?>" required></div>
                    <div><label>Shared DLC Path</label><input name="shared_dlc_path" value="<?= h((string) ($localHost['shared_dlc_path'] ?? '/opt/fs25/dlc')) ?>" required></div>
                    <div><label>Shared Installer Path</label><input name="shared_installer_path" value="<?= h((string) ($localHost['shared_installer_path'] ?? '/opt/fs25/installer')) ?>" required></div>
                    <div><button type="submit">Update Default Host</button></div>
                </form>
            <?php else: ?>
                <div class="notice">No default host record exists yet. Re-run the installer to bootstrap the local host entry.</div>
            <?php endif; ?>
        </div>
        <div class="card">
            <h2>How To Use This Page</h2>
            <div class="stack muted">
                <div>1. Review the default local host details and update them if the agent URL, token, or storage paths change.</div>
                <div>2. Set Access Host/IP to the reachable address players and admins should use for game web, VNC, and noVNC links.</div>
                <div>3. Verify the host shows as online.</div>
                <div>4. Prepare storage once so shared folders exist.</div>
                <div>5. Use File Management to upload installer archives or DLC.</div>
                <div>6. Create servers after the shared files are ready.</div>
            </div>
        </div>
        </div>
        <div class="card">
            <h2>Current Host Status</h2>
            <table>
                        <thead>
                            <tr>
                                <th>Name</th>
                                <th>API URL</th>
                                <th>Access Host/IP</th>
                                <th>Shared FS</th>
                                <th>Status</th>
                                <th>Setup</th>
                            </tr>
                        </thead>
                        <tbody>
                        <?php if ($localHost): ?>
                            <?php $health = agent_health_for_host($localHost); ?>
                            <tr>
                                <td><?= h($localHost['name']) ?></td>
                                <td><?= h($localHost['agent_url']) ?></td>
                                <td><?= h((string) ($localHost['access_host'] ?? '')) ?></td>
                                <td>
                                    <div class="stack muted">
                                        <div>game: <?= h($localHost['shared_game_path'] ?? '/opt/fs25/game') ?></div>
                                        <div>dlc: <?= h($localHost['shared_dlc_path'] ?? '/opt/fs25/dlc') ?></div>
                                        <div>installer: <?= h($localHost['shared_installer_path'] ?? '/opt/fs25/installer') ?></div>
                                    </div>
                                </td>
                                <td><?= h(($health['ok'] ?? false) ? 'online' : 'offline') ?></td>
                                <td>
                                    <form method="post" action="/?route=host_prepare" style="margin-bottom:10px;">
                                        <input type="hidden" name="host_id" value="<?= h((string) $localHost['id']) ?>">
                                        <button class="gray" type="submit">prepare storage</button>
                                    </form>
                                    <a class="button-link" href="/?route=file_management">open file management</a>
                                </td>
                            </tr>
                        <?php else: ?>
                            <tr><td colspan="6" class="muted">No default host is available.</td></tr>
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
                    <div>1. Use the shared folder buttons to upload directly into the node's `/opt/fs25/game`, `/opt/fs25/dlc`, or `/opt/fs25/installer` paths.</div>
                    <div>2. Verify uploaded installer files appear in the installer listing.</div>
                    <div>3. Use the unzip button on any zip archive found in that folder.</div>
                    <div>4. Use the Game Servers page for per-server profile, mods, saves, and logs uploads.</div>
                </div>
            </div>
            <div class="card">
                <h2>What This Page Does</h2>
                <div class="notice">This page is focused on host-wide file operations under `/opt/fs25/*`. It gives you large-file upload entry points for shared game, DLC, and installer storage.</div>
            </div>
        </div>
        <div class="card">
            <h2>Admin SFTP Access</h2>
            <div class="page-grid two">
                <div class="stack muted">
                    <div>Host: <?= h((string) $node['admin_sftp_host']) ?></div>
                    <div>Port: <?= h((string) $node['admin_sftp_port']) ?></div>
                    <div>Username: <?= h((string) $node['admin_sftp_username']) ?></div>
                    <div>Password: <?= h((string) $node['admin_sftp_password']) ?></div>
                </div>
                <div class="stack muted">
                    <div>Use this login for full admin-level access to the node's `/opt` content through SFTP.</div>
                    <div>Inside SFTP, browse: <code>panel/opt</code></div>
                    <div>Shared FS shortcuts: <code>panel/shared</code></div>
                    <div>Instances: <code>panel/instances</code></div>
                </div>
            </div>
        </div>
        <div class="card">
            <h2>File Explorer</h2>
            <div class="stack muted" style="margin-bottom:14px;">
                <div>Browse the shared `/opt/fs25/*` folders and the per-server profile-side folders that this panel can reach through the agent.</div>
                <div>Current target: <?= h((string) ($fileContext['label'] ?? 'not selected')) ?><?php if ($fileContext): ?> | root: <?= h((string) $fileContext['path']) ?><?php endif; ?></div>
                <?php if ($fileContext): ?>
                    <div>Access: <?= h((bool) (($fileAccess['status']['readable'] ?? false)) ? 'readable' : 'not readable') ?> / <?= h((bool) (($fileAccess['status']['writable'] ?? false)) ? 'writable' : 'not writable') ?><?php if (!empty($fileAccess['status']['error'])): ?> | <?= h((string) $fileAccess['status']['error']) ?><?php endif; ?></div>
                <?php endif; ?>
            </div>
            <div class="flex" style="margin-bottom:14px;">
                <?php foreach ($hosts as $host): ?>
                    <?php $hostPrefix = count($hosts) > 1 ? $host['name'] . ' ' : ''; ?>
                    <a class="button-link" href="/?route=file_management&amp;fm_scope=host&amp;fm_host_id=<?= h((string) $host['id']) ?>&amp;fm_target=game">browse <?= h($hostPrefix) ?>game</a>
                    <a class="button-link" href="/?route=file_management&amp;fm_scope=host&amp;fm_host_id=<?= h((string) $host['id']) ?>&amp;fm_target=dlc">browse <?= h($hostPrefix) ?>dlc</a>
                    <a class="button-link" href="/?route=file_management&amp;fm_scope=host&amp;fm_host_id=<?= h((string) $host['id']) ?>&amp;fm_target=installer">browse <?= h($hostPrefix) ?>installer</a>
                <?php endforeach; ?>
            </div>
            <div class="flex" style="margin-bottom:14px;">
                <?php foreach ($servers as $server): ?>
                    <a class="button-link gray" href="/?route=file_management&amp;fm_scope=instance&amp;fm_instance_id=<?= h($server['instance_id']) ?>&amp;fm_target=profile">browse <?= h($server['server_name']) ?> profile</a>
                    <a class="button-link gray" href="/?route=file_management&amp;fm_scope=instance&amp;fm_instance_id=<?= h($server['instance_id']) ?>&amp;fm_target=mods">mods</a>
                    <a class="button-link gray" href="/?route=file_management&amp;fm_scope=instance&amp;fm_instance_id=<?= h($server['instance_id']) ?>&amp;fm_target=saves">saves</a>
                    <a class="button-link gray" href="/?route=file_management&amp;fm_scope=instance&amp;fm_instance_id=<?= h($server['instance_id']) ?>&amp;fm_target=logs">logs</a>
                <?php endforeach; ?>
            </div>
            <?php if ($fileContext && ($fileListing['ok'] ?? false)): ?>
                <?php
                    $breadcrumbParts = array_values(array_filter(explode('/', (string) ($fileListing['subpath'] ?? ''))));
                    $breadcrumbTrail = [];
                    $breadcrumbAccum = '';
                ?>
                <div class="flex" style="margin-bottom:12px;">
                    <?php if (($fileListing['subpath'] ?? '') !== ''): ?>
                        <?php
                            $parentSubpath = dirname((string) $fileListing['subpath']);
                            $parentSubpath = $parentSubpath === '.' ? '' : str_replace('\\', '/', $parentSubpath);
                        ?>
                        <a class="button-link gray" href="/?route=file_management&amp;fm_scope=<?= h($fileScope) ?><?= $fileServer ? '&amp;fm_instance_id=' . h($fileInstanceId) : '&amp;fm_host_id=' . h((string) $fileHostId) ?>&amp;fm_target=<?= h($fileTarget) ?>&amp;fm_subpath=<?= h($parentSubpath) ?>">up one level</a>
                    <?php endif; ?>
                    <a class="button-link" href="/?route=upload_large<?= $fileServer ? '&amp;instance_id=' . h($fileInstanceId) : '&amp;host_id=' . h((string) ($fileHost['id'] ?? 0)) ?>&amp;target=<?= h($fileTarget) ?><?= ($fileListing['subpath'] ?? '') !== '' ? '&amp;subpath=' . h((string) $fileListing['subpath']) : '' ?>" target="_blank" rel="noreferrer">upload here</a>
                </div>
                <div class="flex" style="margin-bottom:12px;">
                    <span class="stat-chip">root</span>
                    <?php foreach ($breadcrumbParts as $part): ?>
                        <?php
                            $breadcrumbAccum = $breadcrumbAccum === '' ? $part : $breadcrumbAccum . '/' . $part;
                            $breadcrumbTrail[] = $breadcrumbAccum;
                        ?>
                        <a class="stat-chip" href="/?route=file_management&amp;fm_scope=<?= h($fileScope) ?><?= $fileServer ? '&amp;fm_instance_id=' . h($fileInstanceId) : '&amp;fm_host_id=' . h((string) $fileHostId) ?>&amp;fm_target=<?= h($fileTarget) ?>&amp;fm_subpath=<?= h($breadcrumbAccum) ?>"><?= h($part) ?></a>
                    <?php endforeach; ?>
                </div>
                <div class="dir-list">
                    <?php foreach (($fileListing['files'] ?? []) as $entry): ?>
                        <?php if (!($entry['is_dir'] ?? false) && !($entry['is_file'] ?? false)) { continue; } ?>
                        <div class="dir-item">
                            <div class="muted"><?= h($entry['name']) ?></div>
                            <div class="muted small"><?= h(($entry['is_dir'] ?? false) ? 'directory' : 'file') ?><?php if (($entry['is_file'] ?? false)): ?> | <?= h((string) $entry['size']) ?> bytes<?php endif; ?></div>
                            <?php if (($entry['is_dir'] ?? false)): ?>
                                <a class="button-link gray" href="/?route=file_management&amp;fm_scope=<?= h($fileScope) ?><?= $fileServer ? '&amp;fm_instance_id=' . h($fileInstanceId) : '&amp;fm_host_id=' . h((string) $fileHostId) ?>&amp;fm_target=<?= h($fileTarget) ?>&amp;fm_subpath=<?= h((string) $entry['relative_path']) ?>">open folder</a>
                            <?php elseif ($fileTarget === 'installer' && str_ends_with(strtolower((string) $entry['name']), '.zip')): ?>
                                <form method="post" action="/?route=installer_unzip">
                                    <input type="hidden" name="host_id" value="<?= h((string) ($fileHost['id'] ?? 0)) ?>">
                                    <input type="hidden" name="filename" value="<?= h((string) (($fileListing['subpath'] ?? '') !== '' ? ($fileListing['subpath'] . '/' . $entry['name']) : $entry['name'])) ?>">
                                    <button class="gray" type="submit">unzip zip</button>
                                </form>
                            <?php endif; ?>
                        </div>
                    <?php endforeach; ?>
                    <?php if (!(($fileListing['files'] ?? []))): ?>
                        <div class="muted small">This folder is currently empty.</div>
                    <?php endif; ?>
                </div>
            <?php else: ?>
                <div class="notice">Select a folder above to browse it.</div>
            <?php endif; ?>
        </div>
        <?php if (!$hosts): ?>
            <div class="card">
                <div class="notice">No default host is configured yet. Update or recreate the local host record on the Managed Hosts page before using file operations.</div>
            </div>
        <?php endif; ?>
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
                            <option value="<?= h((string) $host['id']) ?>"><?= h($host['name']) ?> (API <?= h($host['agent_url']) ?><?= ($host['access_host'] ?? '') !== '' ? ' | access ' . h((string) $host['access_host']) : '' ?>)</option>
                        <?php endforeach; ?>
                    </select>
                </div>
                <div><label>Instance ID</label><input name="instance_id" value="<?= h((string) $createDefaults['instance_id']) ?>" required></div>
                <div><label>Server Name</label><input name="server_name" value="<?= h((string) $createDefaults['server_name']) ?>" required></div>
                <div>
                    <label>Image</label>
                    <select name="image_name" required>
                        <?php foreach ($createImageOptions as $imageValue => $imageLabel): ?>
                            <option value="<?= h((string) $imageValue) ?>" <?= (string) $createDefaults['image_name'] === (string) $imageValue ? 'selected' : '' ?>><?= h((string) $imageLabel) ?></option>
                        <?php endforeach; ?>
                    </select>
                </div>
                <div><label>Players</label><input name="server_players" type="number" value="<?= h((string) $createDefaults['server_players']) ?>"></div>

                <div><label>Game Port</label><input name="server_port" type="number" value="<?= h((string) $createDefaults['server_port']) ?>"></div>
                <div><label>Admin Web Port</label><input name="web_port" type="number" value="<?= h((string) $createDefaults['web_port']) ?>"></div>
                <div><label>VNC Port</label><input name="vnc_port" type="number" value="<?= h((string) $createDefaults['vnc_port']) ?>"></div>
                <div><label>noVNC Port</label><input name="novnc_port" type="number" value="<?= h((string) $createDefaults['novnc_port']) ?>"></div>

                <div><label>Join Password</label><input name="server_password" value="<?= h((string) $createDefaults['server_password']) ?>"></div>
                <div><label>Admin Password</label><input name="server_admin" value="<?= h((string) $createDefaults['server_admin']) ?>"></div>
                <div><label>Web Username</label><input name="web_username" value="<?= h((string) $createDefaults['web_username']) ?>"></div>
                <div><label>Web Password</label><input name="web_password" value="<?= h((string) $createDefaults['web_password']) ?>"></div>

                <div><label>SFTP Port</label><input name="sftp_port" type="number" value="<?= h((string) $createDefaults['sftp_port']) ?>"></div>
                <div><label>SFTP Username</label><input name="sftp_username" value="<?= h((string) $createDefaults['sftp_username']) ?>"></div>
                <div><label>SFTP Password</label><input name="sftp_password" value="<?= h((string) $createDefaults['sftp_password']) ?>"></div>
                <div><label>VNC Password</label><input name="vnc_password" value="<?= h((string) $createDefaults['vnc_password']) ?>"></div>
                <div><label>Region</label><input name="server_region" value="<?= h((string) $createDefaults['server_region']) ?>"></div>
                <div><label>Map</label><input name="server_map" value="<?= h((string) $createDefaults['server_map']) ?>"></div>
                <div><label>Difficulty</label><input name="server_difficulty" type="number" value="<?= h((string) $createDefaults['server_difficulty']) ?>"></div>

                <div><label>Pause Mode</label><input name="server_pause" type="number" value="<?= h((string) $createDefaults['server_pause']) ?>"></div>
                <div><label>Save Interval</label><input name="server_save_interval" type="number" step="0.1" value="<?= h((string) $createDefaults['server_save_interval']) ?>"></div>
                <div><label>Stats Interval</label><input name="server_stats_interval" type="number" value="<?= h((string) $createDefaults['server_stats_interval']) ?>"></div>
                <div><label>PUID</label><input name="puid" type="number" value="<?= h((string) $createDefaults['puid']) ?>"></div>

                <div><label>PGID</label><input name="pgid" type="number" value="<?= h((string) $createDefaults['pgid']) ?>"></div>
                <div style="display:flex;align-items:end;"><label><input type="checkbox" name="server_crossplay" checked style="width:auto;"> Crossplay</label></div>
                <div>
                    <label>Startup Mode</label>
                    <select name="autostart_server">
                        <option value="true" <?= $createDefaults['autostart_server'] === 'true' ? 'selected' : '' ?>>Auto start server</option>
                        <option value="web_only">Web panel only</option>
                        <option value="false" <?= $createDefaults['autostart_server'] === 'false' ? 'selected' : '' ?>>Manual start</option>
                    </select>
                </div>
                <div style="display:flex;align-items:end;"><button type="submit">Create Server</button></div>
            </form>
        </div>
        <div class="card">
            <h2>How To Use This Page</h2>
            <div class="stack muted">
                <div>1. Pick a managed host that already has shared files ready.</div>
                <div>2. Default ports are auto-incremented from the highest existing ports to avoid collisions.</div>
                <div>3. Game join and admin passwords are generated as 10-character random letters and numbers.</div>
                <div>4. Web, SFTP, and VNC passwords are generated with stronger defaults that you can change later.</div>
                <div>5. Create the server, then switch to Game Servers to start it and open the viewer pages.</div>
            </div>
        </div>
        </div>
        <?php endif; ?>

        <?php if ($pageRoute === 'game_servers'): ?>
        <div class="page-grid two">
            <div class="card">
                <h2>How To Use This Page</h2>
                <div class="stack muted">
                    <div>1. Each server is shown as a health card with live CPU, RAM, and disk usage bars.</div>
                    <div>2. Click a server card to open its detail page and edit panel-managed settings.</div>
                    <div>3. Use VNC, web, and logs shortcuts directly from the card for quick access.</div>
                    <div>4. Use the detail page for lifecycle actions and deeper per-server management.</div>
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
            <div class="server-grid">
                <?php foreach ($servers as $server): ?>
                    <?php
                        $webUrl = instance_access_url($server, 'web');
                        $novncUrl = instance_access_url($server, 'novnc');
                        $detailUrl = '/?route=server&instance_id=' . rawurlencode((string) $server['instance_id']);
                        $metrics = $server['metrics'] ?? [];
                        $cpuPercent = (float) ($metrics['cpu_percent'] ?? 0);
                        $memoryPercent = (float) ($metrics['memory_percent'] ?? 0);
                        $diskPercent = (float) ($metrics['disk_percent'] ?? 0);
                        $cardRuntime = $metrics['runtime_state'] ?? ['state' => (($metrics['running'] ?? false) ? 'online' : 'offline'), 'label' => (($metrics['running'] ?? false) ? 'Online' : 'Offline')];
                    ?>
                    <div class="card server-card" data-live-instance-id="<?= h((string) $server['instance_id']) ?>">
                        <a class="server-card-link" href="<?= h($detailUrl) ?>">
                            <div class="server-card-head">
                                <div>
                                    <h3 class="server-card-title"><?= h($server['server_name']) ?></h3>
                                    <div class="muted"><?= h($server['instance_id']) ?> on <?= h($server['host_name'] ?? 'unassigned') ?></div>
                                </div>
                                <div class="stat-chip" data-live-running><?= h((string) ($cardRuntime['label'] ?? 'Offline')) ?></div>
                            </div>
                        </a>
                        <div class="flex">
                            <div class="stat-chip">Game <?= h((string) $server['server_port']) ?></div>
                            <div class="stat-chip">Web <?= h((string) $server['web_port']) ?></div>
                            <div class="stat-chip">SFTP <?= h((string) $server['sftp_port']) ?></div>
                        </div>
                        <div class="health-grid">
                            <div class="health-meter">
                                <div class="health-label"><span>CPU</span><span data-live-cpu-label><?= h(number_format($cpuPercent, 1)) ?>%</span></div>
                                <div class="health-bar"><div class="health-fill <?= $cpuPercent >= 85 ? 'warn' : '' ?>" data-live-cpu-fill style="width: <?= h((string) min(max($cpuPercent, 0), 100)) ?>%"></div></div>
                            </div>
                            <div class="health-meter">
                                <div class="health-label"><span>RAM</span><span data-live-memory-label><?= h(number_format($memoryPercent, 1)) ?>% | <?= h(format_bytes_human((int) ($metrics['memory_used_bytes'] ?? 0))) ?></span></div>
                                <div class="health-bar"><div class="health-fill <?= $memoryPercent >= 85 ? 'warn' : '' ?>" data-live-memory-fill style="width: <?= h((string) min(max($memoryPercent, 0), 100)) ?>%"></div></div>
                            </div>
                            <div class="health-meter">
                                <div class="health-label"><span>Disk</span><span data-live-disk-label><?= h(number_format($diskPercent, 1)) ?>% | <?= h(format_bytes_human((int) ($metrics['disk_used_bytes'] ?? 0))) ?></span></div>
                                <div class="health-bar"><div class="health-fill <?= $diskPercent >= 85 ? 'warn' : '' ?>" data-live-disk-fill style="width: <?= h((string) min(max($diskPercent, 0), 100)) ?>%"></div></div>
                            </div>
                        </div>
                        <div class="actions">
                            <a class="button-link gray" href="<?= h($detailUrl) ?>">view details</a>
                            <?php if ($novncUrl): ?><a class="button-link" href="/?route=console&amp;instance_id=<?= h($server['instance_id']) ?>">vnc</a><?php endif; ?>
                            <?php if ($webUrl): ?><a class="button-link" href="<?= h($webUrl) ?>" target="_blank" rel="noreferrer">web</a><?php endif; ?>
                            <a class="button-link" href="/?route=logs&amp;instance_id=<?= h($server['instance_id']) ?>">logs</a>
                        </div>
                    </div>
                <?php endforeach; ?>
                <?php if (!$servers): ?>
                    <div class="notice">No servers created yet.</div>
                <?php endif; ?>
            </div>
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
                <div>FSG FS25 Node</div>
                <div>Use Managed Hosts to maintain the default local host, File Management to handle installers, Create Server for provisioning, and Game Servers for day-to-day operations.</div>
            </div>
        </footer>
        <?php if ($pageRoute === 'game_servers'): ?>
        <script>
            const liveServerCards = Array.from(document.querySelectorAll('[data-live-instance-id]'));

            function liveFormatBytes(bytes) {
                const value = Number(bytes) || 0;
                const units = ['B', 'KB', 'MB', 'GB', 'TB'];
                let size = value;
                let unitIndex = 0;
                while (size >= 1024 && unitIndex < units.length - 1) {
                    size /= 1024;
                    unitIndex += 1;
                }
                return `${size.toFixed(size >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
            }

            function applyWarnClass(element, percent) {
                if (!element) {
                    return;
                }
                element.classList.toggle('warn', percent >= 85);
            }

            function updateLiveServerCard(card, payload) {
                if (!card || !payload || !payload.metrics) {
                    return;
                }
                const cpuPercent = Number(payload.metrics.cpu_percent || 0);
                const memoryPercent = Number(payload.metrics.memory_percent || 0);
                const diskPercent = Number(payload.metrics.disk_percent || 0);
                const memoryUsed = Number(payload.metrics.memory_used_bytes || 0);
                const diskUsed = Number(payload.metrics.disk_used_bytes || 0);
                const runtimeState = payload.metrics.runtime_state || { label: (payload.metrics.running ? 'Online' : 'Offline') };

                const runningEl = card.querySelector('[data-live-running]');
                const cpuLabel = card.querySelector('[data-live-cpu-label]');
                const cpuFill = card.querySelector('[data-live-cpu-fill]');
                const memoryLabel = card.querySelector('[data-live-memory-label]');
                const memoryFill = card.querySelector('[data-live-memory-fill]');
                const diskLabel = card.querySelector('[data-live-disk-label]');
                const diskFill = card.querySelector('[data-live-disk-fill]');

                if (runningEl) {
                    runningEl.textContent = runtimeState.label || 'Offline';
                }
                if (cpuLabel) {
                    cpuLabel.textContent = `${cpuPercent.toFixed(1)}%`;
                }
                if (cpuFill) {
                    cpuFill.style.width = `${Math.max(0, Math.min(cpuPercent, 100))}%`;
                    applyWarnClass(cpuFill, cpuPercent);
                }
                if (memoryLabel) {
                    memoryLabel.textContent = `${memoryPercent.toFixed(1)}% | ${liveFormatBytes(memoryUsed)}`;
                }
                if (memoryFill) {
                    memoryFill.style.width = `${Math.max(0, Math.min(memoryPercent, 100))}%`;
                    applyWarnClass(memoryFill, memoryPercent);
                }
                if (diskLabel) {
                    diskLabel.textContent = `${diskPercent.toFixed(1)}% | ${liveFormatBytes(diskUsed)}`;
                }
                if (diskFill) {
                    diskFill.style.width = `${Math.max(0, Math.min(diskPercent, 100))}%`;
                    applyWarnClass(diskFill, diskPercent);
                }
            }

            async function refreshGameServerCards() {
                await Promise.all(liveServerCards.map(async (card) => {
                    const instanceId = card.getAttribute('data-live-instance-id');
                    if (!instanceId) {
                        return;
                    }
                    try {
                        const response = await fetch(`/?route=server_live&instance_id=${encodeURIComponent(instanceId)}`, {
                            headers: { 'X-Requested-With': 'XMLHttpRequest' },
                            credentials: 'same-origin',
                        });
                        if (!response.ok) {
                            return;
                        }
                        const payload = await response.json();
                        updateLiveServerCard(card, payload);
                    } catch (error) {
                    }
                }));
            }

            refreshGameServerCards();
            window.setInterval(refreshGameServerCards, 5000);
        </script>
        <?php endif; ?>
    <?php endif; ?>
</div>
</body>
</html>
