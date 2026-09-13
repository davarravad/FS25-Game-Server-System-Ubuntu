import {readGateway, type Gateway} from './gateways';
import {openToken} from './node-tokens';
import {consoleProbePath,hostnameResolves} from './cloudflare';

// Fleet readiness: one report answering "can every game server on every node be opened through
// the main-site game admin panel and VNC console right now, and if not, what needs doing?"
// The check itself changes nothing; each finding that is not a pass carries the repair that
// fixes it, either an API call the page can make or a link to where it is done.
type Env={DB:D1Database;NODE_TOKEN_KEY:string;NODE_GATEWAYS?:string;BOOTSTRAP_ADMIN_ID:string};
export type Repair={label:string;api?:string;body?:Record<string,unknown>;href?:string;confirm?:string};
export type Check={name:string;state:'pass'|'warn'|'fail';detail:string;repair?:Repair};
export type ServerReport={instance_id:string;server_name:string;checks:Check[]};
export type NodeReport={id:string;name:string;online:boolean;checks:Check[];servers:ServerReport[]};
type ContainerState={exists:boolean;running:boolean;status:string;management_network:boolean;admin_ports_loopback:boolean;exposed_admin_ports:string[]};
type PortProtocolCheck={proto:string;published:boolean;actual_ports:string[];firewall_ok:boolean|null};
type PortCheck={label:string;port:number;protocols:PortProtocolCheck[]};
type Container=ContainerState&{sftp?:ContainerState|null;port_checks?:PortCheck[]};
type NodeServers={ok:boolean;servers:{instance_id:string;server_name:string;is_enabled:boolean;container:Container|null}[]};
type Endpoint={host:string;node_id:string;instance:string;kind:string;ready:number};

const PORT_CHECK_LABELS:Record<string,string>={game:'Game port',web:'Web admin port',tls:'TLS port',sftp:'SFTP port'};
const check=(name:string,state:Check['state'],detail:string,repair?:Repair):Check=>repair&&state!=='pass'?{name,state,detail,repair}:{name,state,detail};
const compareVersions=(a:string,b:string)=>{const x=a.replace(/^v/,'').split('.').map(Number),y=b.replace(/^v/,'').split('.').map(Number);return (x[0]-y[0])||(x[1]-y[1])||(x[2]-y[2]);};
async function probe(url:string,init:RequestInit,ms:number):Promise<Response|null>{
  try{return await fetch(url,{...init,redirect:'manual',signal:AbortSignal.timeout(ms)});}catch{return null;}
}

