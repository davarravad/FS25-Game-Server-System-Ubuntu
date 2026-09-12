import test from 'node:test';
import assert from 'node:assert/strict';
import {sealToken, openToken} from '../src/node-tokens';

test('saved tokens are authenticated, bound to their node, and randomly encrypted',async()=>{
  const key='b'.repeat(64), token='a'.repeat(64);
  const first=await sealToken(key,'node-1',token), second=await sealToken(key,'node-1',token);
  assert.notEqual(first,second);
  assert.equal(await openToken(key,'node-1',first),token);
  await assert.rejects(openToken(key,'node-2',first));
  await assert.rejects(openToken('c'.repeat(64),'node-1',first));
  await assert.rejects(sealToken('','node-1',token));
});
