import {openToken,sealToken} from './node-tokens';
import {digest,randomToken,readJson,validId} from './security';
import {saveGateway} from './gateways';
import {oauthAccessToken,OAuthRefreshBusy} from './cloudflare-oauth';

type EnvCF={DB:D1Database;NODE_TOKEN_KEY:string;BOOTSTRAP_ADMIN_ID:string};
type Settings={account:string;zone:string;domain:string;token:string;oauth?:boolean};
type Connection={name:string;hostname:string;account:string;zone:string;port:number;revision:string;gatewayToken:string;tunnelId?:string;tunnelToken?:string;serviceId?:string;clientId?:string;clientSecret?:string;expires?:string;verificationAttempts?:number;appId?:string;consoleAppId?:string;consolePath?:string;tokenFailures?:number};
type Row={node_id:string;encrypted:string;stage:string;error:string|null;updated:number};
const json=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
const now=()=>Math.floor(Date.now()/1000);
class SetupError extends Error {}
export const accessAppsPath=(s:{oauth?:boolean;zone:string;account:string})=>(s.oauth?'/zones/'+s.zone:'/accounts/'+s.account)+'/access/apps';
async function cf<T>(s:Settings,path:string,method='GET',body?:unknown):Promise<T>{
  let response:Response;
  try{response=await fetch('https://api.cloudflare.com/client/v4'+path,{method,headers:{Authorization:'Bearer '+s.token,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),redirect:'manual',signal:AbortSignal.timeout(15000)});}
  catch{throw new SetupError('Cloudflare did not respond. Retry setup.');}
  let data:{success?:boolean;result:T;errors?:{code:number}[]};
  try{data=await response.json();}catch{throw new SetupError('Cloudflare returned an unexpected response.');}
  if(!response.ok || !data.success){
    const resource=path.includes('/workers/domains')?'Worker custom domains':path.includes('/access/apps')?'Access applications':path.includes('/access/service_tokens')?'Access service tokens':path.includes('/cfd_tunnel')?'Cloudflare tunnels':path.includes('/dns_records')?'DNS records':'zone settings';
    const hint=resource==='Worker custom domains'?' Grant Workers Scripts Write permission to the Cloudflare connection, then reconnect and retry.':resource==='Access applications'&&s.oauth?' Check the registered zone-access.read and zone-access.write scopes, then reconnect Cloudflare and retry setup.':' Check the API token permissions and account settings.';
    throw new SetupError('Cloudflare denied '+method+' for '+resource+' (HTTP '+response.status+', codes '+(data.errors||[]).map(e=>Number(e.code)).join(', ')+').'+hint);
  }
  return data.result;
}
async function list<T>(s:Settings,path:string):Promise<T[]>{
  const items:T[]=[];
  for(let page=1;page<=5;page++){
    const batch=await cf<T[]>(s,path+(path.includes('?')?'&':'?')+'per_page=50&page='+page);
    if(!Array.isArray(batch))throw new SetupError('Cloudflare returned an unexpected resource list.');
    items.push(...batch);if(batch.length<50)return items;
  }
  throw new SetupError('Cloudflare resource list is too large to reconcile safely.');
}
// Console WebSocket upgrades reach the node through a Worker subrequest, and Cloudflare Access
// never completes an upgrade on that path: the node answers 101 but the response is held until
// the idle timeout. Each node therefore gets a second, more specific Access application that
// bypasses Access for the console socket path only. The node still requires the gateway token
// there, so the path is not public. Access prefers the most specific path, so no ordering is needed.
// Access application paths are not prefix matches: the socket path always carries a signed ticket
// segment after /websockify, so the application must end in a wildcard to cover it.
export const consoleBypassPath='/central/view/*/vnc/websockify/*';
const legacyConsoleBypassPath='/central/view/*/vnc/websockify';
// Readiness probes the bypass with a well-formed but invalid ticket, exercising the real path shape.
export const consoleProbePath='/central/view/readiness-check/vnc/websockify/0.'+'0'.repeat(32)+'.'+'0'.repeat(64);
type AccessApp={id:string;name:string;domain:string};
async function ensureConsoleBypass(s:Settings,c:Connection,apps:AccessApp[]):Promise<string>{
  const domain=c.hostname+consoleBypassPath, name=c.name+'-console';
  const existing=apps.find(a=>a.domain===domain)||apps.find(a=>a.domain===c.hostname+legacyConsoleBypassPath);
  if(existing && existing.name!==name)throw new SetupError('This hostname already has an Access application for the console path. Remove the conflicting configuration in Cloudflare, then retry.');
  const body={name,domain,type:'self_hosted',session_duration:'24h',app_launcher_visible:false,policies:[{name,decision:'bypass',include:[{everyone:{}}]}]};
  const id=(await cf<{id:string}>(s,accessAppsPath(s)+(existing?'/'+existing.id:''),existing?'PUT':'POST',body)).id;
  c.consolePath=consoleBypassPath;
  return id;
}
const consoleBypassCurrent=(c:Connection)=>!!c.consoleAppId&&c.consolePath===consoleBypassPath;
export async function settings(env:EnvCF){
  const row=await env.DB.prepare('SELECT encrypted,enabled FROM cloudflare_settings WHERE id=1').first<{encrypted:string;enabled:number}>();
  return row?{value:JSON.parse(await openToken(env.NODE_TOKEN_KEY,'cloudflare-settings',row.encrypted)) as Settings,enabled:!!row.enabled}:null;
}
export async function provisionGameDomain(env:EnvCF,hostname:string){
  const saved=await settings(env);
  if(!saved)throw new SetupError('Connect Cloudflare in Settings before opening game panels. Include Workers Scripts Write permission.');
  const s=saved.value;if(s.oauth)s.token=await oauthAccessToken(env);
  if(!hostname.endsWith('.'+s.domain)||hostname.slice(0,-s.domain.length-1).includes('.'))throw new SetupError('Invalid game hostname');
  const path='/accounts/'+s.account+'/workers/domains';
  const domains=await list<{hostname:string;service:string}>(s,path);
  const existing=domains.find(d=>d.hostname===hostname);
  if(existing){
    if(existing.service!=='farmservers')throw new SetupError('This hostname belongs to another Worker. Existing routing was left unchanged.');
    return hostnameResolves(hostname);
  }
  const records=await list<{id:string}>(s,'/zones/'+s.zone+'/dns_records?name='+encodeURIComponent(hostname));
  if(records.length)throw new SetupError('This hostname already has a DNS record. Existing DNS was left unchanged.');
  try{await cf(s,path,'PUT',{hostname,service:'farmservers',zone_id:s.zone});}
  catch{throw new SetupError('Could not provision the game hostname. Grant the Cloudflare connection Workers Scripts Write permission, then retry.');}
  return hostnameResolves(hostname);
}
// Attaching a Worker custom domain makes Cloudflare publish proxied A and AAAA records for the
// hostname, but on a lag that can run to minutes, and the two can appear at different times. Those
// records are managed by the custom domain: the DNS records API does not list them and refuses to
// create them by hand (code 81062). So readiness is judged by real resolution over DNS-over-HTTPS,
// and both address families must answer. A resolver asked before publication caches NXDOMAIN for
// the zone's negative TTL (30 minutes), which is why a hostname is never handed to a browser early.
export async function hostnameResolves(hostname:string):Promise<boolean>{
  const answers=await Promise.all(([['A',1],['AAAA',28]] as const).map(async([type,code])=>{
    try{
      const response=await fetch('https://cloudflare-dns.com/dns-query?name='+encodeURIComponent(hostname)+'&type='+type,{headers:{accept:'application/dns-json'},signal:AbortSignal.timeout(10000)});
      const data=await response.json<{Status:number;Answer?:{type:number}[]}>();
      return data.Status===0&&!!data.Answer?.some(a=>a.type===code);
    }catch{return false;}
  }));
  return answers.every(Boolean);
}
// Readiness repair: (re)create the console bypass application for a node right now instead of
// waiting for its next connection poll. Refuses while a setup step holds the lease.
export async function repairConsoleBypass(env:EnvCF,nodeId:string):Promise<string>{
  const saved=await settings(env);
  if(!saved?.enabled)throw new SetupError('Cloudflare automation is not connected. Connect it on the Cloudflare page first.');
  const s=saved.value;if(s.oauth)s.token=await oauthAccessToken(env);
  const row=await env.DB.prepare('SELECT encrypted FROM node_connections WHERE node_id=? AND lease_until<?').bind(nodeId,now()).first<{encrypted:string}>();
  if(!row)throw new SetupError('This node has no automated connection record, or its setup is running right now. Use Retry setup on the Cloudflare page if it failed.');
  const c=JSON.parse(await openToken(env.NODE_TOKEN_KEY,'connection:'+nodeId,row.encrypted)) as Connection;
  if(!c.hostname||!c.name)throw new SetupError('The node connection has no gateway hostname yet; let setup finish first.');
  c.consoleAppId=await ensureConsoleBypass(s,c,await list<AccessApp>(s,accessAppsPath(s)));
  await env.DB.prepare('UPDATE node_connections SET encrypted=?,updated=? WHERE node_id=?').bind(await sealToken(env.NODE_TOKEN_KEY,'connection:'+nodeId,JSON.stringify(c)),now(),nodeId).run();
  return 'Console bypass application is in place for '+c.hostname+'. Run the check again to confirm the live probe.';
}
export async function cloudflareAdmin(request:Request,env:EnvCF){
  const path=new URL(request.url).pathname;
  try{
    if(path==='/api/cloudflare' && request.method==='GET'){
      const saved=await settings(env);
      const rows=await env.DB.prepare('SELECT n.id,n.name,n.enabled,c.stage,c.error,c.updated FROM nodes n LEFT JOIN node_connections c ON c.node_id=n.id ORDER BY n.name').all();
      return json({settings:saved?{account:saved.value.account,zone:saved.value.zone,domain:saved.value.domain,hasToken:!saved.value.oauth,oauth:!!saved.value.oauth,enabled:saved.enabled}:null,nodes:rows.results});
    }
    if(path==='/api/cloudflare' && request.method==='POST'){
      const body=await readJson(request,8192),saved=await settings(env);
      const s={account:body.account,zone:body.zone,domain:body.domain,token:body.token || saved?.value.token,oauth:!body.token && !!saved?.value.oauth} as Settings;
      if(!/^[a-f0-9]{32}$/.test(s.account)||!/^[a-f0-9]{32}$/.test(s.zone)||s.domain!=='sargentweb.com'||typeof s.token!=='string'||(!s.oauth&&!s.token.length)||s.token.length>2048||/[\s]/.test(s.token)||typeof body.enabled!=='boolean')return json({error:'Enter valid account and zone IDs, sargentweb.com as the domain, and an API token.'},422);
      if(saved && (saved.value.account!==s.account || saved.value.zone!==s.zone) && (await env.DB.prepare('SELECT node_id FROM node_connections LIMIT 1').first()))return json({error:'Existing automated nodes belong to the saved account and zone. Migrate those resources before changing accounts.'},409);
      if(body.enabled){
        if(s.oauth)s.token=await oauthAccessToken(env);
        const zone=await cf<{name:string;account:{id:string}}>(s,'/zones/'+s.zone);
        if(zone.name!==s.domain || zone.account.id!==s.account)return json({error:'The zone must match the domain and account.'},422);
        for(const path of ['/accounts/'+s.account+'/cfd_tunnel?per_page=1',accessAppsPath(s)+'?per_page=1','/accounts/'+s.account+'/access/service_tokens?per_page=1','/zones/'+s.zone+'/dns_records?per_page=1'])await cf(s,path);
      }
      if(s.oauth)s.token='';
      await env.DB.prepare('INSERT INTO cloudflare_settings(id,encrypted,enabled) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET encrypted=excluded.encrypted,enabled=excluded.enabled').bind(await sealToken(env.NODE_TOKEN_KEY,'cloudflare-settings',JSON.stringify(s)),body.enabled?1:0).run();
      return json({ok:true});
    }
    if(path==='/api/cloudflare/retry' && request.method==='POST'){
      const body=await readJson(request,4096);if(!validId(body.id))return json({error:'Invalid node'},422);
      // Only a failed setup is retried: rotating the revision of a healthy node would make it
      // recreate its connector and web container, dropping the tunnel for nothing.
      const existing=await env.DB.prepare('SELECT encrypted FROM node_connections WHERE node_id=? AND lease_until<? AND error IS NOT NULL').bind(body.id,now()).first<{encrypted:string}>();
      if(!existing)return json({error:'No failed setup exists, or setup is currently running.'},409);
      const c=JSON.parse(await openToken(env.NODE_TOKEN_KEY,'connection:'+body.id,existing.encrypted)) as Connection;c.revision=crypto.randomUUID();c.verificationAttempts=0;
      const row=await env.DB.prepare('UPDATE node_connections SET error=NULL,encrypted=? WHERE node_id=? AND lease_until<? RETURNING node_id').bind(await sealToken(env.NODE_TOKEN_KEY,'connection:'+body.id,JSON.stringify(c)),body.id,now()).first();
      return row?json({ok:true}):json({error:'No failed setup exists, or setup is currently running.'},409);
    }
    return json({error:'Not found'},404);
  }catch(e){return json({error:e instanceof SetupError?e.message:'Cloudflare settings could not be opened or saved. Check the database migration and NODE_TOKEN_KEY.'},503);}
}

