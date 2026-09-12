import test from 'node:test';
import assert from 'node:assert/strict';
import {readGateway,validGateway} from '../src/gateways';
import {sealToken} from '../src/node-tokens';

const key='c'.repeat(64);
const gateway={origin:'https://origin-node-1.sargentweb.com',token:'a'.repeat(64),accessClientId:'client',accessClientSecret:'secret'};
const db=(value:string|null)=>({prepare:()=>({bind:()=>({first:async()=>({gateway_encrypted:value})})})}) as unknown as D1Database;

test('missing or malformed legacy configuration does not block database setup',async()=>{
  for(const legacy of ['', 'invalid secret', 'null','[]','{"node-1":null}','{"node-1":{"origin":"invalid"}}']){
    assert.deepEqual(await readGateway({DB:db(null),NODE_TOKEN_KEY:key,NODE_GATEWAYS:legacy},'node-1'),{gateway:null,source:'missing'});
  }
});
test('database gateways override legacy values and cannot be decrypted for another node',async()=>{
  const value=await sealToken(key,'gateway:node-1',JSON.stringify(gateway));
  const env={DB:db(value),NODE_TOKEN_KEY:key,NODE_GATEWAYS:'invalid'};
  assert.deepEqual(await readGateway(env,'node-1'),{gateway,source:'database'});
  await assert.rejects(readGateway(env,'node-2'));
  await assert.rejects(readGateway({...env,NODE_TOKEN_KEY:'d'.repeat(64)},'node-1'));
});
test('gateway validation rejects unsafe origins and placeholder credentials',()=>{
  assert.equal(validGateway(gateway),true);
  for(const origin of ['http://origin-node-1.sargentweb.com','https://evil.example','https://user@origin-node-1.sargentweb.com','https://origin-node-1.sargentweb.com:8443','https://origin-node-1.sargentweb.com?x=y','https://origin-node-1.sargentweb.com#fragment','https://origin-node-1.sargentweb.com/path'])assert.equal(validGateway({...gateway,origin}),false);
  assert.equal(validGateway({...gateway,accessClientSecret:'REPLACE_WITH_SECRET'}),false);
  assert.equal(validGateway({...gateway,accessClientId:'client\r\nheader'}),false);
});
