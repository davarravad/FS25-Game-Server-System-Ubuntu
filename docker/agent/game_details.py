"""Read public game details without forwarding feed tokens or player identities."""
import re
import time
import xml.etree.ElementTree as ET
from urllib.parse import urlencode


def xml(data):
    if len(data) > 1024 * 1024 or b'<!DOCTYPE' in data.upper() or b'<!ENTITY' in data.upper():
        raise ValueError('Invalid game XML')
    return ET.fromstring(data)


def parse_feed(data):
    server = xml(data)
    if server.tag != 'Server':
        raise ValueError('Not a server feed')
    slots = server.find('Slots')
    result = {}
    for key, attr in [('game_version', 'version'), ('game_map', 'mapName')]:
        value = server.get(attr, '').strip()
        if value:
            result[key] = value[:100]
    if slots is not None:
        used, capacity = int(slots.get('numUsed', '-1')), int(slots.get('capacity', '-1'))
        if 0 <= used <= capacity <= 1000:
            result.update(player_count=used, player_capacity=capacity)
    result['game_sampled_at'] = int(time.time())
    return result


def collect(instance_dir, instance_id, values, running, command):
    profile = instance_dir / 'data/config/FarmingSimulator2025'
    result = {}
    try:
        with (profile / 'VERSION').open('rb') as source:
            version = source.read(100).decode().strip()
        if re.fullmatch(r'\d+(?:\.\d+){2,3}', version):
            result['game_version'] = version
    except (OSError, UnicodeError):
        pass
    if not running:
        return result
    for name in ('dedicated_server/serverStats.xml', 'dedicated_server/dedicated-server-stats.xml'):
        try:
            path = profile / name
            if time.time() - path.stat().st_mtime > 720:
                continue
            with path.open('rb') as source:
                details = parse_feed(source.read(1024 * 1024 + 1))
            details['game_sampled_at'] = int(path.stat().st_mtime)
            result.update(details)
            return result
        except (OSError, ValueError, ET.ParseError):
            pass
    try:
        code = values.get('GAME_STATS_CODE')
        if not code:
            with (profile / 'dedicated_server/dedicatedServerConfig.xml').open('rb') as source:
                config = xml(source.read(1024 * 1024 + 1))
            code = next((entry.get('code') or entry.text for entry in config.iter() if entry.get('code') or entry.tag in ('stats_code', 'webStatsCode')), None)
        port = int(values.get('WEB_PORT', '18000'))
        if not code or len(code) > 256 or not 1 <= port <= 65535:
            return result
        url = f'http://127.0.0.1:{port}/feed/dedicated-server-stats.xml?' + urlencode({'code': code})
        # Run inside the game container: no published ports or cross-network access required.
        script = "const r=await fetch(process.argv[1],{signal:AbortSignal.timeout(2500),redirect:'error'});if(!r.ok)process.exit(1);let n=0;for await(const b of r.body){n+=b.length;if(n>1048576)process.exit(1);process.stdout.write(b)}"
        response = command(['docker', 'exec', instance_id, 'node', '--input-type=module', '-e', script, url], timeout=4)
        if response['code'] == 0:
            result.update(parse_feed(response['stdout'].encode()))
    except (OSError, ValueError, ET.ParseError):
        pass
    return result
