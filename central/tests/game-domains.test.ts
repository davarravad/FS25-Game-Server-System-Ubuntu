import test from 'node:test';
import assert from 'node:assert/strict';
import {provisionGameDomain,hostnameResolves} from '../src/cloudflare';
import {sealToken} from '../src/node-tokens';

test('Game domains are provisioned idempotently, never touch DNS records, and are ready only once both address families resolve',async()=>{
  const key='c'.repeat(64),host='game-node-server-12345678.sargentweb.com';
  const encrypted=await sealToken(key,'cloudflare-settings',JSON.stringify({account:'a'.repeat(32),zone:'b'.repeat(32),domain:'sargentweb.com',token:'private-token'}));
  const env={DB:{prepare:()=>({first:async()=>({encrypted,enabled:1})})} as unknown as D1Database,NODE_TOKEN_KEY:key,BOOTSTRAP_ADMIN_ID:'123456789012345678'};
  const original=globalThis.fetch,calls:string[]=[];
  let domains:{hostname:string;service:string}[]=[],dns:unknown[]=[],deny=false,resolvable=new Set<string>();
  globalThis.fetch=async(input,init)=>{
    const url=new URL(String(input));
    if(url.hostname==='cloudflare-dns.com'){
      // Resolver view: the records a custom domain publishes are only visible by resolving them.
      assert.equal(new Headers(init?.headers).get('accept'),'application/dns-json');assert.equal(url.searchParams.get('name'),host);
      const type=url.searchParams.get('type')!;calls.push('DOH '+type);
      return Response.json(resolvable.has(type)?{Status:0,Answer:[{name:host,type:type==='A'?1:28,TTL:300,data:'x'}]}:{Status:3});
    }
    calls.push((init?.method||'GET')+' '+url.pathname);
    assert.equal(new Headers(init?.headers).get('Authorization'),'Bearer private-token');
    if(deny)return Response.json({success:false,errors:[{code:10000}]},{status:403});
    if(init?.method==='PUT'){
      const body=JSON.parse(init.body as string);assert.equal(body.hostname,host);assert.equal(body.service,'farmservers');domains=[{hostname:host,service:'farmservers'}];
      return Response.json({success:true,result:{id:'domain-1'}});
    }
    assert.notEqual(init?.method,'POST','DNS records are published by Cloudflare for the custom domain, never created by the site');
    return Response.json({success:true,result:url.pathname.endsWith('/dns_records')?dns:domains});
  };
  try{
    assert.equal(await provisionGameDomain(env,host),false,'Freshly attached: nothing resolves yet');assert.equal(calls.filter(c=>c.startsWith('PUT')).length,1);
    resolvable=new Set(['AAAA']);assert.equal(await provisionGameDomain(env,host),false,'IPv6 alone is not ready');assert.equal(calls.filter(c=>c.startsWith('PUT')).length,1);
    resolvable=new Set(['A','AAAA']);assert.equal(await provisionGameDomain(env,host),true);assert.equal(calls.filter(c=>c.startsWith('PUT')).length,1);
    assert.equal(await hostnameResolves(host),true);resolvable=new Set(['A']);assert.equal(await hostnameResolves(host),false);
    domains=[{hostname:host,service:'unrelated'}];await assert.rejects(provisionGameDomain(env,host),/another Worker/);
    domains=[];dns=[{id:'existing'}];await assert.rejects(provisionGameDomain(env,host),/DNS record/);
    deny=true;await assert.rejects(provisionGameDomain(env,host),/Workers Scripts Write/);
    assert.equal(calls.filter(c=>c.startsWith('PUT')).length,1);
  }finally{globalThis.fetch=original;}
});
