import test from 'node:test';
import assert from 'node:assert/strict';
import {gameNode,gameAdmin,validateManifest,safeGamePath} from '../src/game-sync';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {readFile} from 'node:fs/promises';
import {digest} from '../src/security';
test('reject unsafe game manifests',()=>{
 for(const path of ['../x','a//b','a\\b','/x','a/../b','10823/settings','pk.pem','mods/foo'])assert.equal(safeGamePath(path),false,path);
 assert.throws(()=>validateManifest({version:'1.2.3',files:[{path:'x',size:1,chunks:[]}]}));
});
test('private game publication, approval, bootstrap and job ownership',async()=>{
 const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:'game-tests',modules:true,script:'export default {fetch(){return new Response("ok")}}',compatibilityDate:'2026-09-09',d1Databases:['DB'],r2Buckets:['RELEASES']}]}));
 try{
  const DB=await mf.getD1Database('DB'),RELEASES=await mf.getR2Bucket('RELEASES'),env={DB,RELEASES} as any;
  for(const file of ['0001_control_plane.sql','0015_game_sync.sql'])for(const sql of (await readFile('migrations/'+file,'utf8')).split(';').map(s=>s.trim()).filter(Boolean))await DB.prepare(sql).run();
  for(const id of ['source','target'])await DB.prepare('INSERT INTO nodes(id,name,token_hash,enabled) VALUES(?,?,?,1)').bind(id,id,await digest((id==='source'?'a':'b').repeat(64))).run();
  const admin=(b:any)=>gameAdmin(new Request('https://site/api/game-status',{method:'POST',body:JSON.stringify(b)}),env);
  const node=(id:string,op:string,b?:any,method=b===undefined?'GET':'POST')=>gameNode(new Request('https://site/api/game-node/'+op,{method,headers:{'X-Node-ID':id,Authorization:'Bearer '+(id==='source'?'a':'b').repeat(64)},body:b===undefined?undefined:b instanceof Uint8Array?b:JSON.stringify(b)}),env);
  assert.equal((await node('intruder','poll',{})).status,401);
  await admin({action:'publish',node:'source'});
  const pub:any=await (await node('source','poll',{status:'ready',version:'1.2.3.0',fingerprint:'c'.repeat(64),detail:'Ready'})).json();assert.equal(pub.job.kind,'publish');
  assert.equal((await node('target','progress?job='+pub.job.id,{})).status,404);
  const bytes=new TextEncoder().encode('binary'),hash=await digest('binary');
  assert.equal((await node('source','chunk?job='+pub.job.id+'&hash='+'d'.repeat(64),bytes,'PUT')).status,422);
  assert.equal((await node('source','chunk?job='+pub.job.id+'&hash='+hash,bytes,'PUT')).status,200);
  const manifest={version:'1.2.3.0',files:[{path:'x64/FarmingSimulator2025Game.exe',size:6,chunks:[hash]},{path:'dedicatedServer.exe',size:6,chunks:[hash]},{path:'FarmingSimulator2025.exe',size:6,chunks:[hash]},{path:'VERSION',size:6,chunks:[hash]}]};
  assert.equal((await node('source','publish?job='+pub.job.id,manifest)).status,200);
  assert.throws(()=>validateManifest({...manifest,files:[...manifest.files,manifest.files[0]]}));
  assert.equal((await admin({action:'approve',release:pub.job.id})).status,200);
  const empty={status:'empty',version:null,fingerprint:null,detail:'Empty'};
  const dest:any=await (await node('target','poll',empty)).json();assert.equal(dest.job.kind,'sync');
  assert.equal((await (await node('target','poll',empty)).json() as any).job.id,dest.job.id);
  assert.deepEqual(await (await node('target','manifest?job='+dest.job.id)).json(),manifest);
  assert.equal(await (await node('target','chunk?job='+dest.job.id+'&hash='+hash)).text(),'binary');
  assert.equal((await node('source','manifest?job='+dest.job.id)).status,404);
  for(const status of ['waiting','succeeded'])assert.equal((await node('target','progress?job='+dest.job.id,{status,done:12,total:12,detail:'Checked'})).status,200);
  assert.equal((await DB.prepare('SELECT status FROM game_jobs WHERE id=?').bind(dest.job.id).first<any>())?.status,'succeeded');
 }finally{await mf.dispose();}
});
