import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {digest} from '../src/security';

test('D1 heartbeat, CSRF, approval and one-use viewer tickets',async()=>{
  const origin='https://farmservers.sargentweb.com';
  const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:'test',modules:true,scriptPath:'dist/index.js',compatibilityDate:'2026-09-09',compatibilityFlags:['nodejs_compat'],d1Databases:['DB'],outboundService: async request => { const u=new URL(request.url); assert.equal(u.hostname,'origin-node-1.sargentweb.com'); assert.equal(request.headers.get('X-Forwarded-Proto'),'https'); assert.match(request.headers.get('X-Forwarded-Host') || '',/^view-/); return new Response('<a href="http://172.20.0.3:18000/feed/map.jpg?code=test&amp;size=512">http://172.20.0.3:18000/feed/map.jpg?code=test&amp;size=512</a>',{headers:{'Content-Type':'text/html','X-Farmservers-Upstream-Origin':'http://172.21.0.3:18000'}}); },bindings:{APP_ORIGIN:origin,BOOTSTRAP_ADMIN_ID:'513527870258151439',NODE_GATEWAYS:JSON.stringify({'node-1':{origin:'https://origin-node-1.sargentweb.com',token:'b'.repeat(64),accessClientId:'test-id',accessClientSecret:'test-secret'}})}}]}));
  try{
    const db=await mf.getD1Database('DB');
    await db.exec(await readFile('migrations/0001_control_plane.sql','utf8'));
    const sid='a'.repeat(64),time=Math.floor(Date.now()/1000);
    await db.prepare('INSERT INTO users VALUES(?,?,?,?)').bind('513527870258151439','Test owner','admin',time).run();
    await db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').bind(await digest(sid),'513527870258151439','csrf-test',time+3600).run();
    const headers={Cookie:'__Host-farmservers='+sid,Origin:origin,'X-CSRF-Token':'csrf-test','Content-Type':'application/json'};
    let r=await mf.dispatchFetch(origin+'/api/nodes',{method:'POST',headers:{Cookie:headers.Cookie},body:'{}'});assert.equal(r.status,403);
    r=await mf.dispatchFetch(origin+'/api/nodes',{method:'POST',headers,body:JSON.stringify({id:'node-1',name:'Test node'})});assert.equal(r.status,200);
    const enrolled=await r.json() as {token:string};assert.match(enrolled.token,/^[a-f0-9]{64}$/);
    const payload={version:1,servers:[{instance_id:'game-1',server_name:'Test game',password:'excluded'}],samples:[{scope:'host',timestamp:time,data:{cpu_percent:12,password:'excluded'}}]};
    const heartbeat={method:'POST',headers:{Authorization:'Bearer '+enrolled.token},body:JSON.stringify(payload)};
    assert.equal((await mf.dispatchFetch(origin+'/api/heartbeat/node-1',heartbeat)).status,200);
    assert.equal((await mf.dispatchFetch(origin+'/api/heartbeat/node-1',heartbeat)).status,200);
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM samples').first<{n:number}>())?.n,1);
    r=await mf.dispatchFetch(origin+'/api/nodes',{headers});const result=await r.text();assert.equal(result.includes('excluded'),false);assert.equal(result.includes(enrolled.token),false);
    r=await mf.dispatchFetch(origin+'/api/launch?node=node-1&kind=panel',{method:'POST',headers,body:'{}'});assert.equal(r.status,200);const launch=await r.json() as {url:string};
    r=await mf.dispatchFetch(launch.url,{redirect:'manual'});assert.equal(r.status,302);
    assert.equal((await mf.dispatchFetch(launch.url,{redirect:'manual'})).status,401);
    r=await mf.dispatchFetch(origin+'/api/launch?node=node-1&kind=web&instance=game-1',{method:'POST',headers,body:'{}'});
    const webLaunch=await r.json() as {url:string};
    r=await mf.dispatchFetch(webLaunch.url,{redirect:'manual'});
    const viewerCookie=r.headers.get('Set-Cookie')!.split(';')[0];
    const viewerOrigin=new URL(webLaunch.url).origin;
    assert.equal((await mf.dispatchFetch(viewerOrigin+'/')).status,401);
    r=await mf.dispatchFetch(viewerOrigin+'/',{headers:{Cookie:viewerCookie}});
    assert.equal(r.status,200);
    const html=await r.text();
    assert.equal(html.includes('172.20.'),false);
    assert.ok(html.includes(viewerOrigin+'/feed/map.jpg?code=test&amp;size=512'));
    assert.equal(html.includes('&amp;amp;'),false);
    assert.equal(r.headers.has('X-Farmservers-Upstream-Origin'),false);
    await db.prepare("UPDATE users SET role='pending'").run();
    assert.equal((await mf.dispatchFetch(origin+'/api/nodes',{headers})).status,403);
  } finally { await mf.dispose(); }
});
