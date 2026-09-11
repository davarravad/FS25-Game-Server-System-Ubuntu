import {digest, readJson, validId} from './security';

export const validVersion = (v: unknown): v is string => typeof v === 'string' && /^v\d{1,6}\.\d{1,6}\.\d{1,6}$/.test(v);
export type ReleaseEnv = Env & { RELEASE_PUBLIC_KEY: string };
const json = (value: unknown, status = 200) => Response.json(value,{status,headers:{'Cache-Control':'no-store'}});
const time = () => Math.floor(Date.now()/1000);
export const compareVersions=(a:string,b:string)=>{const x=a.slice(1).split('.').map(Number),y=b.slice(1).split('.').map(Number);return x[0]-y[0]||x[1]-y[1]||x[2]-y[2];};
const bytes = (s: string) => Uint8Array.from(atob(s),c=>c.charCodeAt(0));
export async function verifyManifest(manifest: string, signature: string, key: string) {
  const parsed = JSON.parse(manifest);
  if (!validVersion(parsed.version) || !/^[a-f0-9]{64}$/.test(parsed.sha256) || !Number.isInteger(parsed.size) || parsed.size < 1 || parsed.size > 12*1024*1024) throw new Error('Invalid manifest');
  const publicKey = await crypto.subtle.importKey('spki',bytes(key),{name:'Ed25519'},false,['verify']);
  if (!await crypto.subtle.verify('Ed25519',publicKey,bytes(signature),new TextEncoder().encode(manifest))) throw new Error('Invalid release signature');
  return parsed as {version:string;sha256:string;size:number};
}
export async function distribution(request: Request, env: ReleaseEnv, admin: boolean) {
  const url = new URL(request.url), path=url.pathname;
  if (path === '/api/distribution/key' && request.method === 'GET') return json({key:env.RELEASE_PUBLIC_KEY});
  let node = '';
  if (!admin) {
    node = request.headers.get('X-Node-ID') || '';
    const token = request.headers.get('Authorization') || '';
    if (!validId(node) || !/^Bearer [a-f0-9]{64}$/.test(token) || !await env.DB.prepare('SELECT id FROM nodes WHERE id=? AND token_hash=? AND enabled=1').bind(node,await digest(token.slice(7))).first()) return json({error:'Unauthorized node'},401);
  }
  if (path === '/api/distribution/releases' && request.method === 'GET') return json((await env.DB.prepare('SELECT version,created FROM releases WHERE enabled=1 ORDER BY created DESC').all()).results);
  const match = path.match(/^\/api\/distribution\/releases\/(v\d+\.\d+\.\d+)(\/archive)?$/);
  if (match && request.method === 'GET') {
    const release = await env.DB.prepare('SELECT * FROM releases WHERE version=? AND enabled=1').bind(match[1]).first<{manifest:string;signature:string;object_key:string}>();
    if (!release) return json({error:'Release not found'},404);
    if (!match[2]) return json({manifest:release.manifest,signature:release.signature});
    const object=await env.RELEASES.get(release.object_key);
    return object ? new Response(object.body,{headers:{'Content-Type':'application/gzip','Cache-Control':'no-store'}}) : json({error:'Archive unavailable'},503);
  }
  if (admin && path === '/api/distribution/releases' && request.method === 'POST') {
    const body=await readJson(request,18*1024*1024);
    if (typeof body.manifest !== 'string' || body.manifest.length>4096 || typeof body.signature !== 'string' || typeof body.archive !== 'string') return json({error:'Invalid release package'},422);
    let manifest;
    try { manifest=await verifyManifest(body.manifest,body.signature,env.RELEASE_PUBLIC_KEY); } catch { return json({error:'Invalid release manifest or signature'},422); }
    const archive=bytes(body.archive);
    const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',archive)),b=>b.toString(16).padStart(2,'0')).join('');
    if (archive.length!==manifest.size || hash!==manifest.sha256) return json({error:'Archive checksum mismatch'},422);
    const key='sha256/'+hash;
    await env.RELEASES.put(key,archive);
    const inserted=await env.DB.prepare('INSERT OR IGNORE INTO releases(version,manifest,signature,object_key,created) VALUES(?,?,?,?,?)').bind(manifest.version,body.manifest,body.signature,key,time()).run();
    return inserted.meta.changes ? json({ok:true,version:manifest.version}) : json({error:'Version already published; choose a new version'},409);
  }
  if (admin && path === '/api/distribution/withdraw' && request.method === 'POST') {
    const body=await readJson(request,4096);
    if (!validVersion(body.version)) return json({error:'Invalid version'},422);
    await env.DB.batch([
      env.DB.prepare('UPDATE releases SET enabled=0 WHERE version=?').bind(body.version),
      env.DB.prepare("UPDATE node_updates SET status='failed',updated=? WHERE version=? AND status='queued'").bind(time(),body.version)
    ]);
    return json({ok:true,version:body.version});
  }
  if (admin && path === '/api/distribution/updates' && request.method === 'GET') {
    let cursor:{created:number;id:string}|null=null;
    try{if(url.searchParams.has('cursor')){cursor=JSON.parse(url.searchParams.get('cursor')!);if(!cursor||!Number.isSafeInteger(cursor.created)||cursor.created<0||typeof cursor.id!=='string'||cursor.id.length>128)throw new Error();}}
    catch{return json({error:'Invalid update history cursor'},422);}
    const rows=(await env.DB.prepare('SELECT u.*,n.name AS node_name FROM node_updates u LEFT JOIN nodes n ON n.id=u.node_id '+(cursor?'WHERE u.created<? OR (u.created=? AND u.id<?) ':'')+'ORDER BY u.created DESC,u.id DESC LIMIT 26').bind(...(cursor?[cursor.created,cursor.created,cursor.id]:[])).all<{id:string;created:number}>()).results;
    const jobs=rows.slice(0,25),last=jobs.at(-1);
    return json({jobs,nextCursor:rows.length>25&&last?JSON.stringify({created:last.created,id:last.id}):null});
  }
  if (admin && path === '/api/distribution/update-all' && request.method === 'POST') {
    const body=await readJson(request,4096);
    const releases=(await env.DB.prepare('SELECT version FROM releases WHERE enabled=1').all<{version:string}>()).results.sort((a,b)=>compareVersions(b.version,a.version));
    const latest=releases[0]?.version;
    if(!latest)return json({error:'No published release is available'},409);
    if(body.version!==latest)return json({error:'The latest release changed. Refresh and try again.'},409);
    const fleet=(await env.DB.prepare("SELECT n.id,n.installed_version,COALESCE(n.installed_version,(SELECT version FROM node_updates WHERE node_id=n.id AND status='succeeded' ORDER BY updated DESC,id DESC LIMIT 1)) AS current_version FROM nodes n WHERE enabled=1 AND NOT EXISTS(SELECT 1 FROM node_updates WHERE node_id=n.id AND status IN ('queued','running'))").all<{id:string;installed_version:string|null;current_version:string|null}>()).results;
    const candidates=fleet.filter(n=>!n.current_version||!validVersion(n.current_version)||compareVersions(n.current_version,latest)<0);
    let queued=0;
    // Recheck access, release availability, installed version and active jobs at insertion time.
    for(let start=0;start<candidates.length;start+=50){
      const results=await env.DB.batch(candidates.slice(start,start+50).map(n=>env.DB.prepare("INSERT OR IGNORE INTO node_updates SELECT ?,n.id,r.version,'queued',?,? FROM nodes n,releases r WHERE n.id=? AND n.enabled=1 AND n.installed_version IS ? AND r.version=? AND r.enabled=1 AND NOT EXISTS(SELECT 1 FROM node_updates WHERE node_id=n.id AND status IN ('queued','running'))").bind(crypto.randomUUID(),time(),time(),n.id,n.installed_version,latest)));
      queued+=results.reduce((sum,r)=>sum+r.meta.changes,0);
    }
    return json({ok:true,version:latest,queued});
  }
  if (admin && path === '/api/distribution/updates' && request.method === 'POST') {
    const body=await readJson(request,4096);
    if (!validId(body.node) || !validVersion(body.version)) return json({error:'Invalid node or release'},422);
    const id=crypto.randomUUID();
    const inserted=await env.DB.prepare("INSERT OR IGNORE INTO node_updates SELECT ?,n.id,r.version,'queued',?,? FROM nodes n,releases r WHERE n.id=? AND n.enabled=1 AND r.version=? AND r.enabled=1").bind(id,time(),time(),body.node,body.version).run();
    return inserted.meta.changes ? json({ok:true,id,node:body.node,version:body.version}) : json({error:'Node disabled, release missing, or update already active'},409);
  }
  if (admin && path === '/api/distribution/cancel' && request.method === 'POST') {
    const body=await readJson(request,4096);
    const result=await env.DB.prepare("UPDATE node_updates SET status='failed',updated=? WHERE id=? AND status='queued'").bind(time(),String(body.id)).run();
    return json({ok:!!result.meta.changes});
  }
  if (!admin && path === '/api/distribution/poll' && request.method === 'POST') {
    const body=await readJson(request,4096);
    if (body.installed_version !== undefined) {
      if (!validVersion(body.installed_version)) return json({error:'Invalid installed version'},422);
      await env.DB.prepare('UPDATE nodes SET installed_version=? WHERE id=?').bind(body.installed_version,node).run();
    }
    await env.DB.prepare("UPDATE node_updates SET status='running',updated=? WHERE node_id=? AND status='queued'").bind(time(),node).run();
    return json({job:await env.DB.prepare("SELECT id,version FROM node_updates WHERE node_id=? AND status='running'").bind(node).first()});
  }
  if (!admin && path === '/api/distribution/result' && request.method === 'POST') {
    const body=await readJson(request,4096);
    if (!['succeeded','failed'].includes(String(body.status))) return json({error:'Invalid status'},422);
    const completed=await env.DB.prepare("UPDATE node_updates SET status=?,updated=? WHERE id=? AND node_id=? AND status='running' RETURNING version").bind(body.status,time(),String(body.id),node).first<{version:string}>();
    if (body.status==='succeeded' && completed) await env.DB.prepare('UPDATE nodes SET installed_version=? WHERE id=?').bind(completed.version,node).run();
    return json({ok:true});
  }
  return json({error:'Not found'},404);
}
