import {openToken, sealToken} from './node-tokens';

export type Gateway = {origin:string;token:string;accessClientId:string;accessClientSecret:string};
type Store = {DB:D1Database;NODE_TOKEN_KEY:string;NODE_GATEWAYS?:string};
export function validGateway(value: unknown): value is Gateway {
  if (!value || typeof value !== 'object') return false;
  const g=value as Gateway;
  if (typeof g.origin!=='string' || !/^https:\/\/[^/]+$/.test(g.origin) || !/^[a-f0-9]{64}$/.test(g.token)) return false;
  try {
    const u=new URL(g.origin);
    if(u.username || u.password || u.port || u.search || u.hash || u.pathname!=='/' || !u.hostname.endsWith('.sargentweb.com'))return false;
  } catch {return false;}
  return [g.accessClientId,g.accessClientSecret].every(v=>typeof v==='string' && v.trim().length>0 && v.length<=2048 && !/[\r\n]/.test(v) && !v.startsWith('REPLACE_'));
}
export async function readGateway(env:Store,id:string):Promise<{gateway:Gateway|null;source:string}> {
  const row=await env.DB.prepare('SELECT gateway_encrypted FROM nodes WHERE id=?').bind(id).first<{gateway_encrypted:string|null}>();
  if(row?.gateway_encrypted){
    const gateway:unknown=JSON.parse(await openToken(env.NODE_TOKEN_KEY,'gateway:'+id,row.gateway_encrypted));
    if(!validGateway(gateway))throw new Error('Invalid stored gateway');
    return {gateway,source:'database'};
  }
  try {
    const value=JSON.parse(env.NODE_GATEWAYS || '{}')?.[id];
    if(validGateway(value))return {gateway:value,source:'legacy'};
  }catch { /* An invalid legacy secret must not prevent configuring nodes. */ }
  return {gateway:null,source:'missing'};
}
export async function saveGateway(env:Store,id:string,gateway:Gateway){
  const encrypted=await sealToken(env.NODE_TOKEN_KEY,'gateway:'+id,JSON.stringify(gateway));
  await env.DB.prepare('UPDATE nodes SET gateway_encrypted=? WHERE id=?').bind(encrypted,id).run();
}
