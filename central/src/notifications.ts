type Notice = {id:string;title:string;detail:string;href:string;severity:string;read?:boolean};
type TimedNotice = Notice & {ts:number};
export async function notifications(db:D1Database,userId:string,gameAdmin=false):Promise<Notice[]> {
  const time=Math.floor(Date.now()/1000), notices:TimedNotice[]=[];
  const nodes=(await db.prepare('SELECT id,name,last_seen,snapshot FROM nodes WHERE enabled=1').all<{id:string;name:string;last_seen:number|null;snapshot:string|null}>()).results;
  for(const node of nodes){
    const href='/nodes/'+node.id;
    if(!node.last_seen||time-node.last_seen>=120)notices.push({id:`offline:${node.id}:${node.last_seen||0}`,title:node.name+' is offline',detail:node.last_seen?'No heartbeat received in the last two minutes.':'This node has not connected yet.',href,severity:'warning',ts:time});
    if(node.snapshot&&node.last_seen&&time-node.last_seen<120){
      const snapshot=JSON.parse(node.snapshot);
      const host=snapshot.samples?.find((s:{scope:string})=>s.scope==='host')?.data;
      for(const server of snapshot.servers||[]){
        if(/error|fail|unhealthy|crash|restart/i.test(server.status||''))notices.push({id:`server:${node.id}:${server.instance_id}:${server.status}:${Math.floor(time/86400)}`,title:`${server.server_name}: ${server.status}`,detail:'Reported by '+node.name,href:'/servers/'+node.id+'/'+encodeURIComponent(server.instance_id),severity:'warning',ts:time});
      }
      for(const [key,label] of [['memory','RAM'],['disk','Disk']]){
        const used=host?.[key+'_used_bytes'],total=host?.[key+'_limit_bytes'];
        if(typeof used==='number'&&typeof total==='number'&&total>0&&used/total>=.9)notices.push({id:`capacity:${node.id}:${key}:${Math.floor(time/86400)}`,title:`${node.name}: ${label} almost full`,detail:`${(used/total*100).toFixed(1)}% used.`,href,severity:'warning',ts:time});
      }
    }
  }
  const jobs=(await db.prepare('SELECT u.*,n.name FROM node_updates u JOIN nodes n ON n.id=u.node_id WHERE u.updated>? ORDER BY u.updated DESC LIMIT 40').bind(time-7*86400).all<{id:string;node_id:string;name:string;version:string;status:string;updated:number}>()).results;
  for(const job of jobs)notices.push({id:`update:${job.id}:${job.status}`,title:`${job.name}: update ${job.status==='failed'?'failed or cancelled':job.status}`,detail:job.version,href:'/nodes/'+job.node_id+'#node-software',severity:job.status==='failed'?'warning':'info',ts:job.updated});
  const releases=(await db.prepare('SELECT version,created FROM releases WHERE enabled=1 AND created>? ORDER BY created DESC LIMIT 10').bind(time-7*86400).all<{version:string;created:number}>()).results;
  for(const release of releases)notices.push({id:'release:'+release.version,title:'Release available: '+release.version,detail:'Open a node to review its installed version and available update.',href:'/setup',severity:'info',ts:release.created});
  if(gameAdmin){
  const gamePolicy=await db.prepare('SELECT r.version,r.fingerprint FROM game_policy p LEFT JOIN game_releases r ON r.id=p.release_id WHERE p.id=1').first<{version:string;fingerprint:string}>();
  const gameNodes=(await db.prepare('SELECT i.*,n.name FROM game_inventory i JOIN nodes n ON n.id=i.node_id WHERE n.enabled=1').all<{node_id:string;version:string|null;fingerprint:string|null;status:string;name:string}>()).results;
  const newer=(a:string,b:string)=>{const x=a.split('.').map(Number),y=b.split('.').map(Number);for(let i=0;i<Math.max(x.length,y.length);i++){if((x[i]||0)!==(y[i]||0))return (x[i]||0)>(y[i]||0);}return false;};
  for(const n of gameNodes)if(n.status==='ready'&&n.version&&(!gamePolicy?.version||newer(n.version,gamePolicy.version)))notices.push({id:`game-version:${n.node_id}:${n.version}`,title:`${n.name}: game version ${n.version} detected`,detail:'Publish and approve this version on Game status to sync other nodes.',href:'/game-status',severity:'info',ts:time});
  const gameJobs=(await db.prepare("SELECT j.*,n.name FROM game_jobs j JOIN nodes n ON n.id=j.node_id WHERE j.updated>? AND j.status IN ('failed','succeeded','waiting') ORDER BY j.updated DESC LIMIT 40").bind(time-7*86400).all<{id:string;status:string;name:string;detail:string;updated:number}>()).results;
  for(const j of gameJobs)notices.push({id:`game-job:${j.id}:${j.status}`,title:`${j.name}: game sync ${j.status}`,detail:j.detail,href:'/game-status',severity:j.status==='failed'?'warning':'info',ts:j.updated});
  }
  const reads=new Set((await db.prepare('SELECT notification_id FROM notification_reads WHERE user_id=?').bind(userId).all<{notification_id:string}>()).results.map(r=>r.notification_id));
  return notices.sort((a,b)=>b.ts-a.ts).map(({ts,...n})=>({...n,read:reads.has(n.id)}));
}
