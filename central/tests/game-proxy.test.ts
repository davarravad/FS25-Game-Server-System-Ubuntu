import test from 'node:test';
import assert from 'node:assert/strict';
import {gameUrl} from '../src/game-proxy';
const origin='https://view-0123456789abcdef01234567.farmservers.sargentweb.com';
const upstream='http://172.21.0.3:18000';
test('game feeds use the public HTTPS origin and preserve query and fragment',()=>{
  const path='/feed/dedicated-server-stats.xml?code=test-code&file=vehicles#data';
  assert.equal(gameUrl('http://172.20.0.3:18000'+path,origin,upstream),origin+path);
  assert.equal(gameUrl(upstream+'/login.html',origin,upstream),origin+'/login.html');
  assert.equal(gameUrl(origin.replace('https:','http:')+':18000/feed/map.jpg',origin,upstream),origin+'/feed/map.jpg');
});
test('other services, external URLs, credentials and relative links stay untouched',()=>{
  for(const link of ['/feed/map.jpg','admin','#anchor','javascript:alert(1)','https://example.com/feed/x','http://172.20.0.3:19000/feed/x','http://172.20.0.3:18000/other-app','http://user:pass@172.21.0.3:18000/feed/x']) {
    assert.equal(gameUrl(link,origin,upstream),link);
  }
});
