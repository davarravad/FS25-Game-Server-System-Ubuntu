<?php
declare(strict_types=1);

function management_require(bool $condition, string $message, int $status = 422): void
{
    if (!$condition) json_response(['ok' => false, 'error' => $message], $status);
}

function management_fields(): array
{
    return array_merge(management_editable_fields(), management_game_fields());
}

// Settings an existing server keeps editing from this site. They configure the container,
// the site label and management access, never the game itself.
function management_editable_fields(): array
{
    return ['server_name','image_name','server_port','web_port','tls_port','vnc_port','novnc_port','sftp_port','sftp_username','sftp_password','web_username','web_password'];
}

// Settings that only seed the game's first start. The game admin panel owns them afterwards,
// so saving an existing server never accepts, stores or syncs new values for them.
function management_game_fields(): array
{
    return ['server_players','server_region','server_map'];
}

function management_save(array $host, ?array $server): void
{
    $creating = $server === null;
    $defaults = $server ?? suggested_create_defaults();
    $fields = $creating ? management_fields() : management_editable_fields();
    $payload = [];
    foreach ($fields as $key) {
        $value = $_POST[$key] ?? $defaults[$key] ?? '';
        if (!$creating && str_ends_with($key, 'password') && $value === '') $value = $defaults[$key];
        $payload[$key] = str_ends_with($key, '_port') || $key === 'server_players' ? (int) $value : trim((string) $value);
    }
    $instance = $creating ? (string) ($_POST['instance_id'] ?? $defaults['instance_id']) : (string) $server['instance_id'];
    management_require((bool) preg_match('/^[a-zA-Z0-9_-]{1,64}$/D', $instance), 'Invalid instance ID');
    foreach (['server_name','image_name','sftp_username','sftp_password','web_username','web_password','server_region','server_map'] as $key) {
        if (!array_key_exists($key, $payload)) continue;
        management_require($payload[$key] !== '' && strlen($payload[$key]) <= 150 && !preg_match('/[\x00-\x1f]/', $payload[$key]), 'Invalid ' . $key);
    }
    management_require(is_safe_sftp_credential($payload['sftp_username']) && is_safe_sftp_credential($payload['sftp_password']), 'SFTP credentials may only contain letters, numbers, dot, dash and underscore');
    if ($creating) management_require($payload['server_players'] >= 1 && $payload['server_players'] <= 16, 'Players must be between 1 and 16');
    foreach ($payload as $key => $value) if (str_ends_with($key, '_port')) management_require($value >= 1 && $value <= 65535, 'Ports must be between 1 and 65535');
    $payload['image_name'] = canonical_fs25_image_name($payload['image_name']);
    // Serialize configuration changes on a host so two requests cannot allocate the same ports.
    $lock = db()->query("SELECT GET_LOCK('central-server-management', 5)")->fetchColumn();
    management_require((int) $lock === 1, 'Another server change is running; retry shortly', 409);
    try {
        management_require(!$creating || !find_instance_with_host($instance), 'Instance ID already exists', 409);
        $conflicts = find_port_conflicts($payload, $creating ? null : $instance, (int) $host['id']);
        management_require(!$conflicts, implode('; ', $conflicts), 409);
        if ($creating) {
            $extra = ['server_password','server_admin','server_difficulty','server_pause','server_save_interval','server_stats_interval','puid','pgid','vnc_password','autostart_server'];
            foreach ($extra as $key) {
                $value = $_POST[$key] ?? $defaults[$key];
                management_require(is_scalar($value) && strlen((string) $value) <= 150 && !preg_match('/[\x00-\x1f]/', (string) $value), 'Invalid ' . $key);
                $payload[$key] = $value;
            }
            foreach (['server_difficulty','server_pause','server_stats_interval','puid','pgid'] as $key) {
                management_require(filter_var($payload[$key], FILTER_VALIDATE_INT) !== false && (int) $payload[$key] >= 0, 'Invalid ' . $key);
                $payload[$key] = (int) $payload[$key];
            }
            management_require(is_numeric($payload['server_save_interval']) && (float) $payload['server_save_interval'] > 0, 'Save interval must be positive');
            $payload['server_save_interval'] = (float) $payload['server_save_interval'];
            management_require(in_array($payload['autostart_server'], ['true','false','web_only'], true), 'Invalid startup mode');
            $payload['server_crossplay'] = ($_POST['server_crossplay'] ?? 'false') === 'true';
            $payload['instance_id'] = $instance;
            foreach (['shared_game_path','shared_dlc_path','shared_installer_path'] as $key) $payload[$key] = $host[$key];
            $result = agent_post_for_host($host, '/instance/create', $payload, 120);
            management_require((bool) ($result['ok'] ?? false), 'Create failed: ' . ($result['error'] ?? 'Agent did not complete'), 502);
            $columns = array_merge(['host_id','instance_id'], $fields, ['status']);
            $values = array_merge([$host['id'],$instance], array_map(fn($key) => $payload[$key], $fields), ['created']);
            db()->prepare('INSERT INTO server_instances (' . implode(',', $columns) . ') VALUES (' . implode(',', array_fill(0, count($columns), '?')) . ')')->execute($values);
        } else {
            // Sync the proposed configuration before persisting it. A failed sync leaves saved settings intact.
            // Game-owned settings (players, region, map) are not part of $payload, so the game admin panel's values survive.
            $result = sync_instance_config_for_server(array_merge($server, $payload));
            management_require((bool) ($result['ok'] ?? false), 'Runtime sync failed; saved settings were kept: ' . ($result['error'] ?? 'Agent did not complete'), 502);
            db()->prepare('UPDATE server_instances SET ' . implode(',', array_map(fn($key) => "$key=?", $fields)) . ' WHERE instance_id=?')->execute(array_merge(array_map(fn($key) => $payload[$key], $fields), [$instance]));
        }
    } finally { db()->query("SELECT RELEASE_LOCK('central-server-management')"); }
    json_response(['ok' => true, 'instance_id' => $instance, 'message' => $creating ? 'Server created.' : 'Settings saved and runtime configuration synced. Restart the server to apply them to a running game.']);
}

