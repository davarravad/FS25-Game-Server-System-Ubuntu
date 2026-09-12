import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {digest} from '../src/security';
import {openToken,sealToken} from '../src/node-tokens';

test('Cloudflare setup is admin controlled, resumable and delivers only node-specific credentials',async()=>{
  const origin='https://farmservers.sargentweb.com',account='a'.repeat(32),zone='b'.repeat(32),key='c'.repeat(64),nodeToken='d'.repeat(64);
  const calls:{path:string;method:string;body:any}[]=[],tunnels:any[]=[],tokens:any[]=[],apps:any[]=[],dns:any[]=[];
  let healthNode='node-1',reject=false,oauthMode=false;
  const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:'cf-test',modules:true,scriptPath:'dist/index.js',compatibilityDate:'2026-09-09',compatibilityFlags:['nodejs_compat'],d1Databases:['DB'],bindings:{APP_ORIGIN:origin,BOOTSTRAP_ADMIN_ID:'123456789012345678',NODE_TOKEN_KEY:key},serviceBindings:{ASSETS:async()=>new Response('app')},outboundService:async request=>{
    const u=new URL(request.url),path=u.pathname,method=request.method,body=method==='GET'?null:await request.json();calls.push({path,method,body});
    if(u.hostname!=='api.cloudflare.com'){assert.equal(request.headers.get('CF-Access-Client-Secret'),'service-secret');return Response.json({node:healthNode});}
    assert.equal(request.headers.get('Authorization'),'Bearer cf-api-token');
    if(reject)return Response.json({success:false,errors:[{code:10000,message:'never echo cf-api-token'}]}, {status:403});
    let result:any=[];
    if(path.endsWith('/zones/'+zone))result={name:'sargentweb.com',account:{id:account}};
    else if(path.endsWith('/cfd_tunnel')){if(method==='POST'){result={id:'tunnel-'+(tunnels.length+1),name:(body as any).name};tunnels.push(result);}else result=tunnels.filter(t=>!u.searchParams.get('name')||t.name===u.searchParams.get('name'));}
    else if(path.endsWith('/access/service_tokens')){if(method==='POST'){result={id:'service-'+(tokens.length+1),name:(body as any).name,client_id:'service-id',client_secret:'service-secret',expires_at:'2099-01-01T00:00:00Z'};tokens.push(result);}else result=tokens;}
    else if(path.endsWith('/access/apps')){assert.ok(path.startsWith('/client/v4/'+(oauthMode?'zones/'+zone:'accounts/'+account))); if(method==='POST'){ if((body as any).domain.endsWith('/central/view/*/vnc/websockify/*')){assert.equal((body as any).policies[0].decision,'bypass');assert.deepEqual((body as any).policies[0].include,[{everyone:{}}]);assert.equal((body as any).domain,apps.at(-1).domain+'/central/view/*/vnc/websockify/*','Console bypass follows its node application');assert.equal((body as any).name,apps.at(-1).name+'-console');} else {assert.deepEqual((body as any).policies[0].include,[{service_token:{token_id:tokens.at(-1).id}}]);assert.equal((body as any).policies[0].decision,'non_identity');} result={id:'app-'+(apps.length+1),...(body as any)};apps.push(result);}else if(method==='PUT'){const idx=apps.findIndex(a=>path.endsWith('/'+a.id));assert.ok(idx>=0);apps[idx]={...apps[idx],...(body as any)};result=apps[idx];}else result=apps;}
    else if(path.endsWith('/configurations')){assert.equal((body as any).config.ingress[0].service,'http://127.0.0.1:8080');result={};}
    else if(path.endsWith('/dns_records')){if(method==='POST'){assert.ok(apps.length>0,'Access must precede DNS');result={id:'dns',...(body as any)};dns.push(result);}else result=dns.filter(r=>!u.searchParams.get('name')||r.name===u.searchParams.get('name'));}
    else if(path.endsWith('/token'))result='tunnel-token-for-node-1';
    else assert.fail('Unexpected Cloudflare request '+path);
    return Response.json({success:true,result});
  }}]}));
  try{
    const db=await mf.getD1Database('DB');for(const file of (await readdir('migrations')).filter(f=>f.endsWith('.sql')).sort())await db.exec(await readFile('migrations/'+file,'utf8'));
    const time=Math.floor(Date.now()/1000);
    await db.prepare('INSERT INTO users(id,name,role,created,blocked) VALUES(?,?,?,?,?)').bind('123456789012345678','Admin','admin',time,0).run();
    await db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').bind(await digest('session'),'123456789012345678','csrf',time+3600).run();
    await db.prepare('INSERT INTO nodes(id,name,token_hash) VALUES(?,?,?)').bind('node-1','First',await digest(nodeToken)).run();
    const headers={Cookie:'__Host-farmservers=session',Origin:origin,'X-CSRF-Token':'csrf','Content-Type':'application/json'};
    const admin=(path:string,body?:unknown)=>mf.dispatchFetch(origin+'/api/'+path,{headers,method:body===undefined?'GET':'POST',body:body===undefined?undefined:JSON.stringify(body)});
    const poll=(body={})=>mf.dispatchFetch(origin+'/api/node-connection',{method:'POST',headers:{Authorization:'Bearer '+nodeToken,'X-Node-ID':'node-1'},body:JSON.stringify({port:8080,...body})});
    assert.equal((await mf.dispatchFetch(origin+'/api/cloudflare')).status,401);
    assert.equal((await mf.dispatchFetch(origin+'/api/cloudflare',{method:'POST',headers:{Cookie:headers.Cookie},body:'{}'})).status,403);
    assert.deepEqual(await (await poll()).json(),{connection:null});assert.equal(calls.length,0);
    const config={account,zone,domain:'sargentweb.com',token:'cf-api-token',enabled:true};
    const initial=await admin('cloudflare',config);assert.equal(initial.status,200,await initial.text()+JSON.stringify(calls));
    const metadata=await (await admin('cloudflare')).text();assert.equal(metadata.includes('cf-api-token'),false);
    const ciphertext=await db.prepare('SELECT encrypted FROM cloudflare_settings').first<{encrypted:string}>();assert.equal(ciphertext!.encrypted.includes('cf-api-token'),false);
    oauthMode=true;
    await db.prepare('UPDATE cloudflare_settings SET encrypted=?').bind(await sealToken(key,'cloudflare-settings',JSON.stringify({...config,oauth:true,token:''}))).run();
    await db.prepare('INSERT INTO cloudflare_oauth_tokens(id,encrypted,expires) VALUES(1,?,?)').bind(await sealToken(key,'cloudflare-oauth-tokens',JSON.stringify({access_token:'cf-api-token',refresh_token:'refresh'})),time+3600).run();
    for(let i=0;i<6;i++)assert.equal((await poll()).status,200);
    const delivery=await (await poll()).json() as any;assert.equal(delivery.connection.tunnelToken,'tunnel-token-for-node-1');assert.match(delivery.connection.gatewayToken,/^[a-f0-9]{64}$/);assert.equal(JSON.stringify(delivery).includes('cf-api-token'),false);assert.equal(JSON.stringify(delivery).includes('service-secret'),false);
    healthNode='wrong-node';await poll({revision:delivery.connection.revision,status:'applied'});
    assert.equal((await db.prepare('SELECT gateway_encrypted FROM nodes WHERE id=?').bind('node-1').first<any>()).gateway_encrypted,null);
    healthNode='node-1';await poll({revision:delivery.connection.revision,status:'applied'});
    const stored=await db.prepare('SELECT gateway_encrypted FROM nodes WHERE id=?').bind('node-1').first<any>();assert.equal(JSON.parse(await openToken(key,'gateway:node-1',stored.gateway_encrypted)).token,delivery.connection.gatewayToken);
    const creates=calls.filter(c=>c.method==='POST').length;await poll();assert.equal(calls.filter(c=>c.method==='POST').length,creates);
    assert.deepEqual(apps.map(a=>a.domain),['origin-node-1.sargentweb.com','origin-node-1.sargentweb.com/central/view/*/vnc/websockify/*'],'Every node gets its Access application and a console bypass');
    // A node provisioned before console bypasses existed gains one on its next poll, without repeating any other step.
    const legacyRow=await db.prepare('SELECT encrypted FROM node_connections WHERE node_id=?').bind('node-1').first<{encrypted:string}>();
    const legacy=JSON.parse(await openToken(key,'connection:node-1',legacyRow!.encrypted));delete legacy.consoleAppId;apps.splice(1,1);
    await db.prepare('UPDATE node_connections SET encrypted=? WHERE node_id=?').bind(await sealToken(key,'connection:node-1',JSON.stringify(legacy)),'node-1').run();
    const before=calls.filter(c=>c.method==='POST').length;await poll();assert.equal(calls.filter(c=>c.method==='POST').length,before+1);assert.equal(apps.length,2);assert.equal(apps[1].policies[0].decision,'bypass');
    const reconciled=JSON.parse(await openToken(key,'connection:node-1',(await db.prepare('SELECT encrypted FROM node_connections WHERE node_id=?').bind('node-1').first<{encrypted:string}>())!.encrypted));assert.equal(reconciled.consoleAppId,apps[1].id);
    const settled=calls.length;await poll();assert.equal(calls.length,settled,'Reconciliation runs once');
    await db.prepare('INSERT INTO nodes(id,name,token_hash) VALUES(?,?,?)').bind('node-2','Second',await digest('e'.repeat(64))).run();
    assert.equal((await mf.dispatchFetch(origin+'/api/node-connection',{method:'POST',headers:{Authorization:'Bearer '+nodeToken,'X-Node-ID':'node-2'},body:JSON.stringify({port:8080})})).status,401);
    const pollSecond=()=>mf.dispatchFetch(origin+'/api/node-connection',{method:'POST',headers:{Authorization:'Bearer '+'e'.repeat(64),'X-Node-ID':'node-2'},body:JSON.stringify({port:8080})});
    dns.push({type:'A',name:'origin-node-2.sargentweb.com',content:'192.0.2.1',proxied:true});
    await pollSecond();
    await db.prepare('UPDATE node_connections SET lease_until=? WHERE node_id=?').bind(time+3600,'node-2').run();
    const requests=calls.length;await pollSecond();assert.equal(calls.length,requests,'An active lease prevents duplicate provisioning');
    await db.prepare('UPDATE node_connections SET lease_until=0 WHERE node_id=?').bind('node-2').run();
    for(let i=0;i<4;i++)await pollSecond();
    const conflict=await db.prepare('SELECT error,stage FROM node_connections WHERE node_id=?').bind('node-2').first<any>();assert.match(conflict.error,/different DNS record/);assert.equal(conflict.stage,'dns');
    const tunnelCount=tunnels.length;await pollSecond();assert.equal(tunnels.length,tunnelCount);
    dns.splice(dns.findIndex(r=>r.name==='origin-node-2.sargentweb.com'),1);
    assert.equal((await admin('cloudflare/retry',{id:'node-2'})).status,200);
    await pollSecond();await pollSecond();assert.equal(tunnels.length,tunnelCount,'Retry resumes the saved stage');
    assert.equal((await db.prepare('SELECT stage FROM node_connections WHERE node_id=?').bind('node-2').first<any>()).stage,'installing');
    assert.equal((await admin('cloudflare',{...config,token:'',enabled:false})).status,200);assert.deepEqual(await (await poll()).json(),{connection:null});
    oauthMode=false;reject=true;const failure=await admin('cloudflare',config);assert.equal(failure.status,503);assert.equal((await failure.text()).includes('cf-api-token'),false);reject=false;
    await db.prepare("UPDATE users SET role='operator'").run();assert.equal((await admin('cloudflare')).status,403);assert.equal((await mf.dispatchFetch(origin+'/cloudflare',{headers})).status,403);
    await db.prepare('UPDATE nodes SET enabled=0').run();assert.equal((await poll()).status,401);
  }finally{await mf.dispose();}
});
