import {digest,randomToken,readJson} from './security';
import {openToken,sealToken} from './node-tokens';
type Store={DB:D1Database;NODE_TOKEN_KEY:string;APP_ORIGIN?:string};
type Client={id:string;secret:string;scopes:string};
type Tokens={access_token:string;refresh_token:string;expires_in:number;token_type:string};
export class OAuthRefreshBusy extends Error {}
const now=()=>Math.floor(Date.now()/1000);
const reply=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
const landing=(status:string)=>new Response(null,{status:303,headers:{Location:'/cloudflare?oauth='+status,'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
const callback=(env:Store)=>env.APP_ORIGIN+'/api/cloudflare/oauth/callback';
async function client(env:Store):Promise<Client|null>{
  const row=await env.DB.prepare('SELECT encrypted FROM cloudflare_oauth_client WHERE id=1').first<{encrypted:string}>();
  return row?JSON.parse(await openToken(env.NODE_TOKEN_KEY,'cloudflare-oauth-client',row.encrypted)):null;
}
async function exchange(c:Client,body:Record<string,string>):Promise<Tokens>{
  const response=await fetch('https://dash.cloudflare.com/oauth2/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded',Authorization:'Basic '+btoa(encodeURIComponent(c.id)+':'+encodeURIComponent(c.secret))},body:new URLSearchParams(body),redirect:'manual',signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw new Error('Cloudflare authorization expired or was rejected. Reconnect with Cloudflare.');
  const tokens=await response.json<Tokens>();
  if(typeof tokens.access_token!=='string'||!tokens.access_token||!Number.isFinite(tokens.expires_in)||tokens.expires_in<=0||tokens.token_type?.toLowerCase()!=='bearer')throw new Error('Cloudflare returned invalid authorization credentials.');
  return tokens;
}
export async function oauthAccessToken(env:Store):Promise<string>{
  const row=await env.DB.prepare('SELECT encrypted,expires FROM cloudflare_oauth_tokens WHERE id=1').first<{encrypted:string;expires:number}>();
  if(!row)throw new Error('Reconnect with Cloudflare to resume automation.');
  if(row.expires>now()+120)return (JSON.parse(await openToken(env.NODE_TOKEN_KEY,'cloudflare-oauth-tokens',row.encrypted)) as Tokens).access_token;
  const lease=crypto.randomUUID();
  const locked=await env.DB.prepare('UPDATE cloudflare_oauth_tokens SET lease=?,lease_until=? WHERE id=1 AND lease_until<? RETURNING encrypted,expires').bind(lease,now()+60,now()).first<{encrypted:string;expires:number}>();
  if(!locked)throw new OAuthRefreshBusy('Cloudflare authorization is refreshing. Try again shortly.');
  try{
    const previous=JSON.parse(await openToken(env.NODE_TOKEN_KEY,'cloudflare-oauth-tokens',locked.encrypted)) as Tokens;
    if(locked.expires>now()+120)return previous.access_token;
    const c=await client(env);if(!c||!previous.refresh_token)throw new Error('Reconnect with Cloudflare to resume automation.');
    const next=await exchange(c,{grant_type:'refresh_token',refresh_token:previous.refresh_token});
    next.refresh_token=next.refresh_token||previous.refresh_token;
    const saved=await env.DB.prepare('UPDATE cloudflare_oauth_tokens SET encrypted=?,expires=? WHERE id=1 AND lease=? RETURNING id').bind(await sealToken(env.NODE_TOKEN_KEY,'cloudflare-oauth-tokens',JSON.stringify(next)),now()+next.expires_in,lease).first();
    if(!saved)throw new Error('Cloudflare connection changed; retry.');
    return next.access_token;
  }finally{await env.DB.prepare('UPDATE cloudflare_oauth_tokens SET lease=NULL,lease_until=0 WHERE id=1 AND lease=?').bind(lease).run();}
}
export async function cloudflareOAuth(request:Request,env:Store,sessionHash:string){
  const url=new URL(request.url),path=url.pathname;
  try{
    if(path.endsWith('/status')&&request.method==='GET'){
      const c=await client(env),tokens=await env.DB.prepare('SELECT expires FROM cloudflare_oauth_tokens WHERE id=1').first();
      return reply({configured:!!c,connected:!!tokens,clientId:c?.id||'',scopes:c?.scopes||'',callback:callback(env)});
    }
    if(path.endsWith('/client')&&request.method==='POST'){
      const body=await readJson(request,8192),previous=await client(env);
      if(typeof body.clientId!=='string'||!body.clientId.trim()||body.clientId.length>256||typeof body.clientSecret!=='string'||body.clientSecret.length>2048||typeof body.scopes!=='string'||!body.scopes.trim()||body.scopes.length>2048||/[\r\n]/.test(body.clientId+body.clientSecret+body.scopes))return reply({error:'Enter the registered Client ID, Client Secret and exact OAuth scopes.'},422);
      const secret=body.clientSecret||(previous?.id===body.clientId.trim()?previous.secret:'');
      if(!secret)return reply({error:'A Client Secret is required for a new client.'},422);
      const c={id:body.clientId.trim(),secret,scopes:Array.from(new Set((body.scopes+' offline_access').trim().split(/\s+/))).join(' ')};
      const saved=await env.DB.prepare('SELECT encrypted FROM cloudflare_settings WHERE id=1').first<{encrypted:string}>();
      const usingOAuth=saved && JSON.parse(await openToken(env.NODE_TOKEN_KEY,'cloudflare-settings',saved.encrypted)).oauth;
      await env.DB.batch([env.DB.prepare('INSERT INTO cloudflare_oauth_client(id,encrypted) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET encrypted=excluded.encrypted').bind(await sealToken(env.NODE_TOKEN_KEY,'cloudflare-oauth-client',JSON.stringify(c))),env.DB.prepare('DELETE FROM cloudflare_oauth_states'),env.DB.prepare('DELETE FROM cloudflare_oauth_tokens'),...(usingOAuth?[env.DB.prepare('UPDATE cloudflare_settings SET enabled=0 WHERE id=1')]:[])]);
      return reply({ok:true});
    }
    if(path.endsWith('/start')&&request.method==='POST'){
      const c=await client(env);if(!c)return reply({error:'Register the Cloudflare OAuth client first.'},409);
      const state=randomToken(),verifier=randomToken();
      await env.DB.prepare('DELETE FROM cloudflare_oauth_states WHERE expires<? OR session_hash=?').bind(now(),sessionHash).run();
      await env.DB.prepare('INSERT INTO cloudflare_oauth_states VALUES(?,?,?,?)').bind(await digest(state),sessionHash,verifier,now()+600).run();
      const challenge=btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier))))).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
      const target=new URL('https://dash.cloudflare.com/oauth2/auth');target.search=new URLSearchParams({client_id:c.id,response_type:'code',redirect_uri:callback(env),scope:c.scopes,state,code_challenge:challenge,code_challenge_method:'S256',prompt:'consent'}).toString();
      return reply({url:target.href});
    }
    if(path.endsWith('/callback')&&request.method==='GET'){
      const state=url.searchParams.get('state')||'';
      if(!/^[a-f0-9]{64}$/.test(state))return landing('invalid');
      const pending=await env.DB.prepare('DELETE FROM cloudflare_oauth_states WHERE hash=? AND session_hash=? AND expires>? RETURNING verifier').bind(await digest(state),sessionHash,now()).first<{verifier:string}>();
      if(!pending)return landing('invalid');
      if(url.searchParams.has('error')){
        // Provider errors are not necessarily cancellations. Never reflect arbitrary
        // callback descriptions, codes, or credentials into the redirected page.
        const errors:Record<string,string>={access_denied:'access-denied',invalid_scope:'invalid-scope',invalid_client:'invalid-client',unauthorized_client:'unauthorized-client',invalid_request:'invalid-request',unsupported_response_type:'invalid-response-type',server_error:'provider-unavailable',temporarily_unavailable:'provider-unavailable',login_required:'login-required',consent_required:'consent-required'};
        return landing(errors[url.searchParams.get('error')||'']||'provider-error');
      }
      const code=url.searchParams.get('code'),c=await client(env);if(!code||code.length>4096||!c)return landing('invalid');
      const tokens=await exchange(c,{grant_type:'authorization_code',code,redirect_uri:callback(env),code_verifier:pending.verifier});
      if(!tokens.refresh_token)return landing('offline-required');
      const headers={Authorization:'Bearer '+tokens.access_token};
      const response=await fetch('https://api.cloudflare.com/client/v4/zones?name=sargentweb.com&status=active&per_page=50',{headers,redirect:'manual',signal:AbortSignal.timeout(15000)});
      const zones=await response.json<{success:boolean;result:{id:string;name:string;account:{id:string}}[]}>();
      if(!response.ok||!zones.success||zones.result.length!==1||zones.result[0].name!=='sargentweb.com')return landing('zone-unavailable');
      const zone=zones.result[0];if(!/^[a-f0-9]{32}$/.test(zone.id)||!/^[a-f0-9]{32}$/.test(zone.account.id))return landing('zone-unavailable');
      const existing=await env.DB.prepare('SELECT encrypted FROM cloudflare_settings WHERE id=1').first<{encrypted:string}>();
      if(existing){const previous=JSON.parse(await openToken(env.NODE_TOKEN_KEY,'cloudflare-settings',existing.encrypted));if((previous.account!==zone.account.id||previous.zone!==zone.id)&&await env.DB.prepare('SELECT node_id FROM node_connections LIMIT 1').first())return landing('account-mismatch');}
      // Check API access before replacing a working connection. Write permissions are enforced by each provisioning step.
      for(const path of ['/accounts/'+zone.account.id+'/cfd_tunnel?per_page=1','/zones/'+zone.id+'/access/apps?per_page=1','/accounts/'+zone.account.id+'/access/service_tokens?per_page=1','/zones/'+zone.id+'/dns_records?per_page=1']){
        const check=await fetch('https://api.cloudflare.com/client/v4'+path,{headers,redirect:'manual',signal:AbortSignal.timeout(15000)});
        if(!check.ok||(await check.json<{success:boolean}>()).success!==true)return landing('permissions');
      }
      const value={account:zone.account.id,zone:zone.id,domain:zone.name,token:'',oauth:true};
      await env.DB.batch([env.DB.prepare('INSERT INTO cloudflare_oauth_tokens(id,encrypted,expires) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET encrypted=excluded.encrypted,expires=excluded.expires,lease=NULL,lease_until=0').bind(await sealToken(env.NODE_TOKEN_KEY,'cloudflare-oauth-tokens',JSON.stringify(tokens)),now()+tokens.expires_in),env.DB.prepare('INSERT INTO cloudflare_settings(id,encrypted,enabled) VALUES(1,?,1) ON CONFLICT(id) DO UPDATE SET encrypted=excluded.encrypted,enabled=1').bind(await sealToken(env.NODE_TOKEN_KEY,'cloudflare-settings',JSON.stringify(value))),env.DB.prepare('INSERT INTO audit(ts,actor,action,target) SELECT ?,user_id,?,? FROM sessions WHERE hash=?').bind(now(),'cloudflare.connect',zone.account.id,sessionHash)]);
      return landing('connected');
    }
    if(path.endsWith('/disconnect')&&request.method==='POST'){
      const row=await env.DB.prepare('SELECT encrypted FROM cloudflare_oauth_tokens WHERE id=1').first<{encrypted:string}>(),c=await client(env);
      let revoked=!row;
      if(row&&c){
        try{
          const tokens=JSON.parse(await openToken(env.NODE_TOKEN_KEY,'cloudflare-oauth-tokens',row.encrypted)) as Tokens;
          const response=await fetch('https://dash.cloudflare.com/oauth2/revoke',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded',Authorization:'Basic '+btoa(encodeURIComponent(c.id)+':'+encodeURIComponent(c.secret))},body:new URLSearchParams({token:tokens.refresh_token||tokens.access_token,token_type_hint:tokens.refresh_token?'refresh_token':'access_token'}),redirect:'manual',signal:AbortSignal.timeout(15000)});
          revoked=response.ok;
        }catch{ /* Disconnect locally even if Cloudflare is unavailable. */ }
      }
      await env.DB.batch([env.DB.prepare('DELETE FROM cloudflare_oauth_tokens'),env.DB.prepare('DELETE FROM cloudflare_oauth_states'),env.DB.prepare('UPDATE cloudflare_settings SET enabled=0 WHERE id=1')]);
      return reply({ok:true,revoked});
    }
    return reply({error:'Not found'},404);
  }catch{return path.endsWith('/callback')?landing('failed'):reply({error:'Cloudflare authorization could not complete. Check the registered client and reconnect.'},503);}
}
