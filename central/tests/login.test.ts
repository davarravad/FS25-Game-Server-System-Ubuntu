import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {digest} from '../src/security';

test('site assets and fleet data require current admin or staff approval',async()=>{
  const origin='https://farmservers.sargentweb.com';
  const assetPaths:string[]=[];
  const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:'login-test',modules:true,scriptPath:'dist/index.js',compatibilityDate:'2026-09-09',compatibilityFlags:['nodejs_compat'],d1Databases:['DB'],bindings:{APP_ORIGIN:origin},serviceBindings:{ASSETS:async request=>{assetPaths.push(new URL(request.url).pathname);return new Response('PRIVATE ASSET');}}}]}));
  try {
    const db=await mf.getD1Database('DB');
    await db.exec(await readFile('migrations/0001_control_plane.sql','utf8'));
    await db.exec(await readFile('migrations/0013_discord_avatar.sql','utf8'));
    await db.exec(await readFile('migrations/0007_blocked_users.sql','utf8'));
    const time=Math.floor(Date.now()/1000);
    await db.prepare('INSERT INTO users(id,name,role,created) VALUES(?,?,?,?)').bind('user','Test','pending',time).run();
    await db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').bind(await digest('session'),'user','csrf',time+3600).run();
    const headers={Cookie:'__Host-farmservers=session'};
    for(const path of ['/','/index.html','/app.js','/setup.html','/nodes/node-1','/servers','/servers/node-1/game-1','/access','/setup','/install','/charts.js','/software.js','/node-distribution.txt','/central-setup.txt']){
      const response=await mf.dispatchFetch(origin+path);
      assert.match(await response.text(),/Sign in with Discord/);
      assert.equal(response.headers.get('Cache-Control'),'no-store');
    }
    for(const role of ['pending','viewer','operator','admin']){
      await db.prepare('UPDATE users SET role=?').bind(role).run();
      const approved=['viewer','operator','admin'].includes(role);
      const page=await mf.dispatchFetch(origin+'/setup.html',{headers,redirect:'manual'});
      assert.equal((await page.text()).includes('PRIVATE ASSET'),role==='admin');
      if(role==='operator'||role==='viewer')assert.equal(page.status,403);
      else assert.equal(page.headers.get('Cache-Control'),'no-store');
      assert.equal((await mf.dispatchFetch(origin+'/api/nodes',{headers})).status,approved?200:403);
      for(const path of ['/nodes/node-1','/servers/node-1/Game_1','/access','/setup','/install','/setup/','/install/','/setup.html','/users']){
        const response=await mf.dispatchFetch(origin+path,{headers,redirect:'manual'});const adminPage=['/setup','/install','/setup/','/install/','/setup.html','/users'].includes(path);const canOpen=approved&&(!adminPage||role==='admin')&&(role!=='operator'||path.startsWith('/servers/'));assert.equal((await response.text()).includes('PRIVATE ASSET'),canOpen);if(approved&&adminPage&&role!=='admin')assert.equal(response.status,403);else if(role==='operator'&&!canOpen)assert.equal(response.status,302);
        if(canOpen){assert.equal(assetPaths.at(-1),'/');assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'no-store');}
      }
    }
    await db.prepare('DELETE FROM sessions').run();
    assert.match(await (await mf.dispatchFetch(origin+'/',{headers})).text(),/Sign in with Discord/);
    // Fresh Ubuntu machines can still download the non-secret bootstrap.
    assert.equal(await (await mf.dispatchFetch(origin+'/install.py')).text(),'PRIVATE ASSET');
  } finally {await mf.dispose();}
});