const credentialRenewalDue=(c:Connection)=>!c.expires || Date.parse(c.expires)<Date.now()+30*86400000;
// One recoverable step per authenticated node poll; leases prevent overlapping API mutations.
async function step(env:EnvCF,s:Settings,c:Connection,stage:string):Promise<string>{
  const base='/accounts/'+c.account;
  if(stage==='tunnel'){
    const matches=await list<{id:string;name:string}>(s,base+'/cfd_tunnel?is_deleted=false&name='+encodeURIComponent(c.name));
    c.tunnelId=matches.find(t=>t.name===c.name)?.id || (await cf<{id:string}>(s,base+'/cfd_tunnel','POST',{name:c.name,config_src:'cloudflare'})).id;
    return 'credentials';
  }
  if(stage==='credentials'){
    const tokens=await list<{id:string;name:string}>(s,base+'/access/service_tokens');
    const existing=tokens.find(t=>t.name===c.name);
    // Recover an interrupted create without rotating any token belonging to another deployment.
    const token=existing?await cf<{id:string;client_id:string;client_secret:string;expires_at:string}>(s,base+'/access/service_tokens/'+existing.id+'/rotate','POST'):await cf<{id:string;client_id:string;client_secret:string;expires_at:string}>(s,base+'/access/service_tokens','POST',{name:c.name,duration:'8760h'});
    c.serviceId=token.id;c.clientId=token.client_id;c.clientSecret=token.client_secret;c.expires=token.expires_at;
    if(!c.serviceId||!c.clientId||!c.clientSecret)throw new SetupError('Cloudflare did not return the new service credentials. Retry setup.');
    return 'access';
  }
  if(stage==='access'){
    const apps=await list<{id:string;name:string;domain:string}>(s,accessAppsPath(s));
    const existing=apps.find(a=>a.domain===c.hostname);
    if(existing && existing.name!==c.name)throw new SetupError('This hostname already has an Access application. Choose a new node ID or remove the conflicting configuration in Cloudflare.');
    const body={name:c.name,domain:c.hostname,type:'self_hosted',session_duration:'24h',app_launcher_visible:false,service_auth_401_redirect:true,policies:[{name:c.name,decision:'non_identity',include:[{service_token:{token_id:c.serviceId}}]}]};
    c.appId=(await cf<{id:string}>(s,accessAppsPath(s)+(existing?'/'+existing.id:''),existing?'PUT':'POST',body)).id;
    c.consoleAppId=await ensureConsoleBypass(s,c,apps);
    return 'route';
  }
  if(stage==='route'){
    await cf(s,base+'/cfd_tunnel/'+c.tunnelId+'/configurations','PUT',{config:{ingress:[{hostname:c.hostname,service:'http://127.0.0.1:'+c.port},{service:'http_status:404'}]}});
    return 'dns';
  }
  if(stage==='dns'){
    const records=await list<{id:string;type:string;content:string;proxied:boolean}>(s,'/zones/'+c.zone+'/dns_records?name='+encodeURIComponent(c.hostname));
    const target=c.tunnelId+'.cfargotunnel.com';
    if(records.length && !records.every(r=>r.type==='CNAME' && r.content===target && r.proxied))throw new SetupError('This hostname already has a different DNS record. Existing DNS was left unchanged. Resolve the conflict in Cloudflare, then retry.');
    if(!records.length)await cf(s,'/zones/'+c.zone+'/dns_records','POST',{type:'CNAME',name:c.hostname,content:target,proxied:true,ttl:1});
    return 'connector';
  }
  if(stage==='connector'){
    c.tunnelToken=await cf<string>(s,base+'/cfd_tunnel/'+c.tunnelId+'/token');
    if(typeof c.tunnelToken!=='string'||!c.tunnelToken.length)throw new SetupError('Cloudflare did not return a tunnel token.');
    return 'installing';
  }
  // Nodes provisioned before the console bypass existed, or with its previous path, are brought
  // up to date on their next poll.
  if(stage==='ready' && !consoleBypassCurrent(c))c.consoleAppId=await ensureConsoleBypass(s,c,await list<AccessApp>(s,accessAppsPath(s)));
  if(stage==='ready' && credentialRenewalDue(c)){
    const renewed=await cf<{expires_at:string}>(s,base+'/access/service_tokens/'+c.serviceId+'/refresh','POST');
    if(!renewed.expires_at || !Number.isFinite(Date.parse(renewed.expires_at)))throw new SetupError('Cloudflare did not return the renewed credential expiry.');
    c.expires=renewed.expires_at;
  }
  return stage;
}
export async function nodeConnection(request:Request,env:EnvCF){
  if(request.method!=='POST')return json({error:'Method not allowed'},405);
  const id=request.headers.get('X-Node-ID')||'',bearer=request.headers.get('Authorization')||'';
  if(!validId(id)||!/^Bearer [a-f0-9]{64}$/.test(bearer)||!await env.DB.prepare('SELECT id FROM nodes WHERE id=? AND token_hash=? AND enabled=1').bind(id,await digest(bearer.slice(7))).first())return json({error:'Unauthorized node'},401);
  const body=await readJson(request,8192);
  if(!Number.isInteger(body.port)||Number(body.port)<1||Number(body.port)>65535)return json({error:'Invalid panel port'},422);
  const configured=await settings(env);
  if(!configured?.enabled)return json({connection:null});
  let row=await env.DB.prepare('SELECT * FROM node_connections WHERE node_id=?').bind(id).first<Row>();
  if(!row){
    const hostname='origin-'+(id.length<=56?id:id.slice(0,40)+'-'+(await digest(id)).slice(0,8))+'.'+configured.value.domain;
    const c:Connection={name:'farmservers-'+id+'-'+crypto.randomUUID().slice(0,8),hostname,account:configured.value.account,zone:configured.value.zone,port:Number(body.port),revision:crypto.randomUUID(),gatewayToken:randomToken()};
    await env.DB.prepare('INSERT OR IGNORE INTO node_connections(node_id,encrypted,updated) VALUES(?,?,?)').bind(id,await sealToken(env.NODE_TOKEN_KEY,'connection:'+id,JSON.stringify(c)),now()).run();
    row=await env.DB.prepare('SELECT * FROM node_connections WHERE node_id=?').bind(id).first<Row>();
  }
  if(!row || row.error)return json({connection:null});
  const lease=crypto.randomUUID();
  const claimed=await env.DB.prepare('UPDATE node_connections SET lease=?,lease_until=? WHERE node_id=? AND lease_until<? RETURNING node_id').bind(lease,now()+180,id,now()).first();
  if(!claimed)return json({connection:null});
  try{
    // Re-read after claiming so another poll's completed step cannot be replayed from a stale row.
    row=(await env.DB.prepare('SELECT * FROM node_connections WHERE node_id=?').bind(id).first<Row>())!;
    if(row.error)return json({connection:null});
    const c=JSON.parse(await openToken(env.NODE_TOKEN_KEY,'connection:'+id,row.encrypted)) as Connection;
    let stage=row.stage;
    if(body.revision===c.revision && body.status==='failed')throw new SetupError('Node connector setup failed. Check the node updater logs, then retry.');
    if(['installing','verifying'].includes(stage) && body.revision===c.revision && body.status==='applied'){
      stage='verifying';let healthy=false,detail='The request did not complete (DNS, TLS or connection timeout).';
      try{
        const response=await fetch('https://'+c.hostname+'/?route=api_central_health',{headers:{'X-Central-Token':c.gatewayToken,'X-Central-User':env.BOOTSTRAP_ADMIN_ID,'X-Central-Role':'operator','CF-Access-Client-Id':c.clientId!,'CF-Access-Client-Secret':c.clientSecret!},redirect:'manual',signal:AbortSignal.timeout(15000)});
        const isJson=!!response.headers.get('Content-Type')?.includes('application/json');
        detail='HTTP '+response.status+' ('+(isJson?'JSON':'non-JSON')+'). '+([401,403].includes(response.status)?'Authentication was rejected by Cloudflare Access or the node gateway.':response.status>=500?'Check tunnel connectivity and the local origin service.':response.status>=300&&response.status<400?'The health request was redirected; check the Access service-token policy.':'The endpoint did not return the expected node identity.');
        if(!isJson){const text=(await response.text()).slice(0,32768);const code=text.match(/(?:error\s*(?:code\s*)?[: ]*|<span[^>]*>)(10[0-9]{2})/i)?.[1];if(code)detail+=' Cloudflare error '+code+'.';}
        if(response.ok&&isJson){const body=await response.json<{node:string}>();healthy=body.node===id;if(!healthy)detail='HTTP '+response.status+': node identity does not match the enrolled node.';}
      }catch{ /* Allow time for DNS and Access propagation before requiring intervention. */ }
      if(healthy){
        await saveGateway(env,id,{origin:'https://'+c.hostname,token:c.gatewayToken,accessClientId:c.clientId!,accessClientSecret:c.clientSecret!});stage='ready';c.verificationAttempts=0;
      }else{
        c.verificationAttempts=(c.verificationAttempts||0)+1;
        if(c.verificationAttempts>=10)throw new SetupError('Protected node health check failed. '+detail);
      }
    }else {
      // A ready node only needs the Cloudflare API for occasional maintenance, so its polls do
      // not fetch an access token at all; and a transient token failure is retried on later polls
      // instead of parking the node in an error state that needs a manual retry.
      const needsApi=stage!=='ready'||!consoleBypassCurrent(c)||credentialRenewalDue(c);
      let authorized=true;
      if(needsApi&&configured.value.oauth){
        try{configured.value.token=await oauthAccessToken(env);c.tokenFailures=0;}
        catch(e){
          if(e instanceof OAuthRefreshBusy)throw e;
          c.tokenFailures=(c.tokenFailures||0)+1;
          if(c.tokenFailures>=3)throw new SetupError('Cloudflare authorization needs attention. Reconnect with Cloudflare, then retry setup.');
          authorized=false;
        }
      }
      if(authorized)stage=await step(env,configured.value,c,stage);
    }
    await env.DB.prepare('UPDATE node_connections SET encrypted=?,stage=?,updated=? WHERE node_id=? AND lease=?').bind(await sealToken(env.NODE_TOKEN_KEY,'connection:'+id,JSON.stringify(c)),stage,now(),id,lease).run();
    return json({connection:['installing','verifying','ready'].includes(stage)?{revision:c.revision,gatewayToken:c.gatewayToken,tunnelToken:c.tunnelToken}:null});
  }catch(e){
    if(e instanceof OAuthRefreshBusy)return json({connection:null});
    await env.DB.prepare('UPDATE node_connections SET error=?,updated=? WHERE node_id=? AND lease=?').bind(e instanceof SetupError?e.message:'Setup could not complete. Check connectivity and the encryption key, then retry.',now(),id,lease).run();
    return json({connection:null});
  }finally{await env.DB.prepare('UPDATE node_connections SET lease=NULL,lease_until=0 WHERE node_id=? AND lease=?').bind(id,lease).run();}
}
