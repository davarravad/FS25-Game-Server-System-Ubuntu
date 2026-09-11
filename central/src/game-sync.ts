import {digest,readJson,validId} from './security';
type EnvLike={DB:D1Database;RELEASES:R2Bucket};
const now=()=>Math.floor(Date.now()/1000);
const json=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
const hash=/^[a-f0-9]{64}$/;
export function safeGamePath(value:unknown):value is string{
 return typeof value==='string'&&value.length<=512&&!/[\\\x00-\x1f:]/.test(value)&&!value.startsWith('/')&&value.split('/').every(p=>p!=='.'&&p!=='..'&&p!=='')&&!/^\d+(\/|$)|^start_fs25_|(^|\/)(savegame\d*|mods|\.env|game\.xml|dedicatedServer\.xml|log\.txt|cert\.pem|pk\.pem)(\/|$)/i.test(value);
}
export function validateManifest(body:any){
 if(!body||!/^\d+(\.\d+){2,3}$/.test(body.version)||!Array.isArray(body.files)||!body.files.length||body.files.length>20000)throw new Error('Invalid game manifest');
 const seen=new Set();let total=0,chunks=0;
 for(const f of body.files){
  if(!safeGamePath(f.path)||seen.has(f.path)||!Number.isSafeInteger(f.size)||f.size<0||f.size>100*1024**3||!Array.isArray(f.chunks)||f.chunks.length!==Math.ceil(f.size/(4*1024**2))||f.chunks.some((c:unknown)=>typeof c!=='string'||!hash.test(c)))throw new Error('Invalid game file');
  seen.add(f.path);total+=f.size;chunks+=f.chunks.length;
 }
 if(total>200*1024**3||chunks>100000||!seen.has('x64/FarmingSimulator2025Game.exe')||!seen.has('dedicatedServer.exe')||!seen.has('FarmingSimulator2025.exe')||!seen.has('VERSION'))throw new Error('Incomplete or oversized game installation');
 return total;
}
async function queue(env:EnvLike,node:string,kind:string,release:string|null){
 const t=now();await env.DB.prepare("INSERT OR IGNORE INTO game_jobs(id,node_id,kind,release_id,created,updated) SELECT ?,id,?,?,?,? FROM nodes WHERE id=? AND enabled=1").bind(crypto.randomUUID(),kind,release,t,t,node).run();
}
export async function gameNode(request:Request,env:EnvLike){
 const url=new URL(request.url),op=url.pathname.slice('/api/game-node/'.length),node=request.headers.get('X-Node-ID')||'',bearer=request.headers.get('Authorization')||'';
 if(!validId(node)||!/^Bearer [a-f0-9]{64}$/.test(bearer)||!await env.DB.prepare('SELECT id FROM nodes WHERE id=? AND token_hash=? AND enabled=1').bind(node,await digest(bearer.slice(7))).first())return json({error:'Unauthorized node'},401);
 if(op==='poll'&&request.method==='POST'){
  const b=await readJson(request);if(!['ready','empty','unknown','error'].includes(String(b.status))||typeof b.detail!=='string'||b.detail.length>500||b.version!==null&&(typeof b.version!=='string'||!/^\d+(\.\d+){2,3}$/.test(b.version))||b.fingerprint!==null&&(typeof b.fingerprint!=='string'||!hash.test(b.fingerprint)))return json({error:'Invalid inventory'},422);
  await env.DB.prepare('INSERT INTO game_inventory(node_id,version,fingerprint,status,detail,updated) VALUES(?,?,?,?,?,?) ON CONFLICT(node_id) DO UPDATE SET version=excluded.version,fingerprint=excluded.fingerprint,status=excluded.status,detail=excluded.detail,updated=excluded.updated').bind(node,b.version,b.fingerprint,b.status,b.detail,now()).run();
  const policy=await env.DB.prepare('SELECT * FROM game_policy WHERE id=1').first<any>();
  if(b.status==='empty'&&policy?.auto_bootstrap&&policy.release_id)await queue(env,node,'sync',policy.release_id);
  const job=await env.DB.prepare("SELECT * FROM game_jobs WHERE node_id=? AND status IN ('queued','running','waiting') ORDER BY created LIMIT 1").bind(node).first();if(job){const selections=(await env.DB.prepare('SELECT instance_id,packages FROM game_dlc_settings WHERE node_id=?').bind(node).all<any>()).results;const reported=await env.DB.prepare('SELECT snapshot FROM nodes WHERE id=?').bind(node).first<any>();(job as any).dlc_settings=(JSON.parse(reported?.snapshot||'{}')?.servers||[]).map((s:any)=>({instance:s.instance_id,packages:JSON.parse(selections.find(x=>x.instance_id===s.instance_id)?.packages||'[]')}));(job as any).dlcs=[...new Set(selections.flatMap(s=>JSON.parse(s.packages)))];}return json({job});
 }
 const jobId=url.searchParams.get('job')||'';
 const job=await env.DB.prepare("SELECT * FROM game_jobs WHERE id=? AND node_id=? AND status IN ('queued','running','waiting')").bind(jobId,node).first<any>();
 if(!job)return json({error:'Active job not found'},404);
 if(op==='progress'&&request.method==='POST'){
  const b=await readJson(request);if(!['running','waiting','failed','succeeded'].includes(String(b.status))||typeof b.detail!=='string'||b.detail.length>500||![b.done,b.total].every(v=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0&&v<=200*1024**3)||Number(b.done)>Number(b.total)||job.kind==='publish'&&b.status==='succeeded')return json({error:'Invalid progress'},422);
  await env.DB.prepare('UPDATE game_jobs SET status=?,detail=?,done_bytes=?,total_bytes=?,updated=? WHERE id=?').bind(b.status,b.detail,b.done,b.total,now(),jobId).run();return json({ok:true});
 }
 const chunk=url.searchParams.get('hash')||'';
 if(op==='chunk'&&job.kind==='publish'&&hash.test(chunk)&&request.method==='PUT'){
  const reader=request.body?.getReader();if(!reader)return json({error:'Missing chunk'},422);let size=0;const parts:Uint8Array[]=[];
  try{while(true){const r=await reader.read();if(r.done)break;size+=r.value.length;if(size>4*1024**2)return json({error:'Chunk too large'},413);parts.push(r.value);}}finally{await reader.cancel();}
  const bytes=new Uint8Array(size);let offset=0;for(const p of parts){bytes.set(p,offset);offset+=p.length;}
  const actual=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');if(actual!==chunk)return json({error:'Checksum mismatch'},422);
  await env.RELEASES.put('game-library/'+node+'/chunks/'+chunk,bytes);return json({ok:true});
 }
 if(op==='publish'&&job.kind==='publish'&&request.method==='POST'){
  const b=await readJson(request,8*1024**2);let size:number;try{size=validateManifest(b);}catch{return json({error:'Invalid game manifest'},422);}
  const raw=JSON.stringify(b),fingerprint=await digest(JSON.stringify({version:b.version,files:(b.files as any[]).filter(f=>!f.path.startsWith('__dlc__/'))})),key='game-library/'+node+'/manifests/'+await digest(raw);
  await env.RELEASES.put(key,raw);
  await env.DB.batch([env.DB.prepare('INSERT OR IGNORE INTO game_releases(id,source_node,version,fingerprint,manifest_key,bytes,dlcs,created) VALUES(?,?,?,?,?,?,?,?)').bind(jobId,node,b.version,fingerprint,key,size,JSON.stringify([...new Set((b.files as any[]).map(f=>/^__dlc__\/FarmingSimulator25_([^_]+)_/.exec(f.path)?.[1]).filter(Boolean))]),now()),env.DB.prepare("UPDATE game_jobs SET status='succeeded',done_bytes=?,total_bytes=?,detail='Game version published. Approve it on Game status.',updated=? WHERE id=?").bind(size,size,now(),jobId)]);return json({ok:true});
 }
 if(job.kind==='sync'&&request.method==='GET'){
  const release=await env.DB.prepare('SELECT * FROM game_releases WHERE id=?').bind(job.release_id).first<any>();if(!release)return json({error:'Release missing'},404);
  if(op==='manifest'){const object=await env.RELEASES.get(release.manifest_key);return object?new Response(object.body,{headers:{'Content-Type':'application/json','Cache-Control':'no-store'}}):json({error:'Manifest missing'},404);}
  if(op==='chunk'&&hash.test(chunk)){
   // Downloads are restricted to the assigned release's source namespace.
   const object=await env.RELEASES.get('game-library/'+release.source_node+'/chunks/'+chunk);return object?new Response(object.body,{headers:{'Content-Type':'application/octet-stream','Cache-Control':'no-store'}}):json({error:'Chunk missing'},404);
  }
 }
 return json({error:'Unknown game sync operation'},404);
}
export async function gameAdmin(request:Request,env:EnvLike){
 if(request.method==='GET')return json({nodes:(await env.DB.prepare('SELECT n.id,n.name,n.enabled,n.last_seen,n.snapshot,i.version,i.fingerprint,i.status,i.detail,i.updated FROM nodes n LEFT JOIN game_inventory i ON i.node_id=n.id ORDER BY n.name').all()).results,releases:(await env.DB.prepare('SELECT * FROM game_releases ORDER BY created DESC LIMIT 100').all()).results,jobs:(await env.DB.prepare('SELECT * FROM game_jobs ORDER BY created DESC LIMIT 100').all()).results,dlcSettings:(await env.DB.prepare('SELECT * FROM game_dlc_settings').all()).results,policy:await env.DB.prepare('SELECT * FROM game_policy WHERE id=1').first()});
 if(request.method!=='POST')return json({error:'Method not allowed'},405);
 const b=await readJson(request);
 if(b.action==='dlcs'&&validId(b.node)&&typeof b.instance==='string'&&Array.isArray(b.packages)&&b.packages.length<=100&&b.packages.every(p=>typeof p==='string'&&/^[A-Za-z0-9-]{1,100}$/.test(p))){
  const n=await env.DB.prepare('SELECT snapshot FROM nodes WHERE id=? AND enabled=1').bind(b.node).first<any>();if(!n||!JSON.parse(n.snapshot||'{}')?.servers?.some((s:any)=>s.instance_id===b.instance))return json({error:'Unknown server'},422);
  await env.DB.prepare('INSERT INTO game_dlc_settings(node_id,instance_id,packages) VALUES(?,?,?) ON CONFLICT(node_id,instance_id) DO UPDATE SET packages=excluded.packages').bind(b.node,b.instance,JSON.stringify([...new Set(b.packages)])).run();return json({ok:true});
 }
 if(b.action==='publish'&&validId(b.node)){await queue(env,b.node,'publish',null);return json({ok:true});}
 if(b.action==='approve'&&typeof b.release==='string'&&await env.DB.prepare('SELECT id FROM game_releases WHERE id=?').bind(b.release).first()){await env.DB.prepare('UPDATE game_policy SET release_id=? WHERE id=1').bind(b.release).run();return json({ok:true});}
 if(b.action==='bootstrap'&&typeof b.enabled==='boolean'){await env.DB.prepare('UPDATE game_policy SET auto_bootstrap=? WHERE id=1').bind(b.enabled?1:0).run();return json({ok:true});}
 if(b.action==='sync'){
  const policy=await env.DB.prepare('SELECT release_id FROM game_policy WHERE id=1').first<any>();if(!policy?.release_id)return json({error:'Approve a published version first'},409);
  const release=await env.DB.prepare('SELECT fingerprint,source_node FROM game_releases WHERE id=?').bind(policy.release_id).first<any>();
  const targets=await env.DB.prepare('SELECT n.id,i.fingerprint FROM nodes n LEFT JOIN game_inventory i ON i.node_id=n.id WHERE n.enabled=1').all<any>();
  for(const n of targets.results)if(b.node===n.id||b.node==='all'&&(n.id!==release.source_node||n.fingerprint!==release.fingerprint))await queue(env,n.id,'sync',policy.release_id);return json({ok:true});
 }
 return json({error:'Invalid game status action'},422);
}
