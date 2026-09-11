import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {digest} from '../src/security';

test('Discord membership starts pending; blocking revokes sessions and rejects subsequent logins',async()=>{
  const origin='https://farmservers.sargentweb.com',owner='513527870258151439',member='123456789012345678';
  const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:'membership',modules:true,scriptPath:'dist/index.js',compatibilityDate:'2026-09-09',compatibilityFlags:['nodejs_compat'],d1Databases:['DB'],bindings:{APP_ORIGIN:origin,BOOTSTRAP_ADMIN_ID:owner,DISCORD_CLIENT_SECRET:'test',DISCORD_CLIENT_ID:'test'},outboundService:async request=>new Response(JSON.stringify(new URL(request.url).pathname.endsWith('/token')?{access_token:'test'}:{id:member,username:'New member',avatar:'a'.repeat(32)}),{headers:{'Content-Type':'application/json'}})}]}));
  try{
    const db=await mf.getD1Database('DB');
    for(const file of ['0001_control_plane.sql','0013_discord_avatar.sql','0007_blocked_users.sql'])await db.exec(await readFile('migrations/'+file,'utf8'));
    const time=Math.floor(Date.now()/1000);
    await db.prepare('INSERT INTO users(id,name,role,created) VALUES(?,?,?,?)').bind(owner,'Owner','admin',time).run();
    await db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').bind(await digest('owner-session'),owner,'csrf',time+3600).run();
    const headers={Cookie:'__Host-farmservers=owner-session',Origin:origin,'X-CSRF-Token':'csrf','Content-Type':'application/json'};
    const login=async()=>{
      const start=await mf.dispatchFetch(origin+'/auth/login',{redirect:'manual'});
      const state=new URL(start.headers.get('Location')!).searchParams.get('state');
      return mf.dispatchFetch(origin+'/auth/callback?code=test&state='+state,{headers:{Cookie:'__Host-oauth='+state},redirect:'manual'});
    };
    let response=await login();assert.equal(response.status,302);
    const memberCookie=response.headers.getSetCookie().find(c=>c.startsWith('__Host-farmservers='))!.split(';')[0];
    assert.equal((await db.prepare('SELECT role FROM users WHERE id=?').bind(member).first<{role:string}>())?.role,'pending');
    assert.match(await (await mf.dispatchFetch(origin+'/',{headers:{Cookie:memberCookie}})).text(),/Membership pending/);
    assert.equal((await (await mf.dispatchFetch(origin+'/api/me',{headers:{Cookie:memberCookie}})).json() as {avatarUrl:string}).avatarUrl,'https://cdn.discordapp.com/avatars/'+member+'/'+'a'.repeat(32)+'.webp?size=64');
    const block=(id:string,blocked:boolean)=>mf.dispatchFetch(origin+'/api/users/block',{method:'POST',headers,body:JSON.stringify({id,blocked})});
    assert.equal((await block(owner,true)).status,409);
    assert.equal((await mf.dispatchFetch(origin+'/api/users/block',{method:'POST',headers:{Cookie:memberCookie},body:JSON.stringify({id:owner,blocked:true})})).status,403);
    assert.equal((await block(member,true)).status,200);
    assert.equal((await mf.dispatchFetch(origin+'/api/me',{headers:{Cookie:memberCookie}})).status,401);
    response=await login();assert.equal(response.status,403);assert.match(await response.text(),/blocked/);
    assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM sessions WHERE user_id=?').bind(member).first<{count:number}>())?.count,0);
    assert.equal((await block(member,false)).status,200);
    response=await login();assert.equal(response.status,302);
    assert.equal((await db.prepare('SELECT role FROM users WHERE id=?').bind(member).first<{role:string}>())?.role,'pending');
  }finally{await mf.dispose();}
});
