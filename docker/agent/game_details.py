"""Read public game details without forwarding feed tokens or player identities."""
import html
import re
import time
import xml.etree.ElementTree as ET
from urllib.parse import urlencode

# The game admin panel is polled at most this often per instance: each poll signs in and
# creates a panel session, and the version only changes when the game itself is updated.
PANEL_INTERVAL = 300
PANEL_RETRY = 60
PANEL_CACHE = {}

# Runs inside the game container with its own WEB_* environment, so the panel credentials
# never appear on a command line or leave the container. Mirrors the sign-in that the
# runtime's start_game.mjs performs: a SessionID cookie from the login page, the login form,
# then the settings page that lists the game version, player slots and savegame.
PANEL_SCRIPT = (
    "const base='http://127.0.0.1:'+(process.env.WEB_PORT||process.env.SERVER_PORT||'7999')+'/index.html?lang=en';"
    "const read=async r=>{const d=new TextDecoder();let n=0,out='';for await(const b of r.body){n+=b.length;if(n>1048576)process.exit(1);out+=d.decode(b,{stream:true});}return out+d.decode();};"
    "const opts=h=>({signal:AbortSignal.timeout(2500),redirect:'manual',headers:h});"
    "const first=await fetch(base,opts({}));await read(first);"
    "const raw=typeof first.headers.getSetCookie==='function'?first.headers.getSetCookie():[first.headers.get('set-cookie')||''];"
    "const cookie=raw.map(c=>(/(SessionID=[^;]+)/i.exec(c)||[])[1]).find(Boolean);if(!cookie)process.exit(1);"
    "const form=new URLSearchParams({username:process.env.WEB_USERNAME||'admin',password:process.env.WEB_PASSWORD||'',login:'Login'});"
    "const login=await fetch(base,{...opts({Cookie:cookie,'Content-Type':'application/x-www-form-urlencoded'}),method:'POST',body:form.toString()});await read(login);"
    "const page=await fetch(base,opts({Cookie:cookie}));if(!page.ok)process.exit(1);process.stdout.write(await read(page));"
)


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


def selected_option(page, name):
    """Return (value, text) of the selected option in the named select, or None."""
    select = re.search(r'<select[^>]*\bname\s*=\s*"' + re.escape(name) + r'"[^>]*>(.*?)</select>', page, re.S | re.I)
    if not select:
        return None
    option = re.search(r'<option[^>]*\bvalue="([^"]*)"[^>]*\bselected\b[^>]*>(.*?)</option>', select.group(1), re.S | re.I)
    if not option:
        return None
    return option.group(1), html.unescape(re.sub(r'<[^>]+>', '', option.group(2))).strip()


def parse_panel(page):
    """Game details from the dedicated server web admin settings page (the signed-in index.html)."""
    if len(page) > 1024 * 1024:
        raise ValueError('Panel page too large')
    result = {}
    version = re.search(r'Farming Simulator\s+\d+\s*\((\d+(?:\.\d+){2,3})\)', page)
    if version:
        result['game_version'] = version.group(1)
    slots = selected_option(page, 'max_player')
    if slots and slots[0].isdigit() and 1 <= int(slots[0]) <= 1000:
        result['player_capacity'] = int(slots[0])
    savegame = selected_option(page, 'savegame')
    if savegame:
        # "SAVEGAME 1 - Map: Riverbend Springs, Money: 100000 $": the map the server actually loads.
        loaded = re.search(r'Map:\s*(.+?)(?:,\s*Money:|$)', savegame[1])
        if loaded and loaded.group(1).strip():
            result['game_map'] = loaded.group(1).strip()[:100]
    if not result:
        raise ValueError('Not a game admin settings page')
    return result


def panel_details(instance_id, command):
    """Details from the game admin panel, cached per instance for PANEL_INTERVAL seconds."""
    cached = PANEL_CACHE.get(instance_id)
    if cached and time.monotonic() - cached[0] < (PANEL_INTERVAL if cached[1] else PANEL_RETRY):
        return cached[1]
    details = {}
    try:
        response = command(['docker', 'exec', instance_id, 'node', '--input-type=module', '-e', PANEL_SCRIPT], timeout=10)
        if response['code'] == 0:
            details = parse_panel(response['stdout'])
    except (OSError, ValueError, KeyError, TypeError):
        details = {}
    PANEL_CACHE[instance_id] = (time.monotonic(), details)
    return details


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
        PANEL_CACHE.pop(instance_id, None)
        return result
    # The game admin panel reports the version the dedicated server really runs, even while the
    # game itself is stopped, so it takes precedence over the installation's cached VERSION file.
    result.update(panel_details(instance_id, command))
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
