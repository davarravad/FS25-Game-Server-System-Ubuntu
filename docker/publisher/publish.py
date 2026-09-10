"""Publish an allowlisted node snapshot over HTTPS; never log credentials."""
import json
import os
import time
import urllib.request
import urllib.error
import urllib.parse


def main():
    origin = os.environ.get('CENTRAL_URL', '').rstrip('/')
    node = os.environ.get('CENTRAL_NODE_ID', '')
    token = os.environ.get('CENTRAL_NODE_TOKEN', '')
    local_token = os.environ.get('NODE_API_TOKEN', '')
    if origin != 'https://farmservers.sargentweb.com' or not node or len(token) != 64 or len(local_token) < 32:
        raise SystemExit('Configure CENTRAL_URL, CENTRAL_NODE_ID, CENTRAL_NODE_TOKEN and NODE_API_TOKEN.')
    while True:
        started = time.monotonic()
        try:
            request = urllib.request.Request('http://nginx/?route=api_node_snapshot', headers={'Authorization': 'Bearer ' + local_token})
            with urllib.request.urlopen(request, timeout=120) as response:
                payload = response.read(262145)
            if len(payload) > 262144:
                raise ValueError('Snapshot too large')
            data = json.loads(payload)
            if data.get('version') != 1:
                raise ValueError('Unsupported node API')
            request = urllib.request.Request(origin + '/api/heartbeat/' + urllib.parse.quote(node, safe=''), data=payload, headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'}, method='POST')
            # A redirect must never send the credential to another endpoint.
            class NoRedirect(urllib.request.HTTPRedirectHandler):
                def redirect_request(self, *args, **kwargs):
                    return None
            with urllib.request.build_opener(NoRedirect).open(request, timeout=30) as response:
                if response.status != 200:
                    raise ValueError('Heartbeat rejected')
            print('Heartbeat accepted', flush=True)
        except Exception as error:
            code = getattr(error, 'code', None)
            print('Heartbeat failed: ' + type(error).__name__ + (f' (HTTP {code})' if code else ''), flush=True)
        time.sleep(max(5, 30 - (time.monotonic() - started)))


if __name__ == '__main__':
    main()
