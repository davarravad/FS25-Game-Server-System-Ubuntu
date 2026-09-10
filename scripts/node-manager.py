#!/usr/bin/env python3
"""Site bootstrap and root-owned systemd update runner. Python standard library only."""
import argparse
import base64
import fcntl
import getpass
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
import tarfile
import tempfile
import time
import urllib.request

SITE = 'https://farmservers.sargentweb.com'
CONFIG = Path('/etc/farmservers/updater.json')
STATE = Path('/var/lib/farmservers-updater')
BACKUPS = Path('/var/backups/farmservers')
RUNNER = Path('/usr/local/lib/farmservers/node-manager.py')
ROOTS = {'app', 'docker', 'templates', 'sql', 'scripts', '.env.example', 'docker-compose.yml', 'LICENSE'}
VERSION = re.compile(r'v\d{1,6}\.\d{1,6}\.\d{1,6}\Z')


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise ValueError('Redirect refused')


def call(args, **kwargs):
    return subprocess.run(args, check=True, timeout=1800, **kwargs)


def save(path, data):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temp = path.with_suffix('.tmp')
    with temp.open('w', encoding='utf-8') as output:
        output.write(json.dumps(data))
        output.flush()
        os.fsync(output.fileno())
    temp.chmod(0o600)
    temp.replace(path)
    if os.name == 'posix':
        descriptor = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)


def request(config, path, body=None, limit=65536):
    headers = {'Authorization': 'Bearer ' + config['token'], 'X-Node-ID': config['node']}
    data = None if body is None else json.dumps(body).encode()
    if data is not None:
        headers['Content-Type'] = 'application/json'
    req = urllib.request.Request(SITE + '/api/distribution/' + path, data=data, headers=headers)
    with urllib.request.build_opener(NoRedirect()).open(req, timeout=120) as response:
        content = response.read(limit + 1)
    if len(content) > limit:
        raise ValueError('Download exceeds size limit')
    return content


def archive_files(raw):
    """Validate everything before writing anything; never extract links/devices."""
    result = {}
    total = 0
    with tarfile.open(fileobj=io.BytesIO(raw), mode='r:gz') as archive:
        for count, member in enumerate(archive):
            if count >= 10000:
                raise ValueError('Too many archive entries')
            path = PurePosixPath(member.name)
            if path.is_absolute() or '..' in path.parts or not path.parts or path.parts[0] not in ROOTS or '\\' in member.name:
                raise ValueError('Unsafe archive path')
            if member.isdir():
                continue
            if not member.isfile() or member.name != path.as_posix() or member.name in result:
                raise ValueError('Unsupported or duplicate archive entry')
            total += member.size
            if total > 128*1024*1024 or len(result) >= 10000:
                raise ValueError('Expanded release too large')
            result[member.name] = (archive.extractfile(member).read(), member.mode & 0o755)
    for required in ['docker-compose.yml', '.env.example', 'scripts/node-manager.py']:
        if required not in result:
            raise ValueError('Incomplete release')
    for name in result:
        if any(str(parent) in result for parent in PurePosixPath(name).parents):
            raise ValueError('File/directory conflict')
    return result


