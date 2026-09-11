import test from 'node:test';
import assert from 'node:assert/strict';
import {provisionGameDomain} from '../src/cloudflare';
import {sealToken} from '../src/node-tokens';

test('Game domains are provisioned idempotently without replacing unrelated DNS or Workers',async()=>{
  const key='c'.repeat(64),host='game-node-server-12345678.sargentweb.com';
  const encrypted=await sealToken(key,'cloudflare-settings',JSON.stringify({account:'a'.repeat(32),zone:'b'.repeat(32),domain:'sargentweb.com',token:'private-token'}));
  const env={DB:{prepare:()=>({first:async()=>({encrypted,enabled:1})})} as unknown as D1Database,NODE_TOKEN_KEY:key,BOOTSTRAP_ADMIN_ID:'123456789012345678'};
  const original=globalThis.fetch,calls:string[]=[];
  let domains:{hostname:string;service:string}[]=[],dns:unknown[]=[],deny=false;
  globalThis.fetch=async(input,init)=>{
    const url=new URL(String(input));calls.push((init?.method||'GET')+' '+url.pathname);
    assert.equal(new Headers(init?.headers).get('Authorization'),'Bearer private-token');
    if(deny)return Response.json({success:false,errors:[{code:10000}]},{status:403});
    if(init?.method==='PUT'){
      const body=JSON.parse(init.body as string);assert.equal(body.hostname,host);assert.equal(body.service,'farmservers');domains=[{hostname:host,service:'farmservers'}];
      return Response.json({success:true,result:{id:'domain-1'}});
    }
    return Response.json({success:true,result:url.pathname.endsWith('/dns_records')?dns:domains});
  };
  try{
    await provisionGameDomain(env,host);assert.equal(calls.filter(c=>c.startsWith('PUT')).length,1);
    await provisionGameDomain(env,host);assert.equal(calls.filter(c=>c.startsWith('PUT')).length,1);
    domains=[{hostname:host,service:'unrelated'}];await assert.rejects(provisionGameDomain(env,host),/another Worker/);
    domains=[];dns=[{id:'existing'}];await assert.rejects(provisionGameDomain(env,host),/DNS record/);
    deny=true;await assert.rejects(provisionGameDomain(env,host),/Workers Scripts Write/);
    assert.equal(calls.filter(c=>c.startsWith('PUT')).length,1);
  }finally{globalThis.fetch=original;}
});
