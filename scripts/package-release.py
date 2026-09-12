#!/usr/bin/env python3
"""Build a signed, allowlisted release from a reviewed Git commit (never working files)."""
import argparse
import base64
import hashlib
import json
from pathlib import Path
import re
import subprocess
import tempfile

parser = argparse.ArgumentParser()
parser.add_argument('version')
parser.add_argument('--key', required=True, help='Offline Ed25519 private PEM key')
parser.add_argument('--ref', default='HEAD', help='Reviewed commit or tag')
parser.add_argument('--output', required=True, help='Output JSON outside the repository')
args = parser.parse_args()
if not re.fullmatch(r'v\d{1,6}\.\d{1,6}\.\d{1,6}', args.version):
    parser.error('Version must be vMAJOR.MINOR.PATCH')
root = Path(__file__).resolve().parent.parent
revision = subprocess.check_output(['git', 'rev-parse', '--verify', args.ref + '^{commit}'], cwd=root, text=True).strip()
archive = subprocess.check_output(['git', 'archive', '--format=tar.gz', revision, 'app', 'docker', 'templates', 'sql', 'scripts', '.env.example', 'docker-compose.yml', 'LICENSE'], cwd=root)
if len(archive) > 12*1024*1024:
    parser.error('Release exceeds the 12 MiB archive limit; exclude large content')
manifest = json.dumps({'version': args.version, 'commit': revision, 'sha256': hashlib.sha256(archive).hexdigest(), 'size': len(archive)}, separators=(',', ':'))
with tempfile.TemporaryDirectory() as tmp:
    path = Path(tmp)
    (path/'manifest').write_bytes(manifest.encode())
    subprocess.run(['openssl', 'pkeyutl', '-sign', '-inkey', args.key, '-rawin', '-in', str(path/'manifest'), '-out', str(path/'signature')], check=True)
    signature = (path/'signature').read_bytes()
    public = subprocess.check_output(['openssl', 'pkey', '-in', args.key, '-pubout', '-outform', 'DER'])
    Path(args.output).write_text(json.dumps({'manifest': manifest, 'signature': base64.b64encode(signature).decode(), 'archive': base64.b64encode(archive).decode()}), encoding='utf-8')
print('RELEASE_PUBLIC_KEY:', base64.b64encode(public).decode())
print('Key SHA256:', hashlib.sha256(public).hexdigest())
print('Package:', args.output)