def download(config, version):
    if not VERSION.fullmatch(version):
        raise ValueError('Invalid release version')
    package = json.loads(request(config, 'releases/' + version))
    manifest = package['manifest'].encode()
    with tempfile.TemporaryDirectory() as folder:
        folder = Path(folder)
        (folder/'key.der').write_bytes(base64.b64decode(config['key'], validate=True))
        (folder/'manifest').write_bytes(manifest)
        (folder/'signature').write_bytes(base64.b64decode(package['signature'], validate=True))
        call(['openssl', 'pkeyutl', '-verify', '-pubin', '-keyform', 'DER', '-inkey', str(folder/'key.der'), '-rawin', '-in', str(folder/'manifest'), '-sigfile', str(folder/'signature')], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    meta = json.loads(manifest)
    if meta['version'] != version or not isinstance(meta['size'], int) or not 0 < meta['size'] <= 24*1024*1024:
        raise ValueError('Invalid manifest')
    raw = request(config, 'releases/' + version + '/archive', limit=meta['size'])
    if len(raw) != meta['size'] or hashlib.sha256(raw).hexdigest() != meta['sha256']:
        raise ValueError('Release checksum mismatch')
    return archive_files(raw)


def safe_target(root, name):
    target = root/name
    for part in [target, *target.parents]:
        if part == root.parent:
            break
        if part.is_symlink():
            raise ValueError('Symlink in installation path')
    if not target.resolve().is_relative_to(root.resolve()):
        raise ValueError('Path outside installation')
    return target


def write_files(root, files):
    for name, (content, mode) in files.items():
        target = safe_target(root, name)
        missing = []
        directory = target.parent
        while not directory.exists():
            missing.append(directory)
            directory = directory.parent
        for directory in reversed(missing):
            directory.mkdir()
            directory.chmod(0o755)  # Bind-mounted application directories must be traversable.
        target.write_bytes(content)
        target.chmod(mode)


def compose(config, *args, **kwargs):
    return call(['docker', 'compose', '-p', config['project'], '--profile', 'central', *args], cwd=config['root'], **kwargs)


def healthy(config):
    for _ in range(60):
        try:
            with urllib.request.urlopen('http://127.0.0.1:' + config['port'] + '/?route=login', timeout=5) as response:
                if response.status == 200:
                    rows = compose(config, 'ps', '--format', 'json', 'web', 'agent', 'nginx', 'publisher', capture_output=True, text=True).stdout
                    services = [json.loads(line) for line in rows.splitlines() if line]
                    if len(services) == 4 and all(s['State'] == 'running' for s in services):
                        return
        except Exception:
            pass
        time.sleep(2)
    raise RuntimeError('Control services did not become healthy')


def apply(config, version, files, job_id):
    root = Path(config['root'])
    backup = BACKUPS/job_id
    backup.mkdir(parents=True, mode=0o700)
    shutil.copy2(root/'.env', backup/'node.env')
    with (backup/'panel.sql').open('wb') as output:
        compose(config, 'exec', '-T', 'db', 'sh', '-c', 'exec mariadb-dump -uroot -p"$MYSQL_ROOT_PASSWORD" --single-transaction "$MYSQL_DATABASE"', stdout=output)
    if not (backup/'panel.sql').stat().st_size:
        raise RuntimeError('Empty database backup')
    old = {}
    for name in files:
        path = safe_target(root, name)
        old[name] = (path.read_bytes(), path.stat().st_mode & 0o777) if path.exists() else None
    for name, content in old.items():
        if content is not None:
            write_files(backup/'source', {name: content})
    save(backup/'files.json', {name: value is not None for name, value in old.items()})
    images = []
    for service in ['web', 'agent', 'nginx', 'publisher']:
        container = compose(config, 'ps', '-q', service, capture_output=True, text=True).stdout.strip()
        if not container:
            raise RuntimeError('All central control services must be running before update')
        info = json.loads(call(['docker', 'inspect', container], capture_output=True, text=True).stdout)[0]
        images.append([info['Image'], info['Config']['Image']])
        call(['docker', 'tag', info['Image'], 'farmservers-backup/' + service + ':' + job_id])
    save(backup/'images.json', images)
    try:
        write_files(root, files)
        compose(config, 'config', '--quiet')
        compose(config, 'build', 'web', 'agent', 'publisher')
        compose(config, 'up', '-d', '--no-build', '--no-deps', '--force-recreate', 'web', 'agent', 'nginx', 'publisher')
        compose(config, 'exec', '-T', 'nginx', 'nginx', '-t')
        healthy(config)
    except Exception:
        for name, content in old.items():
            if content is None:
                safe_target(root, name).unlink(missing_ok=True)
            else:
                write_files(root, {name: content})
        for image, tag in images:
            call(['docker', 'tag', image, tag])
        compose(config, 'up', '-d', '--no-build', '--no-deps', '--force-recreate', 'web', 'agent', 'nginx', 'publisher')
        raise
    save(STATE/'installed.json', {'version': version})
    replacement = RUNNER.with_suffix('.new')
    shutil.copy2(root/'scripts/node-manager.py', replacement)
    replacement.chmod(0o700)
    replacement.replace(RUNNER)


def poll(config):
    job = json.loads(request(config, 'poll', {}))['job']
    if not job:
        return
    if not re.fullmatch(r'[a-f0-9-]{36}', job['id']):
        raise ValueError('Invalid job ID')
    journal = STATE/(job['id'] + '.json')
    if journal.exists():
        result = json.loads(journal.read_text())
        # A host shutdown during apply is never blindly retried.
        if result['status'] == 'applying':
            result = {'id': job['id'], 'status': 'failed'}
    else:
        result = {'id': job['id'], 'status': 'applying'}
        save(journal, result)
        try:
            files = download(config, job['version'])
            apply(config, job['version'], files, job['id'])
            result['status'] = 'succeeded'
        except Exception as error:
            print('Update failed; inspect local backup and logs. Error type:', type(error).__name__, flush=True)
            result['status'] = 'failed'
    save(journal, result)
    request(config, 'result', result)


def install_service(config):
    save(CONFIG, config)
    RUNNER.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    shutil.copy2(Path(config['root'])/'scripts/node-manager.py', RUNNER)
    RUNNER.chmod(0o700)
    Path('/etc/systemd/system/farmservers-update.service').write_text('''[Unit]
Description=Farmservers signed node update poller
After=network-online.target docker.service
Wants=network-online.target
[Service]
Type=oneshot
ExecStart=/usr/bin/python3 /usr/local/lib/farmservers/node-manager.py --poll
UMask=0077
TimeoutStartSec=7200
''')
    Path('/etc/systemd/system/farmservers-update.timer').write_text('''[Unit]
Description=Check for administrator-requested node updates
[Timer]
OnBootSec=60
OnUnitInactiveSec=30
RandomizedDelaySec=10
[Install]
WantedBy=timers.target
''')
    call(['systemctl', 'daemon-reload'])
    call(['systemctl', 'enable', '--now', 'farmservers-update.timer'])


def setup(adopt):
    if CONFIG.exists():
        raise RuntimeError('Already configured; edit /etc/farmservers/updater.json to rotate credentials')
    node = input('Node ID from Access & nodes: ').strip()
    token = getpass.getpass('Node token (hidden): ').strip()
    if not re.fullmatch(r'[a-z0-9][a-z0-9-]{0,62}', node) or not re.fullmatch(r'[a-f0-9]{64}', token):
        raise ValueError('Invalid node credentials')
    config = {'node': node, 'token': token, 'port': '8080'}
    key = json.loads(request(config, 'key'))['key']
    config['key'] = key
    print('Release key SHA256:', hashlib.sha256(base64.b64decode(key, validate=True)).hexdigest())
    print('Compare this fingerprint with your release maintainer before continuing.')
    if input('Type TRUST to pin this signing key: ') != 'TRUST':
        raise ValueError('Key not trusted')
    releases = json.loads(request(config, 'releases'))
    if adopt:
        root = Path(adopt).resolve()
        if not (root/'.env').is_file():
            raise ValueError('Existing node .env missing')
        info = json.loads(call(['docker', 'inspect', 'fsg-panel-db'], capture_output=True, text=True).stdout)[0]
        config['project'] = info['Config']['Labels']['com.docker.compose.project']
        config['port'] = input('Existing panel port [8080]: ').strip() or '8080'
        if not config['port'].isdigit() or not 1 <= int(config['port']) <= 65535:
            raise ValueError('Invalid panel port')
    else:
        print('Available releases:', ', '.join(r['version'] for r in releases))
        version = input('Release to install: ').strip()
        files = download(config, version)
        root = Path('/opt/farmservers/node')
        if root.exists():
            raise ValueError('Installation directory already exists; use --adopt for existing nodes')
        root.mkdir(parents=True, mode=0o700)
        write_files(root, files)
        config['project'] = 'farmservers'
        # Existing Ubuntu Docker setup, with central defaults before any ports open.
        env = os.environ.copy()
        env.update(CENTRAL_NODE_ID=node, CENTRAL_NODE_TOKEN=token)
        call(['bash', str(root/'scripts/install-ubuntu.sh'), '--central'], env=env)
    config['root'] = str(root)
    # Verify credentials and control services before enabling remote updates.
    healthy(config)
    install_service(config)
    print('Remote updates enabled. Complete Tunnel and Access setup using the site guide.')


def main():
    parser = argparse.ArgumentParser()
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument('--install', action='store_true')
    group.add_argument('--adopt', metavar='EXISTING_NODE_DIRECTORY')
    group.add_argument('--poll', action='store_true')
    args = parser.parse_args()
    if os.geteuid() != 0:
        raise RuntimeError('Run with sudo')
    os.umask(0o077)
    STATE.mkdir(parents=True, exist_ok=True, mode=0o700)
    with (STATE/'lock').open('w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if args.poll:
            poll(json.loads(CONFIG.read_text()))
        else:
            setup(args.adopt)


if __name__ == '__main__':
    main()
