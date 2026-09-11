import test from 'node:test';
import assert from 'node:assert/strict';
import {management} from '../src/management';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {readFile} from 'node:fs/promises';
import {digest} from '../src/security';

test('management policy rejects unsafe methods, viewer access and oversized uploads',async()=>{
  let resolved=0;const gateway=async()=>{resolved++;return {origin:'https://origin-node.sargentweb.com',token:'a'.repeat(64),accessClientId:'client',accessClientSecret:'secret'};};
  const invoke=(op:string,method:string,role:string,body?:BodyInit)=>management(new Request('https://farmservers.sargentweb.com/api/manage?node=node-1&operation='+op,{method,body}),{user_id:'123456789012345678',role},gateway,async()=>{});
  assert.equal((await invoke('create','GET','admin')).status,405);
  assert.equal((await invoke('server','GET','operator')).status,403);
  assert.equal((await invoke('inventory','GET','viewer')).status,403);
  assert.equal((await invoke('delete','POST','operator','{}')).status,403);
  assert.equal((await invoke('unknown','GET','admin')).status,422);assert.equal(resolved,0);
  assert.equal((await invoke('upload','POST','admin',new Uint8Array(4*1024*1024+1))).status,413);
});

test('main-site management authenticates, checks CSRF, fixes gateway target and strips cookies',async()=>{
  const origin='https://farmservers.sargentweb.com';let calls=0;
  const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:'management',modules:true,scriptPath:'dist/index.js',compatibilityDate:'2026-09-09',compatibilityFlags:['nodejs_compat'],d1Databases:['DB'],bindings:{APP_ORIGIN:origin,NODE_GATEWAYS:JSON.stringify({'node-1':{origin:'https://origin-node.sargentweb.com',token:'a'.repeat(64),accessClientId:'client',accessClientSecret:'secret'}})},outboundService:async req=>{
    calls++;const url=new URL(req.url);assert.equal(url.origin,'https://origin-node.sargentweb.com');assert.equal(url.searchParams.get('route'),'api_central_manage');assert.equal(req.headers.get('X-Central-Role'),'admin');assert.equal(req.headers.get('X-Central-Token'),'a'.repeat(64));assert.equal(req.headers.get('Cookie'),null);
    if(url.searchParams.get('operation')==='save'){const form=new URLSearchParams(await req.text());assert.equal(form.get('instance_id'),'game-1');assert.equal(form.get('server_name'),'Saved from main site');}
    if(url.searchParams.get('operation')==='upload'){assert.equal(url.searchParams.get('filename'),'installer.zip');assert.equal(req.headers.get('Content-Type'),'application/octet-stream');assert.equal((await req.arrayBuffer()).byteLength,2*1024*1024);}
    return Response.json({ok:true},{headers:{'Set-Cookie':'node-session=private','X-Central-Token':'private'}});
  }}]}));
  try{
    const db=await mf.getD1Database('DB');for(const file of ['0001_control_plane.sql','0013_discord_avatar.sql','0007_blocked_users.sql','0008_node_gateways.sql']){const sql=await readFile('migrations/'+file,'utf8');for(const statement of sql.split(';').map(s=>s.trim()).filter(Boolean))await db.prepare(statement).run();}
    const now=Math.floor(Date.now()/1000);await db.prepare('INSERT INTO users(id,name,role,created) VALUES(?,?,?,?)').bind('123456789012345678','Admin','admin',now).run();await db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').bind(await digest('session'),'123456789012345678','csrf',now+600).run();await db.prepare('INSERT INTO nodes(id,name,token_hash,enabled) VALUES(?,?,?,1)').bind('node-1','Node','unused').run();
    const headers={Cookie:'__Host-farmservers=session',Origin:origin,'X-CSRF-Token':'csrf','Content-Type':'application/json'};
    const url=origin+'/api/manage?node=node-1&operation=save&instance_id=game-1&route=login';
    assert.equal((await mf.dispatchFetch(url,{method:'POST',headers:{Cookie:headers.Cookie},body:'{}'})).status,403);assert.equal(calls,0);
    const r=await mf.dispatchFetch(url,{method:'POST',headers,body:JSON.stringify({server_name:'Saved from main site',instance_id:'different'})});assert.equal(r.status,200);assert.equal(r.headers.get('Set-Cookie'),null);assert.equal(r.headers.get('X-Central-Token'),null);assert.equal(r.headers.get('Cache-Control'),'no-store');assert.equal(calls,1);
    const upload=await mf.dispatchFetch(origin+'/api/manage?node=node-1&operation=upload&target=installer&filename=installer.zip&offset=0&total_size=2097152&is_last=1',{method:'POST',headers:{...headers,'Content-Type':'application/octet-stream'},body:new Uint8Array(2*1024*1024)});assert.equal(upload.status,200);assert.equal(calls,2);
    await db.prepare('UPDATE nodes SET enabled=0').run();assert.equal((await mf.dispatchFetch(url,{method:'POST',headers,body:'{}'})).status,404);assert.equal(calls,2);
  }finally{await mf.dispose();}
});
