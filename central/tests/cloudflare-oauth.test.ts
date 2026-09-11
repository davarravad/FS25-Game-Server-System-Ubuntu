import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {digest} from '../src/security';
import {openToken} from '../src/node-tokens';

test('Cloudflare OAuth binds consent to the admin session, detects the zone, refreshes and disconnects',async()=>{
  const origin='https://farmservers.sargentweb.com',key='c'.repeat(64),account='a'.repeat(32),zone='b'.repeat(32);
  let exchanges=0,refreshes=0,revocations=0;
  const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:'oauth-test',modules:true,scriptPath:'dist/index.js',compatibilityDate:'2026-09-09',compatibilityFlags:['nodejs_compat'],d1Databases:['DB'],bindings:{APP_ORIGIN:origin,NODE_TOKEN_KEY:key},outboundService:async request=>{
    const u=new URL(request.url);
    if(u.pathname==='/oauth2/token'){
      assert.equal(request.headers.get('Authorization'),'Basic '+btoa('client-id:client-secret'));
      const body=new URLSearchParams(await request.text());
      if(body.get('grant_type')==='authorization_code'){
        exchanges++;assert.match(body.get('code_verifier')!,/^[a-f0-9]{64}$/);assert.equal(body.get('redirect_uri'),origin+'/api/cloudflare/oauth/callback');
      }else{refreshes++;assert.equal(body.get('refresh_token'),'refresh-secret');}
      return Response.json({access_token:refreshes?'renewed-secret':'access-secret',refresh_token:'refresh-secret',expires_in:3600,token_type:'Bearer'});
    }
    if(u.pathname==='/oauth2/revoke'){revocations++;assert.equal(new URLSearchParams(await request.text()).get('token'),'refresh-secret');return new Response(null,{status:200});}
    assert.equal(u.hostname,'api.cloudflare.com');assert.ok(['Bearer access-secret','Bearer renewed-secret'].includes(request.headers.get('Authorization')!));
    if(u.pathname==='/client/v4/zones')return Response.json({success:true,result:[{id:zone,name:'sargentweb.com',account:{id:account}}]});
    if(u.pathname==='/client/v4/zones/'+zone)return Response.json({success:true,result:{name:'sargentweb.com',account:{id:account}}});
    return Response.json({success:true,result:[]});
  }}]}));
  try{
    const db=await mf.getD1Database('DB');for(const file of (await readdir('migrations')).filter(f=>f.endsWith('.sql')).sort())await db.exec(await readFile('migrations/'+file,'utf8'));
    const time=Math.floor(Date.now()/1000);
    await db.prepare('INSERT INTO users(id,name,role,created,blocked) VALUES(?,?,?,?,?)').bind('123456789012345678','Admin','admin',time,0).run();
    for(const sid of ['session','other'])await db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').bind(await digest(sid),'123456789012345678','csrf',time+3600).run();
    const headers={Cookie:'__Host-farmservers=session',Origin:origin,'X-CSRF-Token':'csrf'};
    const api=(path:string,body?:unknown)=>mf.dispatchFetch(origin+'/api/cloudflare/'+path,{headers,method:body===undefined?'GET':'POST',body:body===undefined?undefined:JSON.stringify(body)});
    assert.equal((await mf.dispatchFetch(origin+'/api/cloudflare/oauth/start',{method:'POST',headers:{Cookie:headers.Cookie},body:'{}'})).status,403);
    assert.equal((await api('oauth/start',{})).status,409);
    assert.equal((await api('oauth/client',{clientId:'client-id',clientSecret:'client-secret',scopes:'zone.read dns.write'})).status,200);
    const metadata=await (await api('oauth/status')).text();assert.equal(metadata.includes('client-secret'),false);
    for(const [error,status] of [['invalid_scope','invalid-scope'],['access_denied','access-denied'],['unauthorized_client','unauthorized-client'],['invalid_request','invalid-request'],['unexpected-secret','provider-error']]){
      const attempt=await (await api('oauth/start',{})).json() as {url:string};
      const failureURL=origin+'/api/cloudflare/oauth/callback?'+new URLSearchParams({state:new URL(attempt.url).searchParams.get('state')!,error,error_description:'do-not-reflect-secret'});
      const failure=await mf.dispatchFetch(failureURL,{headers,redirect:'manual'});
      assert.equal(failure.headers.get('Location'),'/cloudflare?oauth='+status);
      assert.equal((await mf.dispatchFetch(failureURL,{headers,redirect:'manual'})).headers.get('Location'),'/cloudflare?oauth=invalid');
      assert.equal(exchanges,0);
    }
    const start=await (await api('oauth/start',{})).json() as {url:string};const target=new URL(start.url);
    assert.equal(target.origin,'https://dash.cloudflare.com');assert.equal(target.searchParams.get('code_challenge_method'),'S256');assert.match(target.searchParams.get('scope')!,/offline_access/);assert.equal(start.url.includes('client-secret'),false);
    const callback='/api/cloudflare/oauth/callback?'+new URLSearchParams({state:target.searchParams.get('state')!,code:'auth-code'});
    let response=await mf.dispatchFetch(origin+callback,{headers:{Cookie:'__Host-farmservers=other'},redirect:'manual'});assert.equal(response.headers.get('Location'),'/cloudflare?oauth=invalid');assert.equal(exchanges,0);
    response=await mf.dispatchFetch(origin+callback,{headers,redirect:'manual'});assert.equal(response.headers.get('Location'),'/cloudflare?oauth=connected');assert.equal(exchanges,1);
    response=await mf.dispatchFetch(origin+callback,{headers,redirect:'manual'});assert.equal(response.headers.get('Location'),'/cloudflare?oauth=invalid');assert.equal(exchanges,1);
    const config=await db.prepare('SELECT encrypted,enabled FROM cloudflare_settings').first<any>();const value=JSON.parse(await openToken(key,'cloudflare-settings',config.encrypted));assert.equal(value.account,account);assert.equal(value.zone,zone);assert.equal(value.oauth,true);assert.equal(value.token,'');assert.equal(config.enabled,1);
    const encrypted=await db.prepare('SELECT encrypted FROM cloudflare_oauth_tokens').first<any>();assert.equal(encrypted.encrypted.includes('access-secret'),false);
    const overview=await (await mf.dispatchFetch(origin+'/api/cloudflare',{headers})).text();assert.equal(overview.includes('access-secret'),false);
    await db.prepare('UPDATE cloudflare_oauth_tokens SET expires=0').run();
    response=await mf.dispatchFetch(origin+'/api/cloudflare',{method:'POST',headers,body:JSON.stringify({account,zone,domain:'sargentweb.com',token:'',enabled:true})});assert.equal(response.status,200);assert.equal(refreshes,1);
    assert.equal((await api('oauth/disconnect',{})).status,200);assert.equal(revocations,1);assert.equal(await db.prepare('SELECT id FROM cloudflare_oauth_tokens').first(),null);assert.equal((await db.prepare('SELECT enabled FROM cloudflare_settings').first<any>()).enabled,0);
    await db.prepare("UPDATE users SET role='operator'").run();assert.equal((await api('oauth/start',{})).status,403);assert.equal((await api('oauth/status')).status,403);
  }finally{await mf.dispose();}
});
