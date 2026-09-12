#!/usr/bin/env python3
"""Private, resumable game library worker. Runs on a node, never in a browser."""
import fcntl
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
import time
import urllib.request
import urllib.error

CHUNK = 4 * 1024 * 1024
STATE = Path('/var/lib/farmservers-game-sync')
SITE = 'https://farmservers.sargentweb.com/api/game-node/'
BLOCKED = {'game.xml', 'dedicatedserver.xml', 'log.txt', 'cert.pem', 'pk.pem', '.env'}


def safe_path(name):
    p = PurePosixPath(name)
    return (isinstance(name, str) and len(name) <= 512 and not re.search(r'[\\\x00-\x1f:]', name)
            and not p.is_absolute() and name == p.as_posix() and all(part not in ('.', '..', '') for part in name.split('/'))
            and not re.match(r'^\d+(/|$)|^start_fs25_', name, re.I)
            and not any(part.lower() in BLOCKED or re.fullmatch(r'savegame\d*|mods', part, re.I) for part in p.parts))


def target(root, name):
    if not safe_path(name):
        raise ValueError('Unsafe game file path')
    result = root / name
    for path in [root, result, *result.parents]:
        if path.is_symlink():
            raise ValueError('Symlinks are not supported in game sync')
        if path == root:
            break
    return result


