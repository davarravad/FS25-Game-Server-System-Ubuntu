import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {digest} from '../src/security';

test('site assets and fleet data require current admin or staff approval',async()=>{
  const origin='https://farmservers.sargentweb.com';
  const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:'login-test',modules:true,scriptPath:'dist/index.js',compatibilityDate:'2026-09-09',compatibilityFlags:['nodejs_compat'],d1Databases:['DB'],bindings:{APP_ORIGIN:origin},serviceBindings:{ASSETS:async()=>new Response('PRIVATE ASSET')}}]}));
  try {
    const db=await mf.getD1Database('DB');
    await db.exec(await readFile('migrations/0001_control_plane.sql','utf8'));
    const time=Math.floor(Date.now()/1000);
    await db.prepare('INSERT INTO users VALUES(?,?,?,?)').bind('user','Test','pending',time).run();
    await db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').bind(await digest('session'),'user','csrf',time+3600).run();
    const headers={Cookie:'__Host-farmservers=session'};
    for(const path of ['/','/index.html','/app.js','/setup.html','/node-distribution.txt','/central-setup.txt']){
      const response=await mf.dispatchFetch(origin+path);
      assert.match(await response.text(),/Sign in with Discord/);
      assert.equal(response.headers.get('Cache-Control'),'no-store');
    }
    for(const role of ['pending','viewer','operator','admin']){
      await db.prepare('UPDATE users SET role=?').bind(role).run();
      const approved=['operator','admin'].includes(role);
      const page=await mf.dispatchFetch(origin+'/setup.html',{headers});
      assert.equal((await page.text()).includes('PRIVATE ASSET'),approved);
      assert.equal(page.headers.get('Cache-Control'),'no-store');
      assert.equal((await mf.dispatchFetch(origin+'/api/nodes',{headers})).status,approved?200:403);
    }
    await db.prepare('DELETE FROM sessions').run();
    assert.match(await (await mf.dispatchFetch(origin+'/',{headers})).text(),/Sign in with Discord/);
    // Fresh Ubuntu machines can still download the non-secret bootstrap.
    assert.equal(await (await mf.dispatchFetch(origin+'/install.py')).text(),'PRIVATE ASSET');
  } finally {await mf.dispose();}
});