export async function fleetReadiness(env:Env,actor:string):Promise<{generated:number;nodes:NodeReport[]}>{
  const now=Math.floor(Date.now()/1000);
  const latest=(await env.DB.prepare('SELECT version FROM releases WHERE enabled=1').all<{version:string}>()).results.map(r=>r.version).sort(compareVersions).pop()||null;
  const nodes=(await env.DB.prepare('SELECT id,name,last_seen,snapshot,installed_version FROM nodes WHERE enabled=1 ORDER BY name LIMIT 50').all<{id:string;name:string;last_seen:number|null;snapshot:string|null;installed_version:string|null}>()).results;
  const endpoints=(await env.DB.prepare('SELECT host,node_id,instance,kind,ready FROM game_endpoints').all<Endpoint>()).results;
  // Nodes are checked concurrently; each node's probes stay sequential so one slow node cannot
  // multiply its own subrequests.
  const report=await Promise.all(nodes.map(async node=>{
    const checks:Check[]=[],servers:ServerReport[]=[];
    const online=node.last_seen!==null&&now-node.last_seen<120;
    const connectionTab:Repair={label:'Open Connection & access',href:'/nodes/'+encodeURIComponent(node.id)+'?tab=connection'};
    const cloudflarePage:Repair={label:'Open the Cloudflare page',href:'/cloudflare'};
    const bypassRepair:Repair={label:'Create console bypass now',api:'readiness/repair',body:{node:node.id,action:'console-bypass'}};
    const behind=!!latest&&(!node.installed_version||compareVersions(node.installed_version,latest)<0);
    const updateRepair:Repair|undefined=behind?{label:(node.installed_version?'Queue update to ':'Install release ')+latest,api:'distribution/updates',body:{node:node.id,version:latest},confirm:'Update '+node.name+' to '+latest+'? Running games stay up; control-panel sessions may disconnect briefly.'}:undefined;
    const noInspection=behind?'Update it to a release with readiness support.':'The installed release does not include readiness inspection; publish a release that does, then update the node.';

    let gateway:Gateway|null=null;
    try{gateway=(await readGateway(env,node.id)).gateway;}catch{ /* Reported below as a failed check. */ }
    checks.push(gateway?check('Cloudflare connection','pass','Gateway credentials are saved.'):check('Cloudflare connection','fail','No gateway saved. Enable Cloudflare automation and let the node connect.',connectionTab));

    const connection=await env.DB.prepare('SELECT encrypted,stage,error FROM node_connections WHERE node_id=?').bind(node.id).first<{encrypted:string;stage:string;error:string|null}>();
    if(!connection)checks.push(check('Access application','warn','No automated connection record, so the console bypass application cannot be confirmed from records; the live probe below is authoritative.',cloudflarePage));
    else if(connection.error)checks.push(check('Access application','fail','Connection setup error: '+connection.error,{label:'Retry setup on the Cloudflare page',href:'/cloudflare'}));
    else{
      let consoleAppId:string|undefined;
      try{consoleAppId=(JSON.parse(await openToken(env.NODE_TOKEN_KEY,'connection:'+node.id,connection.encrypted)) as {consoleAppId?:string}).consoleAppId;}catch{ /* Treated as not recorded. */ }
      checks.push(connection.stage!=='ready'?check('Access application','warn','Connection setup is at stage "'+connection.stage+'".',cloudflarePage):consoleAppId?check('Access application','pass','Node application and console bypass application are recorded.'):check('Access application','warn','Console bypass application is not recorded yet; it is created on the node\'s next connection poll.',bypassRepair));
    }

    let nodeServers:NodeServers|null=null;
    if(gateway){
      const headers={'X-Central-Token':gateway.token,'X-Central-User':actor,'X-Central-Role':'admin','CF-Access-Client-Id':gateway.accessClientId,'CF-Access-Client-Secret':gateway.accessClientSecret};
      const health=await probe(gateway.origin+'/?route=api_central_health',{headers},10000);
      let identity:string|undefined;
      try{identity=health?.ok?(await health.json<{node:string}>()).node:undefined;}catch{ /* Non-JSON answer counts as unreachable. */ }
      checks.push(identity===node.id?check('Gateway reachable','pass','The node answered through its tunnel.'):check('Gateway reachable','fail',health?'HTTP '+health.status+' from the gateway.':'No answer from the gateway within 10 seconds.',connectionTab));

      // Without Access credentials the request must get past Access and be refused by the node's
      // own gateway-token check (403). A 401 or redirect means Access still challenges this path.
      const bypass=await probe(gateway.origin+consoleProbePath,{headers:{Upgrade:'websocket'}},10000);
      checks.push(bypass?.status===403?check('Console path bypass','pass','Access lets console sockets through; the node still requires the gateway token.'):check('Console path bypass','fail',bypass?'Access answered HTTP '+bypass.status+' on the console socket path; the bypass application is missing or not effective.':'No answer on the console socket path.',bypassRepair));

      const inspect=await probe(gateway.origin+'/?route=api_node_readiness',{headers},30000);
      try{
        const data=inspect?.ok&&(inspect.headers.get('Content-Type')||'').includes('application/json')?await inspect.json<NodeServers>():null;
        if(data?.ok&&Array.isArray(data.servers))nodeServers=data;
        else checks.push(check('Server inspection','warn',(inspect?'The node answered without a container report (HTTP '+inspect.status+'). ':'The node did not answer the readiness query. ')+noInspection,updateRepair));
      }catch{checks.push(check('Server inspection','warn','The node returned an unreadable readiness answer. '+noInspection,updateRepair));}
    }

    checks.push(!latest?check('Node software','warn','No release has been published yet.'):!node.installed_version?check('Node software','warn','Installed version not reported yet; a successful managed update records it.',updateRepair):compareVersions(node.installed_version,latest)>=0?check('Node software','pass','Running '+node.installed_version+'.'):check('Node software','warn','Running '+node.installed_version+'; '+latest+' is available.',updateRepair));

    const snapshot=(node.snapshot?(JSON.parse(node.snapshot) as {servers?:{instance_id:string;server_name:string}[]}).servers||[]:[]);
    const listed=nodeServers?nodeServers.servers:snapshot.map(s=>({instance_id:s.instance_id,server_name:s.server_name,is_enabled:true,container:null as Container|null}));
    for(const server of listed){
      const sc:Check[]=[];
      const recreate:Repair={label:'Recreate server container',api:'nodes/apply-updates',body:{node:node.id,instance_id:server.instance_id},confirm:'Recreate the container for '+server.server_name+'? The game server restarts and its players are disconnected.'};
      if(nodeServers){
        const c=server.container;
        if(!c||!c.exists)sc.push(check('Container','fail','No container found; create or reinstall this server.',{label:'Open server',href:'/servers/'+encodeURIComponent(node.id)+'/'+encodeURIComponent(server.instance_id)}));
        else{
          sc.push(c.running?check('Container','pass','Running.'):check('Container','warn','Container is '+c.status+'; start the server before opening its panels.',{label:'Start server',api:'action',body:{node:node.id,instance_id:server.instance_id,action:'start'}}));
          sc.push(c.management_network?check('Management network','pass','Reachable from the node gateway.'):check('Management network','fail','Not attached to fsg-management, so the gateway cannot reach it. Recreating the container attaches it.',recreate));
          sc.push(c.admin_ports_loopback?check('Admin ports','pass','Published on loopback only.'):check('Admin ports','fail','Published publicly: '+c.exposed_admin_ports.join(', ')+'. Recreating the container binds them to loopback.',recreate));

          if(c.sftp)sc.push(!c.sftp.exists?check('SFTP container','fail','No SFTP container found; recreating this server creates it.',recreate):c.sftp.running?check('SFTP container','pass','Running.'):check('SFTP container','warn','Container is '+c.sftp.status+'; SFTP uploads will fail until it is running.',recreate));

          // Each public port (game, web admin, TLS, SFTP) is checked against what its container
          // actually publishes right now, not just what settings say: a port edited after the
          // container was created stays on the old value until the container is recreated.
          for(const pc of c.port_checks||[]){
            const label=PORT_CHECK_LABELS[pc.label]||pc.label;
            const notPublished=pc.protocols.filter(p=>!p.published);
            const notFirewalled=pc.protocols.filter(p=>p.published&&p.firewall_ok===false);
            if(notPublished.length){
              const actual=[...new Set(notPublished.flatMap(p=>p.actual_ports))];
              sc.push(check(label,'fail','Configured for '+pc.port+' ('+notPublished.map(p=>p.proto).join('/')+') but the container publishes '+(actual.length?actual.join(', '):'nothing')+'. Recreating the server applies the configured port.',recreate));
            }else if(notFirewalled.length){
              sc.push(check(label,'fail','Published on '+pc.port+' as configured, but the host firewall does not allow it yet ('+notFirewalled.map(p=>p.proto).join('/')+'). Recreating the server reopens the firewall.',recreate));
            }else{
              sc.push(check(label,'pass','Published on '+pc.port+' as configured.'));
            }
          }
        }
      }
      sc.push(...await Promise.all(([['vnc','VNC console'],['web','Game admin']] as const).map(async([kind,label])=>{
        const endpoint=endpoints.find(e=>e.node_id===node.id&&e.instance===server.instance_id&&e.kind===kind);
        const provision=(text:string):Repair=>({label:text,api:'readiness/repair',body:{node:node.id,action:'provision-hostname',instance:server.instance_id,kind}});
        if(!endpoint)return check(label,'warn','Hostname not created yet; it is provisioned automatically within a few minutes of the server appearing, or now with the button.',provision('Provision hostname now'));
        if(!endpoint.ready)return check(label,'warn',endpoint.host+' is waiting for Cloudflare DNS.',provision('Re-check DNS'));
        return await hostnameResolves(endpoint.host)?check(label,'pass',endpoint.host+' resolves over IPv4 and IPv6.'):check(label,'fail',endpoint.host+' does not resolve on both IPv4 and IPv6 yet. Cloudflare publishes custom-domain DNS on a lag; re-check in a few minutes.',provision('Re-check DNS'));
      })));
      servers.push({instance_id:server.instance_id,server_name:server.server_name,checks:sc});
    }
    return {id:node.id,name:node.name,online,checks,servers};
  }));
  return {generated:now,nodes:report};
}
