import {publicIPv4,readJson,validId,validScope} from './security';
import type {Gateway} from './gateways';

// True when a server operation's reported access host is missing, or is a private/loopback IPv4
// literal (e.g. an unset or misconfigured Access Host/IP on the node) rather than a usable public
// address or hostname. A hostname or a genuine public IPv4 is left alone.
function unusablePublicHost(host:string):boolean{
  if(!host)return true;
  return /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)&&!publicIPv4(host);
}

const operations:Record<string,{method:string;admin:boolean}>=Object.fromEntries([
  ...['inventory','live'].map(name=>[name,{method:'GET',admin:false}]),
  ...['server','files','export'].map(name=>[name,{method:'GET',admin:true}]),
  ['command',{method:'POST',admin:false}],
  ...['create','save','host-save','prepare','unzip','reinstall','delete','upload'].map(name=>[name,{method:'POST',admin:true}])
]);
const response=(error:string,status:number)=>Response.json({error},{status,headers:{'Cache-Control':'no-store'}});
export async function management(request:Request,user:{user_id:string;role:string},resolveGateway:(node:string)=>Promise<Gateway>,audit:(action:string,target:string)=>Promise<void>,getPublicIp:(node:string)=>Promise<string|null>){
  const url=new URL(request.url),node=url.searchParams.get('node')||'',operation=url.searchParams.get('operation')||'',policy=operations[operation];
  if(!validId(node)||!policy)return response('Unknown node management operation',422);
  if(!['admin','operator'].includes(user.role)||policy.admin&&user.role!=='admin')return response('Administrator access required',403);
  if(request.method!==policy.method)return response('Method not allowed',405);
  const instance=url.searchParams.get('instance_id')||'';
  if(instance&&!validScope(instance))return response('Invalid instance ID',422);
  const g=await resolveGateway(node);
  const target=new URL(g.origin);target.search=new URLSearchParams({route:'api_central_manage',operation}).toString();
  for(const key of ['instance_id','target','subpath','filename','offset','total_size','is_last','include_docker_logs','include_sftp_logs','include_game_log']){
    const value=url.searchParams.get(key);if(value!==null){if(value.length>1024)return response('Management parameter too long',422);target.searchParams.set(key,value);}
  }
  const headers=new Headers({'X-Central-Token':g.token,'X-Central-User':user.user_id,'X-Central-Role':user.role,'CF-Access-Client-Id':g.accessClientId,'CF-Access-Client-Secret':g.accessClientSecret});
  let body:BodyInit|undefined;
  if(operation==='upload'){
    // Buffer only one bounded chunk, never the complete game installer.
    const reader=request.body?.getReader();const chunks:Uint8Array[]=[];let size=0;
    if(reader)try{while(true){const next=await reader.read();if(next.done)break;size+=next.value.length;if(size>4*1024*1024){await reader.cancel();return response('Upload chunk exceeds 4 MiB',413);}chunks.push(next.value);}}finally{reader.releaseLock();}
    const data=new Uint8Array(size);let position=0;for(const chunk of chunks){data.set(chunk,position);position+=chunk.length;}
    body=data;headers.set('Content-Type','application/octet-stream');
  }else if(request.method==='POST'){
    const data=await readJson(request,32768),form=new URLSearchParams();
    for(const [key,value] of Object.entries(data)){
      if(!['string','number','boolean'].includes(typeof value))return response('Invalid form value',422);
      form.set(key,String(value));
    }
    if(instance)form.set('instance_id',instance);
    body=form.toString();headers.set('Content-Type','application/x-www-form-urlencoded');
  }
  if(request.method==='POST'||operation==='export'||user.role==='admin'&&['server','inventory'].includes(operation))await audit('management.'+operation,node+'/'+instance);
  let upstream:Response;
  try{upstream=await fetch(target,{method:request.method,headers,body,redirect:'manual',signal:AbortSignal.timeout(120000)});}
  catch{return response('The node did not finish responding. Check its status before retrying a change.',504);}
  const type=upstream.headers.get('Content-Type')||'';
  if(operation!=='export'&&!type.includes('application/json'))return response('This node needs the latest software release, or its tunnel is unavailable. Update it from Node software and check Cloudflare connection status.',502);
  if(upstream.status>=300&&upstream.status<400)return response('The node redirected the request. Update its software and check its tunnel.',502);
  const outgoing=new Headers({'Content-Type':operation==='export'?'application/vnd.ms-excel':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
  if(operation==='export')outgoing.set('Content-Disposition','attachment; filename="'+node+'-servers.xml"');
  if(operation==='server'){
    // Fill in the node's last-observed public IP when its configured Access Host/IP is unset or
    // is a private-range address, so SFTP (and other direct-connect) links stay reachable without
    // the admin having to hand-enter or maintain that field themselves.
    const data=await upstream.json().catch(()=>null) as {access?:{host?:string;sftp_url?:string};server?:{sftp_port?:number}}|null;
    if(!data)return response('This node needs the latest software release, or its tunnel is unavailable. Update it from Node software and check Cloudflare connection status.',502);
    if(data.access&&unusablePublicHost(String(data.access.host||''))){
      const ip=await getPublicIp(node);
      if(ip){
        data.access.host=ip;
        const port=Number(data.server?.sftp_port);
        if(Number.isInteger(port)&&port>0&&port<=65535)data.access.sftp_url='sftp://'+ip+':'+port;
      }
    }
    return new Response(JSON.stringify(data),{status:upstream.status,headers:outgoing});
  }
  // Never forward node cookies or internal gateway headers into the main site.
  return new Response(upstream.body,{status:upstream.status,headers:outgoing});
}