// Returns an existing JSON/stream route only after enforcing the central operation policy.
function central_management(): string
{
    $user = central_gateway_user();
    management_require($user !== null, 'Unauthorized', 401);
    $operation = (string) ($_GET['operation'] ?? '');
    $reads = ['inventory','server','live','files','export'];
    $writes = ['create','save','host-save','prepare','unzip','command','reinstall','delete','upload'];
    management_require(in_array($operation, array_merge($reads, $writes), true), 'Unknown management operation', 404);
    management_require($_SERVER['REQUEST_METHOD'] === (in_array($operation, $reads, true) ? 'GET' : 'POST'), 'Method not allowed', 405);
    management_require($user['role'] === 'admin' || in_array($operation, ['inventory','live','command'], true), 'Administrator access required', 403);
    $host = local_host_record();
    management_require($host && (int) $host['is_enabled'] === 1, 'Local host is unavailable', 503);
    $instance = $operation === 'create' ? '' : (string) ($_GET['instance_id'] ?? $_POST['instance_id'] ?? '');
    $server = $instance !== '' ? find_instance_with_host($instance) : null;
    if ($instance !== '') management_require($server && (int) $server['host_id'] === (int) $host['id'], 'Server does not belong to this node', 404);
    if (in_array($operation, ['server','live','save','command','reinstall','delete'], true)) management_require($server !== null, 'Select a server');
    $_GET['host_id'] = (string) $host['id']; $_POST['host_id'] = (string) $host['id'];
    if ($operation === 'inventory') {
        $safeHost = $host; unset($safeHost['agent_token']);
        $stmt = db()->prepare('SELECT instance_id,server_name,status FROM server_instances WHERE host_id=? ORDER BY instance_id');$stmt->execute([$host['id']]);
        $result = ['ok'=>true,'management_version'=>1,'host'=>$safeHost,'servers'=>$stmt->fetchAll(),'health'=>agent_health_for_host($host)];
        if ($user['role'] === 'admin') {
            $result['defaults'] = suggested_create_defaults(); $result['defaults']['server_crossplay'] = true;
            $result['images'] = fs25_image_options(); $result['sftp'] = local_node_config();
        }
        json_response($result);
    }
    if ($operation === 'server') json_response(['ok'=>true,'server'=>array_intersect_key($server, array_flip(array_merge(['instance_id'], management_editable_fields()))),'secrets'=>instance_secrets_for_server($server),'access'=>['host'=>(string) (resolved_access_endpoint($server)['host'] ?? ''),'sftp_url'=>instance_access_url($server, 'sftp')]]);
    if ($operation === 'create' || $operation === 'save') management_save($host, $operation === 'save' ? $server : null);
    if ($operation === 'host-save') {
        $fields = ['name','agent_url','access_host','shared_game_path','shared_dlc_path','shared_installer_path'];
        $values = [];
        foreach ($fields as $key) {
            $value = trim((string) ($_POST[$key] ?? $host[$key]));
            management_require($value !== '' && strlen($value) <= 255 && !preg_match('/[\x00-\x1f]/', $value), 'Invalid ' . $key);
            if (str_starts_with($key, 'shared_')) management_require(str_starts_with($value, '/') && !str_contains($value, '..'), 'Use an absolute storage path');
            $values[] = $value;
        }
        management_require((bool) preg_match('#^https?://[^\s]+$#D', $values[1]), 'Invalid agent URL');
        $token = trim((string) ($_POST['agent_token'] ?? '')) ?: $host['agent_token'];
        management_require(strlen($token) <= 255 && !preg_match('/[\x00-\x1f]/', $token), 'Invalid agent token');
        db()->prepare('UPDATE managed_hosts SET ' . implode(',', array_map(fn($key) => "$key=?", $fields)) . ',agent_token=? WHERE id=?')->execute(array_merge($values, [$token,$host['id']]));
        json_response(['ok'=>true,'message'=>'Host settings saved.']);
    }
    if ($operation === 'prepare' || $operation === 'unzip') {
        $filename = (string) ($_POST['filename'] ?? '');
        if ($operation === 'unzip') management_require($filename !== '' && basename($filename) === $filename && !str_contains($filename, '\\'), 'Invalid archive filename');
        $result = $operation === 'prepare' ? host_storage_prepare($host) : unzip_installer_archive_for_host($host, $filename);
        json_response($result, ($result['ok'] ?? false) ? 200 : 502);
    }
    if ($operation === 'files') {
        $context = file_context_for_request($server ? null : $host, $server, (string) ($_GET['target'] ?? ''));
        $subpath = (string) ($_GET['subpath'] ?? '');
        management_require($context !== null && normalize_relative_subpath($subpath) !== null, 'Invalid file location');
        $listing = directory_listing_for_context($context, $subpath);
        json_response($listing, ($listing['ok'] ?? false) ? 200 : 502);
    }
    if ($operation === 'upload') {
        management_require((int) ($_SERVER['CONTENT_LENGTH'] ?? 0) <= 4*1024*1024, 'Upload chunk exceeds 4 MiB', 413);
    }
    if ($operation === 'command') management_require(in_array($_POST['action'] ?? '', server_command_actions(), true), 'Unsupported action');
    return ['live'=>'server_live','command'=>'server_command','reinstall'=>'server_reinstall','delete'=>'server_delete','upload'=>'upload_chunk','export'=>'export_servers_excel'][$operation];
}
