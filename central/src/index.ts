import {allowed, cookie, cookieValue, digest, randomToken, readJson, roles, safeMetrics, validId, validScope, type Role} from './security';
import {gameUrl, rewriteGameHtml} from './game-proxy';
import {distribution} from './releases';
import {loginPage} from './login';

type Bindings = Env & { DISCORD_CLIENT_SECRET: string; NODE_GATEWAYS: string; RELEASE_PUBLIC_KEY: string };
type Session = {hash: string; user_id: string; name: string; role: Role; csrf: string; expires: number};
type Gateway = {origin: string; token: string; accessClientId: string; accessClientSecret: string};
const now = () => Math.floor(Date.now() / 1000);
const reply = (data: unknown, status = 200) => Response.json(data, {status, headers: {'Cache-Control':'no-store'}});
const redirect = (url: string, cookies?: string) => new Response(null, {status:302, headers:{Location:url, 'Cache-Control':'no-store', ...(cookies ? {'Set-Cookie':cookies} : {})}});
class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }
function need(condition: unknown, status: number, message: string): asserts condition { if (!condition) throw new HttpError(status, message); }
async function session(env: Bindings, hash: string): Promise<Session | null> {
  return env.DB.prepare('SELECT s.*,u.name,u.role FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.hash=? AND s.expires>?').bind(hash, now()).first<Session>();
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
function gateway(env: Bindings, id: string): Gateway {
  let entry: Gateway | undefined;
  try { entry = (JSON.parse(env.NODE_GATEWAYS || '{}') as Record<string, Gateway>)[id]; } catch { /* Fail closed on invalid configuration. */ }
  need(entry && /^https:\/\/[^/]+$/.test(entry.origin) && /^[a-f0-9]{64}$/.test(entry.token) && entry.accessClientId && entry.accessClientSecret, 503, 'Node gateway is not configured');
  const url = new URL(entry.origin);
  need(!url.username && !url.password && !url.port && url.hostname.endsWith('.sargentweb.com'), 503, 'Invalid gateway origin');
  return entry;
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
  const profile = await profileResult.json<{id:string; username:string}>();
  need(/^\d{17,20}$/.test(profile.id), 502, 'Invalid Discord identity');
  const role = profile.id === env.BOOTSTRAP_ADMIN_ID ? 'admin' : 'pending';
  await env.DB.prepare("INSERT INTO users(id,name,role,created) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name, role=CASE WHEN excluded.role='admin' THEN 'admin' ELSE users.role END").bind(profile.id, profile.username.slice(0,100), role, now()).run();
  const sid = randomToken();
  await env.DB.prepare('INSERT INTO sessions(hash,user_id,csrf,expires) VALUES(?,?,?,?)').bind(await digest(sid),profile.id,randomToken(),now()+28800).run();
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
    return {instance_id:s.instance_id,server_name:s.server_name.slice(0,150),status:typeof s.status === 'string' ? s.status.slice(0,40) : 'unknown'};
  });
  await env.DB.batch([
    env.DB.prepare('UPDATE nodes SET last_seen=?,snapshot=? WHERE id=?').bind(now(),JSON.stringify({servers,samples}),id),
    ...samples.map(s => env.DB.prepare('INSERT OR IGNORE INTO samples(node_id,scope,ts,data) VALUES(?,?,?,?)').bind(id,s.scope,s.timestamp,JSON.stringify(s.data)))
  ]);
  return reply({ok:true,interval_seconds:30});
}
type View = {hash:string;session_hash:string;node_id:string;host:string;kind:string;instance:string;expires:number};
async function launch(request: Request, env: Bindings, url: URL) {
  const user = await auth(request,env,'operator');
  const node = url.searchParams.get('node') || '', kind = url.searchParams.get('kind') || 'panel', instance = url.searchParams.get('instance') || '';
  need(request.method === 'POST' && validId(node) && ['panel','vnc','web'].includes(kind) && (kind === 'panel' ? instance === '' : validScope(instance)),422,'Invalid viewer');
  need(await env.DB.prepare('SELECT id FROM nodes WHERE id=? AND enabled=1').bind(node).first(),404,'Node unavailable');
  gateway(env,node);
  const scope = (await digest(node+'/'+kind+'/'+instance)).slice(0,24), host = 'view-'+scope+'.'+new URL(env.APP_ORIGIN).hostname;
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
    need(user && allowed(user.role,'operator'),403,'Viewer access revoked');
    const sid = randomToken();
    await env.DB.prepare('INSERT INTO views(hash,session_hash,node_id,host,kind,instance,expires) VALUES(?,?,?,?,?,?,?)').bind(await digest(sid),view.session_hash,view.node_id,view.host,view.kind,view.instance,Math.min(now()+900,user.expires)).run();
    return redirect(view.kind === 'vnc' ? '/vnc.html?autoconnect=1&resize=remote&encrypt=1&path=websockify' : '/',cookie('__Host-view',sid,900));
  }
  const view = await env.DB.prepare('SELECT v.* FROM views v JOIN nodes n ON n.id=v.node_id WHERE v.hash=? AND v.host=? AND v.expires>? AND n.enabled=1').bind(await digest(cookieValue(request,'__Host-view')),url.hostname,now()).first<View>();
  need(view,401,'Viewer session expired; open it again from the dashboard');
  const user = await session(env,view.session_hash);
  need(user && allowed(user.role,'operator'),403,'Viewer access revoked');
  if (view.kind === 'panel' && request.method === 'GET' && ['console','web_admin'].includes(url.searchParams.get('route') || '')) {
    const instance = url.searchParams.get('instance_id') || '';
    need(validScope(instance),422,'Invalid instance');
    return redirect(env.APP_ORIGIN+'/?'+new URLSearchParams({launch:view.node_id,kind:url.searchParams.get('route') === 'console' ? 'vnc' : 'web',instance}));
  }
  const websocket = request.headers.get('Upgrade')?.toLowerCase() === 'websocket';
  if (websocket || !['GET','HEAD'].includes(request.method)) need(request.headers.get('Origin') === url.origin,403,'Invalid viewer origin');
  const g = gateway(env,view.node_id), headers = gatewayHeaders(g,user);
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
      checking ??= (async()=>{const s=await session(env,view.session_hash);const node=await env.DB.prepare('SELECT id FROM nodes WHERE id=? AND enabled=1').bind(view.node_id).first();checked=now();return !!s&&allowed(s.role,'operator')&&!!node;})();
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
  const user = await auth(request,env,'pending');
  if (url.pathname === '/api/me' && request.method === 'GET') return reply({id:user.user_id,name:user.name,role:user.role,csrf:user.csrf});
  if (url.pathname === '/api/logout' && request.method === 'POST') {
    await env.DB.prepare('DELETE FROM sessions WHERE hash=?').bind(user.hash).run();
    return new Response(null,{status:204,headers:{'Set-Cookie':cookie('__Host-farmservers','',0),'Cache-Control':'no-store'}});
  }
  need(allowed(user.role,'operator'),403,'Administrator or staff access required');
  if (url.pathname === '/api/nodes' && request.method === 'GET') {
    const {results} = await env.DB.prepare('SELECT id,name,enabled,last_seen,snapshot FROM nodes ORDER BY name').all<{id:string;name:string;enabled:number;last_seen:number|null;snapshot:string|null}>();
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
    need(validId(body.node) && validScope(body.instance_id) && ['start','stop','restart','backend_reboot','logs'].includes(String(body.action)),422,'Invalid action');
    need(await env.DB.prepare('SELECT id FROM nodes WHERE id=? AND enabled=1').bind(body.node).first(),404,'Node unavailable');
    const g = gateway(env,body.node), headers = gatewayHeaders(g,user);
    headers.set('Content-Type','application/json');
    await audit(env,user.user_id,'server.'+body.action,body.node+'/'+body.instance_id);
    const result = await fetch(g.origin+'/?route=api_node_server_action',{method:'POST',headers,body:JSON.stringify({instance_id:body.instance_id,action:body.action}),redirect:'manual',signal:AbortSignal.timeout(60000)});
    need(result.headers.get('Content-Type')?.includes('application/json'),502,'Node gateway returned an unexpected response');
    return new Response(result.body,{status:result.status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
  }
  need(allowed(user.role,'admin'),403,'Administrator access required');
  if (url.pathname === '/api/users' && request.method === 'GET') return reply((await env.DB.prepare('SELECT id,name,role,created FROM users ORDER BY created DESC').all()).results);
  if (url.pathname === '/api/audit' && request.method === 'GET') return reply((await env.DB.prepare('SELECT * FROM audit ORDER BY id DESC LIMIT 100').all()).results);
  if (url.pathname === '/api/users' && request.method === 'POST') {
    const body = await readJson(request,4096);
    need(typeof body.id === 'string' && /^\d{17,20}$/.test(body.id) && roles.includes(body.role as Role),422,'Invalid user or role');
    need(body.id !== env.BOOTSTRAP_ADMIN_ID,409,'The initial administrator is managed in Worker configuration');
    await env.DB.batch([env.DB.prepare('UPDATE users SET role=? WHERE id=?').bind(body.role,body.id),env.DB.prepare('DELETE FROM sessions WHERE user_id=?').bind(body.id)]);
    await audit(env,user.user_id,'user.'+body.role,body.id);
    return reply({ok:true});
  }
  if (url.pathname === '/api/nodes' && request.method === 'POST') {
    const body = await readJson(request,4096);
    need(validId(body.id) && typeof body.name === 'string' && body.name.length>0 && body.name.length<=100,422,'Invalid node');
    const token = randomToken();
    await env.DB.prepare('INSERT INTO nodes(id,name,token_hash) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,token_hash=excluded.token_hash,enabled=1').bind(body.id,body.name,await digest(token)).run();
    await audit(env,user.user_id,'node.enroll-or-rotate',body.id);
    return reply({id:body.id,token,notice:'Save this token on the node; it is shown only once.'});
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
      if (url.hostname.endsWith('.'+new URL(env.APP_ORIGIN).hostname) && /^view-[a-f0-9]{24}\./.test(url.hostname)) return await viewer(request,env,url);
      need(url.origin === env.APP_ORIGIN,404,'Unknown host');
      let response: Response;
      if (url.pathname.startsWith('/auth/')) response = await oauth(request,env,url);
      else if (url.pathname.startsWith('/api/')) response = await api(request,env,url);
      else {
        need(['GET','HEAD'].includes(request.method),405,'Method not allowed');
        // The bootstrap must remain reachable by fresh Ubuntu hosts. Everything
        // else except sign-in assets requires a current approved staff session.
        if (['/style.css','/login.js','/install.py'].includes(url.pathname)) response=await env.ASSETS.fetch(request);
        else {
          const user=await session(env,await digest(cookieValue(request,'__Host-farmservers')));
          if (!user || !allowed(user.role,'operator')) response=loginPage(!!user);
          else {
            response=await env.ASSETS.fetch(request);
            response=new Response(response.body,{status:response.status,headers:response.headers});
            response.headers.set('Cache-Control','no-store');
            response.headers.set('Vary','Cookie');
          }
        }
      }
      const headers = new Headers(response.headers);
      headers.set('X-Content-Type-Options','nosniff');
      headers.set('Referrer-Policy','no-referrer');
      headers.set('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
      headers.set('Strict-Transport-Security','max-age=31536000');
      return new Response(response.body,{status:response.status,headers});
    } catch (error) {
      return reply({error:error instanceof HttpError ? error.message : 'Request failed; check service configuration'},error instanceof HttpError ? error.status : 500);
    }
  },
  async scheduled(_event: ScheduledController, env: Bindings) {
    await env.DB.batch([
      ...['oauth_states','sessions','tickets','views'].map(table => env.DB.prepare(`DELETE FROM ${table} WHERE expires<?`).bind(now())),
      env.DB.prepare('DELETE FROM samples WHERE ts<?').bind(now()-30*86400),
      env.DB.prepare('DELETE FROM audit WHERE ts<?').bind(now()-90*86400)
    ]);
  }
} satisfies ExportedHandler<Bindings>;
