import test from 'node:test';
import assert from 'node:assert/strict';
import {gameNode,gameAdmin} from '../src/game-sync';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {readFile} from 'node:fs/promises';
import {digest} from '../src/security';

// One click on a new node: download the approved/newest library version, or have a ready node publish first.
test('Download game files copies from the library or publishes from a ready node first',async()=>{
  const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:'game-install',modules:true,script:'export default {fetch(){return new Response("ok")}}',compatibilityDate:'2026-09-09',d1Databases:['DB'],r2Buckets:['RELEASES']}]}));
  try{
    const DB=await mf.getD1Database('DB'),RELEASES=await mf.getR2Bucket('RELEASES'),env={DB,RELEASES} as any;
    for(const file of ['0001_control_plane.sql','0015_game_sync.sql','0020_game_wanted.sql'])for(const sql of (await readFile('migrations/'+file,'utf8')).split(';').map(s=>s.trim()).filter(Boolean))await DB.prepare(sql).run();
    const time=Math.floor(Date.now()/1000),token=(id:string)=>(id==='source'?'a':'b').repeat(64);
    for(const id of ['source','target'])await DB.prepare('INSERT INTO nodes(id,name,token_hash,enabled,last_seen) VALUES(?,?,?,1,?)').bind(id,id,await digest(token(id)),time).run();
    const admin=async(b:any)=>{const response=await gameAdmin(new Request('https://site/api/game-status',{method:'POST',body:JSON.stringify(b)}),env);return {status:response.status,body:await response.json() as any};};
    const node=(id:string,op:string,b?:any,method=b===undefined?'GET':'POST')=>gameNode(new Request('https://site/api/game-node/'+op,{method,headers:{'X-Node-ID':id,Authorization:'Bearer '+token(id)},body:b===undefined?undefined:b instanceof Uint8Array?b:JSON.stringify(b)}),env);

    // No node has the game: nothing to copy.
    assert.equal((await admin({action:'install',node:'target'})).status,409);
    assert.equal((await admin({action:'install',node:'missing'})).status,404);

    // The source reports a complete installation, so the click asks it to publish and queues the target to wait.
    await node('source','poll',{status:'ready',version:'1.2.3.0',fingerprint:'c'.repeat(64),detail:'Ready'});
    // Publishing finished earlier would normally have a job; here the click creates it.
    const first=await admin({action:'install',node:'target'});
    assert.equal(first.status,200);assert.equal(first.body.mode,'publish');
    assert.deepEqual((await (await gameAdmin(new Request('https://site/api/game-status'),env)).json() as any).wanted,['target']);
    const publish:any=await (await node('source','poll',{status:'ready',version:'1.2.3.0',fingerprint:'c'.repeat(64),detail:'Ready'})).json();assert.equal(publish.job.kind,'publish');
    const bytes=new TextEncoder().encode('binary'),hash=await digest('binary');
    assert.equal((await node('source','chunk?job='+publish.job.id+'&hash='+hash,bytes,'PUT')).status,200);
    const files=['x64/FarmingSimulator2025Game.exe','dedicatedServer.exe','FarmingSimulator2025.exe','VERSION'].map(path=>({path,size:6,chunks:[hash]}));
    assert.equal((await node('source','publish?job='+publish.job.id,{version:'1.2.3.0',files})).status,200);

    // Publishing approved the version and started the waiting node's download without another click.
    assert.equal((await DB.prepare('SELECT release_id FROM game_policy WHERE id=1').first<any>())?.release_id,publish.job.id);
    const sync=await DB.prepare("SELECT kind,release_id FROM game_jobs WHERE node_id='target' AND status='queued'").first<any>();
    assert.equal(sync?.kind,'sync');assert.equal(sync?.release_id,publish.job.id);
    assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM game_wanted').first<any>())?.n,0);

    // With a version in the library the click goes straight to a download.
    await DB.prepare("DELETE FROM game_jobs WHERE node_id='target'").run();
    const second=await admin({action:'install',node:'target'});
    assert.equal(second.status,200);assert.equal(second.body.mode,'download');
    assert.equal((await DB.prepare("SELECT kind FROM game_jobs WHERE node_id='target' AND status='queued'").first<any>())?.kind,'sync');
  }finally{await mf.dispose();}
});