def save(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix('.tmp')
    with tmp.open('w') as stream:
        json.dump(value, stream, separators=(',', ':'))
        stream.flush()
        os.fsync(stream.fileno())
    tmp.replace(path)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise ValueError('Redirect refused')


def request(config, operation, body=None, raw=False, method=None, limit=8*1024*1024):
    data = body if raw else json.dumps(body, separators=(',', ':')).encode() if body is not None else None
    req = urllib.request.Request(SITE+operation, data=data, method=method, headers={
        'Authorization': 'Bearer '+config['token'], 'X-Node-ID': config['node'],
        # Cloudflare bot protection blocks Python's default User-Agent with HTTP 403.
        'User-Agent': 'Farmservers-Node/1.0 (+https://farmservers.sargentweb.com)',
        'Content-Type': 'application/octet-stream' if raw else 'application/json'})
    with urllib.request.build_opener(NoRedirect()).open(req, timeout=120) as response:
        data = response.read(limit+1)
    if len(data)>limit:
        raise ValueError('Response too large')
    return data if raw else json.loads(data)


def version(root):
    path = target(root, 'VERSION')
    if not path.is_file():
        return None
    with path.open() as stream:value = stream.read(100).strip().lstrip('v')
    return value if re.fullmatch(r'\d+(\.\d+){2,3}', value) else None


def manifest(root, dlc_root):
    game_version = version(root)
    if not game_version:
        raise ValueError('Game VERSION file is missing or invalid; complete the game installation first')
    cache_path=STATE/'scan-cache.json'
    cache=json.loads(cache_path.read_text()) if cache_path.exists() else {}
    next_cache={}
    files = []
    total_size=0
    roots = [(root, '')]
    if dlc_root.is_dir():
        roots.append((dlc_root, '__dlc__/'))
    for base, prefix in roots:
        for directory, dirs, names in os.walk(base, followlinks=False):
            dirs[:] = sorted(d for d in dirs if not d.startswith('.') and not (Path(directory)/d).is_symlink() and safe_path((Path(directory)/d).relative_to(base).as_posix()))
            for name in sorted(names):
                file = Path(directory)/name
                relative = file.relative_to(base).as_posix()
                if file.is_symlink() or not safe_path(relative) or name.startswith('.') or prefix and not re.fullmatch(r'FarmingSimulator25_[A-Za-z0-9-]+_[A-Za-z0-9_.-]+\.exe', relative):
                    continue
                chunks = []
                stat = file.stat()
                total_size+=stat.st_size
                if stat.st_size>100*1024**3 or total_size>200*1024**3:raise ValueError('Game library exceeds size limits')
                cache_key=str(file)
                cached=cache.get(cache_key,{})
                if cached.get('mtime')==stat.st_mtime_ns and cached.get('size')==stat.st_size:
                    chunks=cached['chunks']
                else:
                    with file.open('rb') as stream:
                        while data := stream.read(CHUNK):
                            chunks.append(hashlib.sha256(data).hexdigest())
                next_cache[cache_key]={'mtime':stat.st_mtime_ns,'size':stat.st_size,'chunks':chunks}
                if file.stat().st_mtime_ns != stat.st_mtime_ns or file.stat().st_size != stat.st_size:
                    raise ValueError('Game files changed during scan; retry after the update finishes')
                files.append({'path': prefix+relative, 'size':stat.st_size, 'chunks':chunks})
                if len(files)>20000:
                    raise ValueError('Too many game files')
    files.sort(key=lambda f:f['path'])
    if not {'x64/FarmingSimulator2025Game.exe','dedicatedServer.exe','FarmingSimulator2025.exe','VERSION'}.issubset({f['path'] for f in files}):
        raise ValueError('Game installation is incomplete')
    save(cache_path,next_cache)
    return {'version':game_version,'files':files}


def fingerprint(value):
    base={'version':value['version'],'files':[f for f in value['files'] if not f['path'].startswith('__dlc__/')]}
    return hashlib.sha256(json.dumps(base,separators=(',', ':'),ensure_ascii=False).encode()).hexdigest()


def uses_game(row,root):
    # The control agent also mounts /opt and shared storage; it must stay online.
    if row.get('Name')=='/fsg-panel-agent' and row.get('Config',{}).get('Labels',{}).get('com.docker.compose.service')=='agent':return False
    return any((Path(m['Source'])==root or root.is_relative_to(Path(m['Source'])) or Path(m['Source']).is_relative_to(root)) and m.get('Destination')=='/opt/fs25/game' for m in row.get('Mounts',[]) if m.get('Type')=='bind')


def running(root):
    ids=subprocess.run(['docker','ps','-q'],check=True,capture_output=True,text=True,timeout=30).stdout.split()
    if not ids:
        return False
    rows=json.loads(subprocess.run(['docker','inspect',*ids],check=True,capture_output=True,text=True,timeout=30).stdout)
    return any(uses_game(row,root) for row in rows)


def dlc_runtime_ready(root):
    ids=subprocess.run(['docker','ps','-aq'],check=True,capture_output=True,text=True,timeout=30).stdout.split()
    if not ids:return True
    rows=json.loads(subprocess.run(['docker','inspect',*ids],check=True,capture_output=True,text=True,timeout=30).stdout)
    for row in rows:
        if uses_game(row,root) and row.get('Config',{}).get('Labels',{}).get('com.farmservers.dlc-selection')!='1':return False
    return True


def paths(config):
    script="require '/var/www/html/src/bootstrap.php'; $h=local_host_record(); echo json_encode(['game'=>$h['shared_game_path'],'dlc'=>$h['shared_dlc_path'],'instances'=>env_value('INSTANCE_BASE_PATH','/opt/fsg-panel/instances')]);"
    result=subprocess.run(['docker','compose','-p',config['project'],'exec','-T','web','php','-r',script],cwd=config['root'],check=True,capture_output=True,text=True,timeout=60)
    values=json.loads(result.stdout)
    game=Path(values['game'])/'Farming Simulator 2025'
    dlc=Path(values['dlc'])
    if not game.is_absolute() or not dlc.is_absolute() or len(dlc.parts)<3 or any(p.is_symlink() for p in [game,dlc,*game.parents,*dlc.parents]):
        raise ValueError('Unsafe shared storage paths')
    return game,dlc,Path(values['instances'])


_last_progress={}

def progress(config,job,status,done,total,detail):
    stamp=time.monotonic()
    if status=='running' and done<total and stamp-_last_progress.get(job['id'],0)<1:return
    _last_progress[job['id']]=stamp
    request(config,'progress?job='+job['id'],{'status':status,'done':done,'total':total,'detail':detail[:500]})


def publish(config,job,root,dlc):
    data=manifest(root,dlc)
    total=sum(f['size'] for f in data['files']);done=0
    journal=STATE/(job['id']+'-uploaded.json')
    uploaded=set(json.loads(journal.read_text())) if journal.exists() else set()
    for file in data['files']:
        name=file['path'];base=dlc if name.startswith('__dlc__/') else root
        path=target(base,name.removeprefix('__dlc__/'))
        with path.open('rb') as stream:
            for chunk in file['chunks']:
                raw=stream.read(CHUNK)
                if hashlib.sha256(raw).hexdigest()!=chunk:
                    raise ValueError('Source files changed; publish again after the game update completes')
                if chunk not in uploaded:
                    request(config,'chunk?job='+job['id']+'&hash='+chunk,raw,raw=True,method='PUT')
                    uploaded.add(chunk);save(journal,sorted(uploaded))
                done+=len(raw)
                progress(config,job,'running',done,total,'Publishing '+name)
    if manifest(root,dlc)!=data:
        raise ValueError('Source installation changed during publication')
    request(config,'publish?job='+job['id'],data)


def install(config,job,root,dlc,instances):
    if job.get('status')=='waiting' and running(root):
        progress(config,job,'waiting',job.get('done_bytes',0),job.get('total_bytes',0),'Files downloaded. Stop all game containers on this node to apply.');return
    completed=STATE/(job['id']+'-complete.json')
    if completed.exists():
        info=json.loads(completed.read_text());progress(config,job,'succeeded',info['total'],info['total'],'Game files ready.');return
    data=request(config,'manifest?job='+job['id'])
    if not isinstance(data.get('files'),list) or len(data['files'])>20000:
        raise ValueError('Invalid manifest')
    stage=STATE/job['id'];stage.mkdir(exist_ok=True)
    contents=stage/'files';contents.mkdir(exist_ok=True)
    # The library may include optional DLC installers. Only selected packages are copied.
    selected=set(job.get('dlcs',[]))
    files=[f for f in data['files'] if not f['path'].startswith('__dlc__/') or re.match(r'__dlc__/FarmingSimulator25_([^_]+)_',f['path']).group(1) in selected]
    if not all(safe_path(f.get('path','')) for f in files):raise ValueError('Unsafe manifest')
    total=sum(f['size'] for f in files);done=0
    missing=sum(max(0,f['size']-(target(contents,f['path']).stat().st_size if target(contents,f['path']).is_file() else 0)) for f in files)
    if shutil.disk_usage(stage).free<missing+total:
        raise ValueError('Not enough free disk space for staging and rollback backup')
    for file in files:
        name=file['path'];dest=target(contents,name);dest.parent.mkdir(parents=True,exist_ok=True)
        if not isinstance(file['size'],int) or file['size']<0 or len(file['chunks'])!=(file['size']+CHUNK-1)//CHUNK:
            raise ValueError('Invalid file size')
        with dest.open('a+b') as output:
            for index,chunk in enumerate(file['chunks']):
                if not re.fullmatch('[a-f0-9]{64}',chunk):
                    raise ValueError('Invalid checksum')
                offset=index*CHUNK;size=min(CHUNK,file['size']-offset)
                output.seek(offset);raw=output.read(size)
                if hashlib.sha256(raw).hexdigest()!=chunk:
                    raw=request(config,'chunk?job='+job['id']+'&hash='+chunk,raw=True,limit=CHUNK)
                    if len(raw)!=size or hashlib.sha256(raw).hexdigest()!=chunk:
                        raise ValueError('Downloaded file failed verification')
                    # a+b always appends; reopen for bounded, resumable random writes.
                    with dest.open('r+b') as write:
                        write.seek(offset);write.write(raw);write.flush();os.fsync(write.fileno())
                done+=size;progress(config,job,'running',done,total,'Downloading '+name)
            output.truncate(file['size'])
    if selected and not dlc_runtime_ready(root):
        progress(config,job,'waiting',done,total,'Rebuild/recreate game containers with the latest runtime before applying per-server DLC selections.');return
    if running(root):
        progress(config,job,'waiting',done,total,'Files downloaded. Stop all game containers on this node to apply.');return
    root.mkdir(parents=True,exist_ok=True);dlc.mkdir(parents=True,exist_ok=True)
    root.chmod(0o755);dlc.chmod(0o755)
    env_text=(Path(config['root'])/'.env').read_text() if config.get('root') and (Path(config['root'])/'.env').is_file() else ''
    uid=int(re.search(r'^PUID=(\d+)$',env_text,re.M).group(1)) if re.search(r'^PUID=(\d+)$',env_text,re.M) else 1000
    gid=int(re.search(r'^PGID=(\d+)$',env_text,re.M).group(1)) if re.search(r'^PGID=(\d+)$',env_text,re.M) else 1000
    if hasattr(os,'chown'):
        os.chown(root,uid,gid);os.chown(dlc,uid,gid)
    apply_lock=(root.parent/'.farmservers-sync.lock').open('a')
    try:
        fcntl.flock(apply_lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    except BlockingIOError:
        apply_lock.close();progress(config,job,'waiting',done,total,'Waiting for a server operation to finish.');return
    lock=target(root,'.farmservers-sync-in-progress')
    lock.write_text(job['id'])
    try:
        if running(root):
            progress(config,job,'waiting',done,total,'Waiting for game containers to stop.');return
        backup=stage/'backup';journal=stage/'apply.json'
        if journal.exists():
            # Never continue a partially applied installation without restoring its old files.
            rollback(root,dlc,backup,json.loads(journal.read_text()));journal.unlink()
        entries=[]
        for file in files:
            name=file['path'];base=dlc if name.startswith('__dlc__/') else root;dest=target(base,name.removeprefix('__dlc__/'))
            entries.append({'path':name,'existed':dest.exists()})
            if dest.exists():
                old=target(backup,name);old.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(dest,old)
        save(journal,entries)
        try:
            for file in files:
                name=file['path'];base=dlc if name.startswith('__dlc__/') else root;dest=target(base,name.removeprefix('__dlc__/'));dest.parent.mkdir(parents=True,exist_ok=True)
                for folder in [dest.parent,*dest.parent.parents]:
                    folder.chmod(0o755)
                    if hasattr(os,'chown'):os.chown(folder,uid,gid)
                    if folder==base:break
                tmp=dest.with_name(dest.name+'.farmservers-new');shutil.copyfile(target(contents,name),tmp);tmp.chmod(0o644)
                if hasattr(os,'chown'):os.chown(tmp,uid,gid)
                with tmp.open('r+b') as stream:os.fsync(stream.fileno())
                tmp.replace(dest)
            # TLS credentials are unique to this node, never copied from the source.
            if not (root/'cert.pem').exists() or not (root/'pk.pem').exists():
                subprocess.run(['openssl','req','-x509','-newkey','rsa:2048','-nodes','-keyout',str(root/'pk.pem'),'-out',str(root/'cert.pem'),'-days','365','-subj','/CN=localhost'],check=True,capture_output=True,timeout=60)
                (root/'pk.pem').chmod(0o644)
            (root/'.game-install-complete').touch()
            for setting in job.get('dlc_settings',[]):
                if not re.fullmatch(r'[A-Za-z0-9_-]{1,64}',setting['instance']):raise ValueError('Invalid DLC target')
                instance=target(instances,setting['instance'])
                if not instance.is_dir():continue
                selection=target(instance,'data/config/FarmingSimulator2025/.farmservers-enabled-dlcs')
                missing=[];parent=selection.parent
                while not parent.exists():missing.append(parent);parent=parent.parent
                selection.parent.mkdir(parents=True,exist_ok=True)
                for folder in missing:
                    folder.chmod(0o755)
                    if hasattr(os,'chown'):os.chown(folder,uid,gid)
                selection.write_text('\n'.join(setting['packages'])+'\n');selection.chmod(0o644)
            journal.unlink()
        except Exception:
            rollback(root,dlc,backup,entries);journal.unlink();raise
        save(completed,{'total':total})
        progress(config,job,'succeeded',total,total,'Game files ready. Create a server and complete its own license activation.')
    finally:
        if not (stage/'apply.json').exists():lock.unlink(missing_ok=True)
        apply_lock.close()


def rollback(root,dlc,backup,entries):
    for entry in entries:
        name=entry['path'];base=dlc if name.startswith('__dlc__/') else root;dest=target(base,name.removeprefix('__dlc__/'))
        if entry['existed']:
            shutil.copy2(target(backup,name),dest)
        else:
            dest.unlink(missing_ok=True)


def main():
    os.umask(0o077);STATE.mkdir(parents=True,exist_ok=True)
    with (STATE/'lock').open('w') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        config=json.loads(Path('/etc/farmservers/updater.json').read_text())
        root,dlc,instances=paths(config)
        marker=root/'.farmservers-sync-in-progress'
        if marker.exists():
            recovery_id=marker.read_text().strip()
            if not re.fullmatch('[a-f0-9-]{36}',recovery_id):raise ValueError('Invalid recovery marker')
            recovery=STATE/recovery_id/'apply.json'
            with (root.parent/'.farmservers-sync.lock').open('a') as recovery_lock:
                fcntl.flock(recovery_lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
                if running(root):raise ValueError('Stop game containers before sync recovery')
                if recovery.exists():
                    rollback(root,dlc,STATE/recovery_id/'backup',json.loads(recovery.read_text()));recovery.unlink()
                marker.unlink()
        inventory={'version':None,'fingerprint':None,'status':'empty','detail':'No game installation yet.'}
        if root.exists() and any(p.name!='.farmservers-sync-in-progress' for p in root.iterdir()):
            try:
                data=manifest(root,dlc);inventory={'version':data['version'],'fingerprint':fingerprint(data),'status':'ready','detail':'Game files detected.'}
            except Exception as error:
                inventory.update(status='unknown',version=version(root),detail=str(error)[:500])
        job=request(config,'poll',inventory)['job']
        if job:
            if not re.fullmatch('[a-f0-9-]{36}',job['id']):raise ValueError('Invalid job ID')
            try:
                if job['kind']=='publish':publish(config,job,root,dlc)
                else:install(config,job,root,dlc,instances)
            except urllib.error.HTTPError as error:
                if error.code in (408,429) or error.code>=500:raise
                progress(config,job,'failed',0,0,'Game library request rejected (HTTP '+str(error.code)+'). Check node software and retry.')
            except (urllib.error.URLError,TimeoutError):
                raise  # Keep the active job resumable on the next timer tick.
            except Exception as error:
                progress(config,job,'failed',0,0,str(error))


if __name__=='__main__':
    main()
