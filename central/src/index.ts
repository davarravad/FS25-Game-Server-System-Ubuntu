import {allowed, cookie, cookieValue, digest, hmacHex, publicIPv4, randomToken, readJson, roles, safeMetrics, validId, validScope, type Role} from './security';
import {gameUrl, rewriteGameHtml} from './game-proxy';
import {distribution} from './releases';
import {loginPage} from './login';
import {sealToken, openToken} from './node-tokens';
import {notifications} from './notifications';
import {cloudflareAdmin,nodeConnection,provisionGameDomain,repairConsoleBypass} from './cloudflare';
import {cloudflareOAuth} from './cloudflare-oauth';
import {readGateway, saveGateway, validGateway, type Gateway} from './gateways';
import {management} from './management';
import {gameNode,gameAdmin} from './game-sync';
import {fleetReadiness} from './readiness';

type Bindings = Env & { DISCORD_CLIENT_SECRET: string; NODE_GATEWAYS: string; RELEASE_PUBLIC_KEY: string; NODE_TOKEN_KEY: string };
type Session = {hash: string; user_id: string; name: string; avatar_url: string|null; role: Role; csrf: string; expires: number};
const now = () => Math.floor(Date.now() / 1000);
const reply = (data: unknown, status = 200) => Response.json(data, {status, headers: {'Cache-Control':'no-store'}});
const redirect = (url: string, cookies?: string) => new Response(null, {status:302, headers:{Location:url, 'Cache-Control':'no-store', ...(cookies ? {'Set-Cookie':cookies} : {})}});
class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }
function need(condition: unknown, status: number, message: string): asserts condition { if (!condition) throw new HttpError(status, message); }
async function session(env: Bindings, hash: string): Promise<Session | null> {
  return env.DB.prepare('SELECT s.*,u.name,u.role,u.avatar_url FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.hash=? AND s.expires>? AND u.blocked=0').bind(hash, now()).first<Session>();
}
async function audit(env: Bindings, actor: string, action: string, target: string) {
  await env.DB.prepare('INSERT INTO audit(ts,actor,action,target) VALUES(?,?,?,?)').bind(now(), actor, action, target).run();
}
async function auth(request: Request, env: Bindings, role: Role = 'viewer') {
  const user = await session(env, await digest(cookieValue(request, '__Host-farmservers')));
  need(user, 401, 'Sign in with Discord');
  need(allowed(user.role, role), 403, 'Your account needs approval for this operation');
  if (!['GET','HEAD'].includes(request.method)) {
    need(request.headers.get('Origin') === env.APP_ORIGIN && request.headers.get('X-CSRF-Token') === user.csrf, 403, 'Invalid request origin or CSRF token');
  }
  return user;
}
async function gateway(env: Bindings, id: string): Promise<Gateway> {
  let stored;
  try { stored=await readGateway(env,id); }
  catch { throw new HttpError(503,'Saved gateway credentials could not be opened. Check NODE_TOKEN_KEY.'); }
  need(stored.gateway,503,'Open this node’s Gateway settings and save its tunnel URL and credentials.');
  return stored.gateway;
}
function gatewayHeaders(g: Gateway, user: Session): Headers {
  return new Headers({'X-Central-Token':g.token,'X-Central-User':user.user_id,'X-Central-Role':user.role,'CF-Access-Client-Id':g.accessClientId,'CF-Access-Client-Secret':g.accessClientSecret});
}
async function oauth(request: Request, env: Bindings, url: URL) {
  need(env.DISCORD_CLIENT_SECRET, 503, 'Discord login is awaiting configuration');
  if (url.pathname === '/auth/login') {
    need(request.method === 'GET', 405, 'Method not allowed');
    const state = randomToken();
    await env.DB.prepare('INSERT INTO oauth_states(hash,expires) VALUES(?,?)').bind(await digest(state), now()+300).run();
    const target = new URL('https://discord.com/oauth2/authorize');
    target.search = new URLSearchParams({client_id:env.DISCORD_CLIENT_ID, redirect_uri:env.APP_ORIGIN+'/auth/callback', response_type:'code', scope:'identify', state}).toString();
    return redirect(target.href, cookie('__Host-oauth',state,300));
  }
  need(url.pathname === '/auth/callback' && request.method === 'GET', 404, 'Not found');
  const state = url.searchParams.get('state') || '';
  need(/^[a-f0-9]{64}$/.test(state) && state === cookieValue(request,'__Host-oauth'), 400, 'Invalid login state');
  const valid = await env.DB.prepare('DELETE FROM oauth_states WHERE hash=? AND expires>? RETURNING hash').bind(await digest(state), now()).first();
  need(valid && url.searchParams.get('code'), 400, 'Login expired; sign in again');
  const tokenResult = await fetch('https://discord.com/api/oauth2/token', {method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'}, body:new URLSearchParams({client_id:env.DISCORD_CLIENT_ID,client_secret:env.DISCORD_CLIENT_SECRET,grant_type:'authorization_code',code:url.searchParams.get('code')!,redirect_uri:env.APP_ORIGIN+'/auth/callback'}), signal:AbortSignal.timeout(15000)});
  need(tokenResult.ok, 502, 'Discord login exchange failed');
  const token = await tokenResult.json<{access_token: string}>();
  const profileResult = await fetch('https://discord.com/api/users/@me', {headers:{Authorization:`Bearer ${token.access_token}`}, signal:AbortSignal.timeout(15000)});
  need(profileResult.ok, 502, 'Unable to read Discord profile');
  const profile = await profileResult.json<{id:string; username:string; avatar?:string|null; discriminator?:string}>();
  need(/^\d{17,20}$/.test(profile.id), 502, 'Invalid Discord identity');
  const avatar=typeof profile.avatar==='string'&&/^(?:a_)?[a-f0-9]{32}$/.test(profile.avatar)?'https://cdn.discordapp.com/avatars/'+profile.id+'/'+profile.avatar+'.webp?size=64':profile.avatar===null?'https://cdn.discordapp.com/embed/avatars/'+(profile.discriminator&&profile.discriminator!=='0'?Number(profile.discriminator)%5:Number((BigInt(profile.id)>>22n)%6n))+'.png':null;
  const role = profile.id === env.BOOTSTRAP_ADMIN_ID ? 'admin' : 'pending';
  await env.DB.prepare("INSERT INTO users(id,name,role,created,avatar_url) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name, avatar_url=excluded.avatar_url, role=CASE WHEN excluded.role='admin' THEN 'admin' ELSE users.role END").bind(profile.id, profile.username.slice(0,100), role, now(),avatar).run();
  const sid = randomToken();
  const created=await env.DB.prepare('INSERT INTO sessions(hash,user_id,csrf,expires) SELECT ?,id,?,? FROM users WHERE id=? AND blocked=0 RETURNING hash').bind(await digest(sid),randomToken(),now()+28800,profile.id).first();
  if(!created){
    await audit(env,profile.id,'login.blocked','discord');
    const response=new Response('This account is blocked. Contact an administrator.',{status:403,headers:{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'}});
    response.headers.append('Set-Cookie',cookie('__Host-farmservers','',0));response.headers.append('Set-Cookie',cookie('__Host-oauth','',0));return response;
  }
  const response = redirect(env.APP_ORIGIN+'/',cookie('__Host-farmservers',sid,28800));
  response.headers.append('Set-Cookie',cookie('__Host-oauth','',0));
  await audit(env,profile.id,'login','discord');
  return response;
}
async function heartbeat(request: Request, env: Bindings, id: string) {
  need(request.method === 'POST' && validId(id), 405, 'Invalid heartbeat');
  const bearer = request.headers.get('Authorization') || '';
  need(/^Bearer [a-f0-9]{64}$/.test(bearer),401,'Unauthorized node');
  const node = await env.DB.prepare('SELECT id FROM nodes WHERE id=? AND token_hash=? AND enabled=1').bind(id,await digest(bearer.slice(7))).first();
  need(node,401,'Unauthorized node');
  const body = await readJson(request);
  need(body.version === 1 && Array.isArray(body.samples) && body.samples.length <= 101 && Array.isArray(body.servers) && body.servers.length <= 100,422,'Invalid heartbeat schema');
  const samples = body.samples.map((item: unknown) => {
    need(item && typeof item === 'object',422,'Invalid sample');
    const s = item as Record<string,unknown>;
    need(validScope(s.scope) && typeof s.timestamp === 'number' && Number.isInteger(s.timestamp) && s.timestamp <= now()+60 && s.timestamp >= now()-3600,422,'Invalid sample scope or timestamp');
    return {scope:s.scope,timestamp:s.timestamp,data:safeMetrics(s.data)};
  });
  const servers = body.servers.map((item: unknown) => {
    need(item && typeof item === 'object',422,'Invalid server');
    const s = item as Record<string,unknown>;
    need(validScope(s.instance_id) && typeof s.server_name === 'string',422,'Invalid server identity');
    const details:Record<string,string|number>={};
    for(const key of ['game_version','game_map','server_map','server_region'])if(typeof s[key]==='string')details[key]=(s[key] as string).slice(0,100);
    for(const key of ['player_count','player_capacity','server_players','game_sampled_at'])if(typeof s[key]==='number'&&Number.isInteger(s[key])&&(s[key] as number)>=0&&(s[key] as number)<=(key==='game_sampled_at'?now()+60:1000))details[key]=s[key] as number;
    return {instance_id:s.instance_id,server_name:s.server_name.slice(0,150),status:typeof s.status === 'string' ? s.status.slice(0,40) : 'unknown',...details};
  });
  // The heartbeat arrives directly from the node to this Worker, so its connecting IP is the
  // node's real public address. Remember it as a fallback for links (e.g. per-server SFTP) when
  // the admin hasn't set, or has misconfigured, that node's Access Host/IP.
  const detectedIp = request.headers.get('CF-Connecting-IP');
  await env.DB.batch([
    env.DB.prepare('UPDATE nodes SET last_seen=?,snapshot=? WHERE id=?').bind(now(),JSON.stringify({servers,samples}),id),
    ...(publicIPv4(detectedIp) ? [env.DB.prepare('UPDATE nodes SET detected_public_ip=? WHERE id=?').bind(detectedIp,id)] : []),
    ...(env.NODE_TOKEN_KEY ? [env.DB.prepare('UPDATE nodes SET token_encrypted=? WHERE id=? AND token_hash=?').bind(await sealToken(env.NODE_TOKEN_KEY,id,bearer.slice(7)),id,await digest(bearer.slice(7)))] : []),
    ...samples.map(s => env.DB.prepare('INSERT OR IGNORE INTO samples(node_id,scope,ts,data) VALUES(?,?,?,?)').bind(id,s.scope,s.timestamp,JSON.stringify(s.data)))
  ]);
  return reply({ok:true,interval_seconds:30});
}
type View = {hash:string;session_hash:string;node_id:string;host:string;kind:string;instance:string;expires:number};
// Allocates the stable hostname for a game server's console or game admin panel, attaches it to
// this Worker, and returns it only once Cloudflare has published both of its DNS records.
async function ensureGameEndpoint(env:Bindings,node:string,instance:string,kind:'vnc'|'web'):Promise<string>{
  await env.DB.prepare('INSERT OR IGNORE INTO game_slots(node_id,instance) VALUES(?,?)').bind(node,instance).run();
  const slot=await env.DB.prepare('SELECT id FROM game_slots WHERE node_id=? AND instance=?').bind(node,instance).first<{id:number}>();
  const host=(kind==='web'?'game-':'console-')+'fs25-'+String(slot!.id).padStart(4,'0')+'.sargentweb.com';
  await env.DB.prepare('INSERT INTO game_endpoints(host,node_id,instance,kind) VALUES(?,?,?,?) ON CONFLICT(node_id,instance,kind) DO UPDATE SET host=excluded.host,ready=CASE WHEN host=excluded.host THEN ready ELSE 0 END').bind(host,node,instance,kind).run();
  const endpoint=await env.DB.prepare('SELECT ready FROM game_endpoints WHERE host=?').bind(host).first<{ready:number}>();
  const pending='Cloudflare is still creating DNS records for '+host+'. This usually takes a minute or two; open it again shortly.';
  if(!endpoint?.ready){
    let dnsReady:boolean;
    try{dnsReady=await provisionGameDomain(env,host);}catch(e){throw new HttpError(503,e instanceof Error?e.message:'Hostname setup failed');}
    // The hostname is not marked ready, nor handed to a browser, until Cloudflare has published
    // both DNS records; a browser sent there earlier would cache NXDOMAIN for up to an hour.
    need(dnsReady,503,pending);
    await env.DB.prepare('UPDATE game_endpoints SET ready=1 WHERE host=?').bind(host).run();
  }
  // A hostname that has been handed out before is never gated again: the readiness check
  // reports DNS trouble separately, and a gate here would take working consoles down.
  return host;
}
async function launch(request: Request, env: Bindings, url: URL) {
  const user = await auth(request,env,'admin');
  const node = url.searchParams.get('node') || '', kind = url.searchParams.get('kind') || 'panel', instance = url.searchParams.get('instance') || '';
  need(request.method === 'POST' && validId(node) && ['panel','vnc','web'].includes(kind) && (kind === 'panel' ? instance === '' || validScope(instance) : validScope(instance)),422,'Invalid viewer');
  need(await env.DB.prepare('SELECT id FROM nodes WHERE id=? AND enabled=1').bind(node).first(),404,'Node unavailable');
  if(kind==='panel')return reply({url:env.APP_ORIGIN+(instance?'/servers/'+node+'/'+instance:'/nodes/'+node)+'?tab=settings'});
  await gateway(env,node);
  const row=await env.DB.prepare('SELECT snapshot FROM nodes WHERE id=?').bind(node).first<{snapshot:string|null}>();
  need(row?.snapshot&&JSON.parse(row.snapshot).servers?.some((s:{instance_id:string})=>s.instance_id===instance),404,'Game server unavailable');
  const host=await ensureGameEndpoint(env,node,instance,kind as 'vnc'|'web');
  if(kind==='web'){await audit(env,user.user_id,'viewer.public-web',node+'/'+instance);return reply({url:'https://'+host+'/',public:true});}
  const ticket = randomToken();
  await env.DB.prepare('INSERT INTO tickets(hash,session_hash,node_id,host,kind,instance,expires) VALUES(?,?,?,?,?,?,?)').bind(await digest(ticket),user.hash,node,host,kind,instance,now()+60).run();
  await audit(env,user.user_id,'viewer.'+kind,node+'/'+instance);
  return reply({url:'https://'+host+'/_connect?ticket='+ticket});
}
async function viewer(request: Request, env: Bindings, url: URL): Promise<Response> {
  if (url.pathname === '/_connect') {
    need(request.method === 'GET',405,'Method not allowed');
    const ticket = url.searchParams.get('ticket') || '';
    need(/^[a-f0-9]{64}$/.test(ticket),400,'Invalid viewer ticket');
    const view = await env.DB.prepare('DELETE FROM tickets WHERE hash=? AND host=? AND expires>? RETURNING *').bind(await digest(ticket),url.hostname,now()).first<View>();
    need(view,401,'Viewer link expired; open a fresh link from the dashboard');
    const user = await session(env,view.session_hash);
    need(user && allowed(user.role,'admin'),403,'Viewer access revoked');
    const sid = randomToken();
    await env.DB.prepare('INSERT INTO views(hash,session_hash,node_id,host,kind,instance,expires) VALUES(?,?,?,?,?,?,?)').bind(await digest(sid),view.session_hash,view.node_id,view.host,view.kind,view.instance,Math.min(now()+900,user.expires)).run();
    let target = view.kind === 'panel' && view.instance ? '/?route=server&instance_id='+encodeURIComponent(view.instance) : '/';
    if (view.kind === 'vnc') {
      // A Worker cannot relay a WebSocket into a Cloudflare Tunnel: the edge never types the
      // subrequest as an upgrade, so the node's 101 is held until the idle timeout. noVNC therefore
      // connects straight to the node gateway hostname, where Access is bypassed for this one path.
      // Browsers cannot send the gateway headers on a WebSocket, so the node verifies this signed,
      // instance-bound ticket instead. It expires with the viewer session.
      const g = await gateway(env,view.node_id), expires = Math.min(now()+900,user.expires), nonce = randomToken().slice(0,32);
      const ticket = expires+'.'+nonce+'.'+await hmacHex(g.token,'console|'+view.instance+'|'+expires+'|'+nonce);
      target = '/vnc.html?'+new URLSearchParams({autoconnect:'1',resize:'remote',encrypt:'1',host:new URL(g.origin).hostname,port:'443',path:'central/view/'+view.instance+'/vnc/websockify/'+ticket});
    }
    return redirect(target,cookie('__Host-view',sid,900));
  }
  const view = await env.DB.prepare('SELECT v.* FROM views v JOIN nodes n ON n.id=v.node_id WHERE v.hash=? AND v.host=? AND v.expires>? AND n.enabled=1').bind(await digest(cookieValue(request,'__Host-view')),url.hostname,now()).first<View>();
  need(view,401,'Viewer session expired; open it again from the dashboard');
  need(view.kind!=='panel',410,'Node management has moved to the main site. Open the node there.');
  const user = await session(env,view.session_hash);
  need(user && allowed(user.role,'admin'),403,'Viewer access revoked');
  if (view.kind === 'panel' && request.method === 'GET' && ['console','web_admin'].includes(url.searchParams.get('route') || '')) {
    const instance = url.searchParams.get('instance_id') || '';
    need(validScope(instance),422,'Invalid instance');
    return redirect(env.APP_ORIGIN+'/?'+new URLSearchParams({launch:view.node_id,kind:url.searchParams.get('route') === 'console' ? 'vnc' : 'web',instance}));
  }
  return proxyViewer(request,env,url,view,user);
}
async function proxyViewer(request:Request,env:Bindings,url:URL,view:View,user:Session|null):Promise<Response>{
  const websocket = request.headers.get('Upgrade')?.toLowerCase() === 'websocket';
  need(!websocket||!!user,403,'Console access requires dashboard sign-in');
  if (websocket || !['GET','HEAD'].includes(request.method)) {
    // Same-origin form navigations (e.g. the game panel's own login form) omit the
    // Origin header entirely per the Fetch spec; Sec-Fetch-Site still reports them
    // accurately and is sent by all modern browsers, so prefer it when present.
    const site = request.headers.get('Sec-Fetch-Site');
    const sameOrigin = site ? (site === 'same-origin' || site === 'none') : request.headers.get('Origin') === url.origin;
    need(sameOrigin,403,'Invalid viewer origin');
  }
  const g = await gateway(env,view.node_id), headers = user?gatewayHeaders(g,user):new Headers({'X-Central-Token':g.token,'X-Central-Public':'web','CF-Access-Client-Id':g.accessClientId,'CF-Access-Client-Secret':g.accessClientSecret});
  headers.set('X-Forwarded-Host', url.hostname);
  headers.set('X-Forwarded-Proto', 'https');
  headers.set('X-Forwarded-Port', '443');
  // HTML rewriting requires an uncompressed upstream representation.
  if (view.kind === 'web') headers.set('Accept-Encoding', 'identity');
  for (const name of ['Content-Type','Accept','Range','If-Range','Upgrade','Sec-WebSocket-Protocol','Sec-WebSocket-Version','Sec-WebSocket-Key']) {
    const value = request.headers.get(name); if (value) headers.set(name,value);
  }
  // Game and PHP session cookies stay confined to this individual viewer origin.
  const cookies = (request.headers.get('Cookie')||'').split(';').filter(c => !c.trim().startsWith('__Host-')).join(';');
  if (cookies) headers.set('Cookie',cookies);
  const path = view.kind === 'panel' ? url.pathname : '/central/view/'+view.instance+'/'+view.kind+url.pathname;
  const upstream = await fetch(g.origin+path+url.search,{method:request.method,headers,body:['GET','HEAD'].includes(request.method)?undefined:request.body,redirect:'manual'});
  if (upstream.status === 101 && upstream.webSocket) {
    const pair = new WebSocketPair(), client = pair[0], relay = pair[1], backend = upstream.webSocket;
    relay.accept(); backend.accept();
    let checked = now(), alive = true, checking: Promise<boolean> | undefined;
    const close = () => {if(!alive)return;alive=false;try{relay.close(1000,'Session ended');}catch{}try{backend.close(1000,'Session ended');}catch{}};
    const authorized = async () => {
      if (!alive || now()>=view.expires) return false;
      if (now()-checked<15) return true;
      checking ??= (async()=>{const s=await session(env,view.session_hash);const node=await env.DB.prepare('SELECT id FROM nodes WHERE id=? AND enabled=1').bind(view.node_id).first();checked=now();return !!s&&allowed(s.role,'admin')&&!!node;})();
      try{return await checking;}finally{checking=undefined;}
    };
    for (const [from,to] of [[relay,backend],[backend,relay]]) {
      let chain=Promise.resolve(), queued=0;
      from.addEventListener('message',event=>{
        const size=typeof event.data==='string'?new TextEncoder().encode(event.data).length:event.data.byteLength;
        queued+=size;if(queued>16*1024*1024){close();return;}
        chain=chain.then(async()=>{try{if(await authorized())to.send(event.data);else close();}catch{close();}finally{queued-=size;}});
      });
      from.addEventListener('close',close);from.addEventListener('error',close);
    }
    return new Response(null,{status:101,webSocket:client});
  }
  const out = new Headers();
  for(const name of ['Content-Type','Content-Length','Content-Encoding','Content-Disposition','Accept-Ranges','Content-Range']){const value=upstream.headers.get(name);if(value)out.set(name,value);}
  for (const value of upstream.headers.getSetCookie()) {
    if (/^__Host-/i.test(value)) continue;
    out.append('Set-Cookie',value.replace(/;\s*Domain=[^;]*/ig,'').replace(/;\s*Path=[^;]*/ig,'; Path=/')+'; Secure');
  }
  const gameOrigin = view.kind === 'web' ? upstream.headers.get('X-Farmservers-Upstream-Origin') : null;
  const location=upstream.headers.get('Location');
  if(location){
    const target=new URL(location,g.origin);
    const rewritten = gameOrigin ? gameUrl(target.href,url.origin,gameOrigin) : target.href;
    const destination = new URL(rewritten);
    need(destination.origin===g.origin || destination.origin===url.origin,502,'Upstream attempted an external redirect');
    const prefix = '/central/view/'+view.instance+'/'+view.kind;
    const pathname = destination.pathname.startsWith(prefix+'/') ? destination.pathname.slice(prefix.length) : destination.pathname;
    out.set('Location',url.origin+pathname+destination.search+destination.hash);
  }
  out.set('Cache-Control','no-store');out.set('Referrer-Policy','no-referrer');out.set('X-Content-Type-Options','nosniff');out.set('Content-Security-Policy',"frame-ancestors 'none'");
  const response = new Response(upstream.body,{status:upstream.status,headers:out});
  if (gameOrigin && upstream.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() === 'text/html'
      && !upstream.headers.has('Content-Disposition') && upstream.status !== 206 && request.method !== 'HEAD') {
    return rewriteGameHtml(response,url.origin,gameOrigin);
  }
  return response;
}
async function api(request: Request, env: Bindings, url: URL) {
  if(url.pathname==='/api/node-connection')return nodeConnection(request,env);
  if (url.pathname.startsWith('/api/distribution/')) {
    if (url.pathname === '/api/distribution/key' || request.headers.has('Authorization')) return distribution(request,env,false);
    const administrator = await auth(request,env,'admin');
    const response = await distribution(request,env,true);
    if (request.method === 'POST' && response.ok) {
      const result=await response.clone().json<{id?:string;node?:string;version?:string}>();
      await audit(env,administrator.user_id,'distribution.'+url.pathname.split('/').pop(),[result.node,result.version,result.id].filter(Boolean).join('/') || url.pathname);
    }
    return response;
  }
  if (url.pathname === '/api/launch') return launch(request,env,url);
  if (url.pathname.startsWith('/api/heartbeat/')) return heartbeat(request,env,url.pathname.slice(15));
  if(url.pathname.startsWith('/api/game-node/'))return gameNode(request,env);
  if(url.pathname==='/api/game-status'){const admin=await auth(request,env,'admin');const response=await gameAdmin(request,env);if(request.method==='POST'&&response.ok)await audit(env,admin.user_id,'game.status','game-library');return response;}
  const user = await auth(request,env,'pending');
  if (url.pathname === '/api/me' && request.method === 'GET') return reply({id:user.user_id,name:user.name,role:user.role,csrf:user.csrf,avatarUrl:user.avatar_url});
  if (url.pathname === '/api/logout' && request.method === 'POST') {
    await env.DB.prepare('DELETE FROM sessions WHERE hash=?').bind(user.hash).run();
    return new Response(null,{status:204,headers:{'Set-Cookie':cookie('__Host-farmservers','',0),'Cache-Control':'no-store'}});
  }
  need(allowed(user.role,'viewer'),403,'Approved access required');
  if(user.role==='operator')need(['/api/nodes','/api/action'].includes(url.pathname),403,'Staff access is limited to game server status and start, stop or restart.');
  if(url.pathname==='/api/live'&&request.method==='POST'){
    if(user.role==='viewer'){const revision=await env.DB.prepare('SELECT COALESCE(MAX(id),0) AS revision FROM audit').first<{revision:number}>();return reply({editors:[],revision:revision?.revision||0});}
    need(user.role==='admin',403,'Administrator access required');
    const body=await readJson(request,1024);
    need(typeof body.resource==='string'&&/^(node:[a-z0-9-]{1,63}|server:[a-z0-9-]{1,63}:[a-zA-Z0-9_-]{1,64}|page:(overview|servers|access|users|cloudflare|setup|install|game-status))$/.test(body.resource)&&typeof body.editing==='boolean',422,'Invalid editing resource');
    await env.DB.prepare('DELETE FROM edit_presence WHERE expires<? OR session_hash=?').bind(now(),user.hash).run();
    if(body.editing)await env.DB.prepare('INSERT INTO edit_presence(session_hash,resource,expires) VALUES(?,?,?) ON CONFLICT(session_hash) DO UPDATE SET resource=excluded.resource,expires=excluded.expires').bind(user.hash,body.resource,now()+20).run();
    const editors=await env.DB.prepare("SELECT DISTINCT u.id,u.name FROM edit_presence p JOIN sessions s ON s.hash=p.session_hash JOIN users u ON u.id=s.user_id WHERE p.resource=? AND p.expires>? AND s.expires>? AND u.blocked=0 AND u.role='admin' AND u.id!=?").bind(body.resource,now(),now(),user.user_id).all();
    const revision=await env.DB.prepare('SELECT COALESCE(MAX(id),0) AS revision FROM audit').first<{revision:number}>();
    return reply({editors:editors.results,revision:revision?.revision||0});
  }
  if (url.pathname === '/api/notifications' && request.method === 'GET') return reply(await notifications(env.DB,user.user_id,user.role==='admin'));
  if (url.pathname === '/api/notifications/read' && request.method === 'POST') {
    const body=await readJson(request,16384);
    need(Array.isArray(body.ids)&&body.ids.length<=200&&body.ids.every(id=>typeof id==='string'&&id.length<=200),422,'Invalid notifications');
    if(body.ids.length)await env.DB.batch(body.ids.map(id=>env.DB.prepare('INSERT OR IGNORE INTO notification_reads(user_id,notification_id,read_at) VALUES(?,?,?)').bind(user.user_id,id,now())));
    return reply({ok:true});
  }
  if (url.pathname === '/api/nodes/software' && request.method === 'GET') {
    const id=url.searchParams.get('node') || '';
    need(validId(id),422,'Invalid node');
    const node=await env.DB.prepare('SELECT installed_version FROM nodes WHERE id=?').bind(id).first<{installed_version:string|null}>();
    need(node,404,'Node not found');
    const releases=(await env.DB.prepare('SELECT version,created FROM releases WHERE enabled=1').all<{version:string;created:number}>()).results;
    const jobs=(await env.DB.prepare('SELECT * FROM node_updates WHERE node_id=? ORDER BY created DESC,rowid DESC LIMIT 20').bind(id).all()).results;
    const succeeded=await env.DB.prepare("SELECT version FROM node_updates WHERE node_id=? AND status='succeeded' ORDER BY updated DESC,rowid DESC LIMIT 1").bind(id).first<{version:string}>();
    return reply({installed_version:node.installed_version || succeeded?.version || null,version_source:node.installed_version?'reported':succeeded?'successful_update':'unknown',releases,jobs});
  }
  if (url.pathname === '/api/readiness' && request.method === 'POST') {
    need(user.role==='admin',403,'Administrator access required');
    const report=await fleetReadiness(env,user.user_id);
    await audit(env,user.user_id,'fleet.readiness',report.nodes.length+' node(s)');
    return reply(report);
  }
  if (url.pathname === '/api/readiness/repair' && request.method === 'POST') {
    need(user.role==='admin',403,'Administrator access required');
    const body=await readJson(request,4096);
    need(validId(body.node)&&['console-bypass','provision-hostname'].includes(String(body.action)),422,'Invalid repair');
    need(await env.DB.prepare('SELECT id FROM nodes WHERE id=? AND enabled=1').bind(body.node).first(),404,'Node unavailable');
    let message:string;
    if(body.action==='console-bypass'){
      try{message=await repairConsoleBypass(env,body.node);}catch(e){throw new HttpError(503,e instanceof Error?e.message:'Repair failed');}
    }else{
      need(validScope(body.instance)&&['vnc','web'].includes(String(body.kind)),422,'Invalid hostname repair');
      const row=await env.DB.prepare('SELECT snapshot FROM nodes WHERE id=?').bind(body.node).first<{snapshot:string|null}>();
      need(row?.snapshot&&JSON.parse(row.snapshot).servers?.some((s:{instance_id:string})=>s.instance_id===body.instance),404,'Game server unavailable');
      message=(await ensureGameEndpoint(env,body.node,body.instance,body.kind as 'vnc'|'web'))+' is provisioned with both DNS records.';
    }
    await audit(env,user.user_id,'readiness.repair',body.node+'/'+body.action+(body.instance?'/'+body.instance:''));
    return reply({ok:true,message});
  }
  if (url.pathname === '/api/nodes' && request.method === 'GET') {
    const {results} = await env.DB.prepare('SELECT id,name,enabled,last_seen,snapshot FROM nodes ORDER BY name').all<{id:string;name:string;enabled:number;last_seen:number|null;snapshot:string|null}>();
    if(user.role==='operator')return reply({nodes:results.map(n=>({id:n.id,name:n.name,enabled:n.enabled,last_seen:n.last_seen,online:!!n.enabled&&n.last_seen!==null&&now()-n.last_seen<120,snapshot:{servers:((n.snapshot?JSON.parse(n.snapshot):null)?.servers||[]).map((s:{instance_id:string;server_name:string;status:string})=>({instance_id:s.instance_id,server_name:s.server_name,status:s.status,...Object.fromEntries(Object.entries(s).filter(([key])=>['game_version','game_map','server_map','server_region','player_count','player_capacity','server_players','game_sampled_at'].includes(key)))}))}}))});
    return reply({nodes:results.map(n => ({...n,snapshot:n.snapshot ? JSON.parse(n.snapshot) : null,online:!!n.enabled && n.last_seen !== null && now()-n.last_seen < 120}))});
  }
  if (url.pathname === '/api/history' && request.method === 'GET') {
    const id = url.searchParams.get('node') || '', scope = url.searchParams.get('scope') || 'host', hours = Number(url.searchParams.get('hours') || 1);
    need(validId(id) && validScope(scope) && [1,6,24,168,720].includes(hours),422,'Invalid history query');
    const bucket = Math.max(30,Math.ceil(hours*3600/359));
    const keys = ['cpu_percent','memory_used_bytes','disk_used_bytes','network_in_bytes_sec','network_out_bytes_sec'];
    const expressions = keys.map(k => `AVG(json_extract(data,'$.${k}')) AS ${k}`).join(',');
    const {results} = await env.DB.prepare(`SELECT MIN(ts) AS timestamp,${expressions} FROM samples WHERE node_id=? AND scope=? AND ts>=? GROUP BY CAST(ts / ? AS INTEGER) ORDER BY timestamp`).bind(id,scope,now()-hours*3600,bucket).all();
    return reply({points:results});
  }
  if (url.pathname === '/api/action' && request.method === 'POST') {
    need(allowed(user.role,'operator'),403,'Operator access required');
    const body = await readJson(request,4096);
    if(user.role==='operator')need(['start','stop','restart'].includes(String(body.action)),403,'Staff may only start, stop or restart game servers.');
    need(validId(body.node) && validScope(body.instance_id) && ['start','stop','restart','backend_reboot','logs'].includes(String(body.action)),422,'Invalid action');
    need(await env.DB.prepare('SELECT id FROM nodes WHERE id=? AND enabled=1').bind(body.node).first(),404,'Node unavailable');
    const g = await gateway(env,body.node), headers = gatewayHeaders(g,user);
    headers.set('Content-Type','application/json');
    await audit(env,user.user_id,'server.'+body.action,body.node+'/'+body.instance_id);
    const result = await fetch(g.origin+'/?route=api_node_server_action',{method:'POST',headers,body:JSON.stringify({instance_id:body.instance_id,action:body.action}),redirect:'manual',signal:AbortSignal.timeout(60000)});
    need(result.headers.get('Content-Type')?.includes('application/json'),502,'Node gateway returned an unexpected response');
    return new Response(result.body,{status:result.status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
  }
  if (url.pathname === '/api/nodes/apply-updates' && request.method === 'POST') {
    need(allowed(user.role,'admin'),403,'Administrator access required');
    const body = await readJson(request,4096);
    need(validId(body.node) && (body.instance_id===undefined || validScope(body.instance_id)),422,'Invalid node or instance');
    need(await env.DB.prepare('SELECT id FROM nodes WHERE id=? AND enabled=1').bind(body.node).first(),404,'Node unavailable');
    const g = await gateway(env,body.node), headers = gatewayHeaders(g,user);
    headers.set('Content-Type','application/json');
    await audit(env,user.user_id,'node.apply-updates',body.node+(body.instance_id?'/'+body.instance_id:''));
    const result = await fetch(g.origin+'/?route=api_node_apply_updates',{method:'POST',headers,body:JSON.stringify(body.instance_id?{instance_id:body.instance_id}:{}),redirect:'manual',signal:AbortSignal.timeout(240000)});
    need(result.headers.get('Content-Type')?.includes('application/json'),502,'Node gateway returned an unexpected response');
    return new Response(result.body,{status:result.status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
  }
  if(url.pathname==='/api/manage')return management(request,user,async node=>{
    need(await env.DB.prepare('SELECT id FROM nodes WHERE id=? AND enabled=1').bind(node).first(),404,'Node unavailable');
    return gateway(env,node);
  },(action,target)=>audit(env,user.user_id,action,target),async node=>{
    const row=await env.DB.prepare('SELECT detected_public_ip FROM nodes WHERE id=?').bind(node).first<{detected_public_ip:string|null}>();
    return row?.detected_public_ip ?? null;
  });
  need(allowed(user.role,'admin'),403,'Administrator access required');
  if(url.pathname==='/api/nodes/notes'&&['GET','POST'].includes(request.method)){
    const body=request.method==='POST'?await readJson(request,65536):null;
    const id=body?.id??url.searchParams.get('id');
    need(validId(id),422,'Invalid node');
    need(await env.DB.prepare('SELECT id FROM nodes WHERE id=?').bind(id).first(),404,'Node not found');
    if(body){
      need(typeof body.notes==='string'&&body.notes.length<=10000&&Number.isSafeInteger(body.version)&&Number(body.version)>=0,422,'Notes must be at most 10,000 characters with a valid version.');
      const updated=Number(body.version)===0
        ?await env.DB.prepare('INSERT OR IGNORE INTO node_notes(node_id,notes,version,updated,updated_by) VALUES(?,?,1,?,?) RETURNING version').bind(id,body.notes,now(),user.user_id).first()
        :await env.DB.prepare('UPDATE node_notes SET notes=?,version=version+1,updated=?,updated_by=? WHERE node_id=? AND version=? RETURNING version').bind(body.notes,now(),user.user_id,id,body.version).first();
      need(updated,409,'Another administrator changed these notes. Your draft is preserved. Load the latest notes before saving again.');
      await audit(env,user.user_id,'node.notes-update',id);
    }
    const row=await env.DB.prepare('SELECT n.notes,n.version,n.updated,u.name AS updatedBy FROM node_notes n LEFT JOIN users u ON u.id=n.updated_by WHERE n.node_id=?').bind(id).first();
    return reply(row||{notes:'',version:0,updated:null,updatedBy:null});
  }
  if(url.pathname==='/api/cloudflare' || url.pathname.startsWith('/api/cloudflare/')){
    const response=url.pathname.startsWith('/api/cloudflare/oauth/')?await cloudflareOAuth(request,env,user.hash):await cloudflareAdmin(request,env);
    if(request.method==='POST' && response.ok)await audit(env,user.user_id,'cloudflare.'+url.pathname.split('/').pop(),'configuration');
    return response;
  }
  if (url.pathname === '/api/nodes/gateway' && ['GET','POST'].includes(request.method)) {
    const body=request.method==='POST'?await readJson(request,16384):null;
    const id=body?.id ?? url.searchParams.get('id');
    need(validId(id),422,'Invalid node');
    need(await env.DB.prepare('SELECT id FROM nodes WHERE id=?').bind(id).first(),404,'Node not found');
    let stored;
    try { stored=await readGateway(env,id); }
    catch { throw new HttpError(503,'Saved gateway credentials could not be opened. Check NODE_TOKEN_KEY.'); }
    if(!body)return reply({origin:stored.gateway?.origin || '',accessClientId:stored.gateway?.accessClientId || '',hasToken:!!stored.gateway?.token,hasAccessSecret:!!stored.gateway?.accessClientSecret,source:stored.source});
    need(['origin','token','accessClientId','accessClientSecret'].every(k=>typeof body[k]==='string'),422,'Invalid gateway fields');
    const next={origin:(body.origin as string).trim(),accessClientId:(body.accessClientId as string).trim(),token:body.token || stored.gateway?.token || '',accessClientSecret:body.accessClientSecret || stored.gateway?.accessClientSecret || ''};
    need(validGateway(next),422,'Enter an HTTPS tunnel origin under sargentweb.com, a 64-character lowercase hex gateway token, and Cloudflare Access credentials.');
    need(/^[a-f0-9]{64}$/.test(env.NODE_TOKEN_KEY),503,'Gateway encryption requires NODE_TOKEN_KEY to be configured.');
    await saveGateway(env,id,next);
    await audit(env,user.user_id,'node.gateway-update',id);
    return reply({ok:true});
  }
  if (url.pathname === '/api/nodes/update' && request.method === 'POST') {
    const body = await readJson(request,4096);
    need(validId(body.id) && typeof body.name === 'string' && body.name.trim().length>0 && body.name.trim().length<=100 && typeof body.enabled === 'boolean',422,'Invalid node');
    const updated=await env.DB.prepare('UPDATE nodes SET name=?,enabled=? WHERE id=? RETURNING id').bind(body.name.trim(),body.enabled?1:0,body.id).first();
    need(updated,404,'Node not found');
    await audit(env,user.user_id,'node.update',body.id);
    return reply({ok:true});
  }
  if (url.pathname === '/api/nodes/token' && request.method === 'POST') {
    const body = await readJson(request,4096);
    need(validId(body.id),422,'Invalid node');
    const node = await env.DB.prepare('SELECT token_encrypted FROM nodes WHERE id=?').bind(body.id).first<{token_encrypted:string|null}>();
    need(node,404,'Node not found');
    need(node.token_encrypted,409,'Token not saved yet. Reconnect this node to publish a heartbeat, or rotate its token.');
    need(env.NODE_TOKEN_KEY,503,'Node token storage is awaiting configuration');
    let token: string;
    try { token = await openToken(env.NODE_TOKEN_KEY,body.id,node.token_encrypted); }
    catch { throw new HttpError(503,'Token could not be opened. Check the encryption key or reconnect the node to save its token again.'); }
    await audit(env,user.user_id,'node.token-view',body.id);
    return reply({id:body.id,token});
  }
  if (url.pathname === '/api/users' && request.method === 'GET') return reply((await env.DB.prepare('SELECT id,name,role,created,blocked FROM users ORDER BY created DESC').all()).results);
  if (url.pathname === '/api/users/block' && request.method === 'POST') {
    const body=await readJson(request,4096);
    need(typeof body.id==='string'&&/^\d{17,20}$/.test(body.id)&&typeof body.blocked==='boolean',422,'Invalid user or block status');
    need(body.id!==user.user_id&&body.id!==env.BOOTSTRAP_ADMIN_ID,409,'You cannot block yourself or the initial administrator');
    need(await env.DB.prepare('SELECT id FROM users WHERE id=?').bind(body.id).first(),404,'User not found');
    await env.DB.batch([env.DB.prepare('UPDATE users SET blocked=?,role=CASE WHEN ?=0 THEN \'pending\' ELSE role END WHERE id=?').bind(body.blocked?1:0,body.blocked?1:0,body.id),env.DB.prepare('DELETE FROM sessions WHERE user_id=?').bind(body.id)]);
    await audit(env,user.user_id,body.blocked?'user.block':'user.unblock',body.id);return reply({ok:true});
  }
  if (url.pathname === '/api/audit' && request.method === 'GET') {
    const q=(url.searchParams.get('q')||'').trim().slice(0,100),action=url.searchParams.get('action')||'',actor=url.searchParams.get('actor')||'',before=url.searchParams.get('before')||'';
    need((action===''||/^[a-z0-9.-]{1,60}$/.test(action))&&(actor===''||/^\d{17,20}$/.test(actor))&&(before===''||/^\d{1,18}$/.test(before)),422,'Invalid audit filter');
    const like='%'+q.replace(/[\\%_]/g,c=>'\\'+c)+'%';
    const rows=(await env.DB.prepare("SELECT * FROM audit WHERE (?='' OR id<?) AND (?='' OR action=?) AND (?='' OR actor=?) AND (?='' OR action LIKE ? ESCAPE '\\' OR target LIKE ? ESCAPE '\\' OR actor LIKE ? ESCAPE '\\') ORDER BY id DESC LIMIT 16").bind(before,Number(before||0),action,action,actor,actor,q,like,like,like).all<{id:number}>()).results;
    const actions=(await env.DB.prepare('SELECT DISTINCT action FROM audit ORDER BY action').all<{action:string}>()).results.map(r=>r.action);
    const events=rows.slice(0,15);
    return reply({events,actions,nextCursor:rows.length>15?String(events[events.length-1].id):null});
  }
  if (url.pathname === '/api/users' && request.method === 'POST') {
    const body = await readJson(request,4096);
    need(typeof body.id === 'string' && /^\d{17,20}$/.test(body.id) && roles.includes(body.role as Role),422,'Invalid user or role');
    need(body.id !== env.BOOTSTRAP_ADMIN_ID,409,'The initial administrator is managed in Worker configuration');
    need(body.id !== user.user_id,409,'You cannot change your own role');
    need(await env.DB.prepare('SELECT id FROM users WHERE id=?').bind(body.id).first(),404,'User not found');
    await env.DB.prepare('UPDATE users SET role=? WHERE id=?').bind(body.role,body.id).run();
    await audit(env,user.user_id,'user.'+body.role,body.id);
    return reply({ok:true});
  }
  if (url.pathname === '/api/users/create' && request.method === 'POST') {
    const body=await readJson(request,4096);
    need(typeof body.id==='string'&&/^\d{17,20}$/.test(body.id)&&typeof body.name==='string'&&body.name.trim().length>0&&body.name.length<=100&&roles.includes(body.role as Role),422,'Invalid Discord ID, name or role');
    const created=await env.DB.prepare('INSERT INTO users(id,name,role,created) VALUES(?,?,?,?) ON CONFLICT(id) DO NOTHING RETURNING id').bind(body.id,body.name.trim(),body.role,now()).first();
    need(created,409,'This user already exists');
    await audit(env,user.user_id,'user.create',body.id);return reply({ok:true});
  }
  if (url.pathname === '/api/nodes' && request.method === 'POST') {
    const body = await readJson(request,4096);
    need(validId(body.id) && typeof body.name === 'string' && body.name.length>0 && body.name.length<=100,422,'Invalid node');
    const token = randomToken();
    need(env.NODE_TOKEN_KEY,503,'Node token storage is awaiting configuration');
    if (body.createOnly === true) {
      const created=await env.DB.prepare('INSERT INTO nodes(id,name,token_hash,token_encrypted) VALUES(?,?,?,?) ON CONFLICT(id) DO NOTHING RETURNING id').bind(body.id,body.name,await digest(token),await sealToken(env.NODE_TOKEN_KEY,body.id,token)).first();
      need(created,409,'This node ID already exists. Open its details to edit it.');
      await audit(env,user.user_id,'node.create',body.id);
      return reply({id:body.id,notice:'Node created. Use View token to retrieve its publishing token.'});
    }
    await env.DB.prepare('INSERT INTO nodes(id,name,token_hash,token_encrypted) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,token_hash=excluded.token_hash,token_encrypted=excluded.token_encrypted').bind(body.id,body.name,await digest(token),await sealToken(env.NODE_TOKEN_KEY,body.id,token)).run();
    await audit(env,user.user_id,'node.enroll-or-rotate',body.id);
    return reply({id:body.id,token,notice:'Token saved. Use View token in Node management to retrieve it.'});
  }
  if (url.pathname === '/api/nodes/disable' && request.method === 'POST') {
    const body = await readJson(request,4096);
    need(validId(body.id),422,'Invalid node');
    await env.DB.prepare('UPDATE nodes SET enabled=0 WHERE id=?').bind(body.id).run();
    await audit(env,user.user_id,'node.disable',body.id);
    return reply({ok:true});
  }
  throw new HttpError(404,'Not found');
}

export default {
  async fetch(request: Request, env: Bindings): Promise<Response> {
    try {
      const url = new URL(request.url);
      if(url.origin!==env.APP_ORIGIN&&/^(game|console)-[a-z0-9-]+\.sargentweb\.com$/.test(url.hostname)){
        const endpoint=await env.DB.prepare('SELECT e.*,n.snapshot FROM game_endpoints e JOIN nodes n ON n.id=e.node_id WHERE e.host=? AND e.ready=1 AND n.enabled=1').bind(url.hostname).first<{node_id:string;instance:string;kind:string;snapshot:string|null}>();
        need(endpoint&&endpoint.snapshot&&JSON.parse(endpoint.snapshot).servers?.some((s:{instance_id:string})=>s.instance_id===endpoint.instance),404,'Game server unavailable');
        if(endpoint.kind==='vnc')return await viewer(request,env,url);
        return await proxyViewer(request,env,url,{hash:'',session_hash:'',node_id:endpoint.node_id,host:url.hostname,kind:'web',instance:endpoint.instance,expires:0},null);
      }
      if (url.hostname.endsWith('.'+new URL(env.APP_ORIGIN).hostname) && /^view-[a-f0-9]{24}\./.test(url.hostname)) return await viewer(request,env,url);
      need(url.origin === env.APP_ORIGIN,404,'Unknown host');
      let response: Response;
      if (url.pathname.startsWith('/auth/')) response = await oauth(request,env,url);
      else if (url.pathname.startsWith('/api/')) response = await api(request,env,url);
      else {
        need(['GET','HEAD'].includes(request.method),405,'Method not allowed');
        // The bootstrap must remain reachable by fresh Ubuntu hosts. Everything
        // else except sign-in assets requires a current approved staff session.
        if (['/style.css','/login.js','/install.py','/favicon.svg','/favicon-32.png','/apple-touch-icon.png','/fs-farmservers-logo.svg','/fs-farmservers-logo.png'].includes(url.pathname)) response=await env.ASSETS.fetch(request);
        else {
          const user=await session(env,await digest(cookieValue(request,'__Host-farmservers')));
          if (!user || !allowed(user.role,'viewer')) response=loginPage(!!user);
          else {
            if(['/cloudflare','/users','/setup','/setup.html','/install','/game-status'].includes(url.pathname.replace(/\/$/,'')))need(user.role==='admin',403,'Administrator access required');
            const appPage = /^\/(?:nodes(?:\/[a-z0-9-]+)?|servers(?:\/[a-z0-9-]+\/[a-zA-Z0-9_-]+)?|access|users|cloudflare|setup|install|game-status)\/?$/.test(url.pathname) || url.pathname === '/setup.html';
            if(user.role==='operator'&&(appPage||url.pathname==='/'||url.pathname==='/index.html')){if(!/^\/servers(?:\/[a-z0-9-]+\/[a-zA-Z0-9_-]+)?\/?$/.test(url.pathname)||url.searchParams.has('tab')&&url.searchParams.get('tab')!=='overview')return Response.redirect(env.APP_ORIGIN+'/servers',302);}
            if(user.role==='operator'&&url.pathname.endsWith('.txt'))need(false,403,'Administrator access required');
            response=await env.ASSETS.fetch(appPage ? new Request(new URL('/',url.origin),request) : request);
            response=new Response(response.body,{status:response.status,headers:response.headers});
            response.headers.set('Cache-Control','no-store');
            response.headers.set('Vary','Cookie');
          }
        }
      }
      const headers = new Headers(response.headers);
      headers.set('X-Content-Type-Options','nosniff');
      headers.set('Referrer-Policy','no-referrer');
      headers.set('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: https://cdn.discordapp.com; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
      headers.set('Strict-Transport-Security','max-age=31536000');
      return new Response(response.body,{status:response.status,headers});
    } catch (error) {
      // Expected failures carry their own status; anything else is a defect worth seeing in the tail.
      if (!(error instanceof HttpError)) console.error('Unhandled request error', error);
      return reply({error:error instanceof HttpError ? error.message : 'Request failed; check service configuration'},error instanceof HttpError ? error.status : 500);
    }
  },
  async scheduled(_event: ScheduledController, env: Bindings) {
    await env.DB.batch([
      ...['oauth_states','sessions','tickets','views'].map(table => env.DB.prepare(`DELETE FROM ${table} WHERE expires<?`).bind(now())),
      env.DB.prepare('DELETE FROM samples WHERE ts<?').bind(now()-30*86400),
      env.DB.prepare('DELETE FROM audit WHERE ts<?').bind(now()-90*86400)
      ,env.DB.prepare('DELETE FROM notification_reads WHERE read_at<?').bind(now()-90*86400)
    ]);
  }
} satisfies ExportedHandler<Bindings>;
