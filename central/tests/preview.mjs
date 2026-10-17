// Local-only visual fixture. Synthetic data; never deployed with public assets.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
const jobs=process.env.PREVIEW_UPDATES==='1'?Array.from({length:30},(_,i)=>({id:'job-'+String(i).padStart(3,'0'),node_id:i%2?'north':'pilot',node_name:i%2?'North farm':'Ubuntu pilot',version:'v1.0.0',status:['queued','running','succeeded','failed'][i%4],created:1800000000-i,updated:1800000000-i})):[];
const nodeNotes=new Map();
const notices=[{id:'offline:north:fixture',title:'North farm is offline',detail:'No heartbeat received in the last two minutes.',href:'/nodes/north',severity:'warning',read:false},{id:'release:v1.0.0',title:'Release available: v1.0.0',detail:'Open a node to review the available update.',href:'/setup',severity:'info',read:false}];
const time=Math.floor(Date.now()/1000);
const nodes=[
  {id:'pilot',name:'Ubuntu pilot',enabled:1,online:true,last_seen:time,snapshot:{samples:[{scope:'host',data:{cpu_percent:21.5,memory_used_bytes:8589934592}},{scope:'game-1',timestamp:time,data:{cpu_percent:14.2,memory_used_bytes:4294967296,memory_limit_bytes:8589934592,disk_used_bytes:12884901888,network_in_bytes_sec:1048576,network_out_bytes_sec:524288,uptime_seconds:176460}},{scope:'game-2',timestamp:time,data:{cpu_percent:0,memory_used_bytes:0,disk_used_bytes:2147483648,network_in_bytes_sec:0,network_out_bytes_sec:0,uptime_seconds:0}}],servers:[{instance_id:'game-1',server_name:'Riverbend Springs',status:'running'},{instance_id:'game-2',server_name:'Weekend farm',status:'stopped'}]}},
  {id:'north',name:'North farm',enabled:1,online:false,last_seen:time-7200,snapshot:{samples:[],servers:[{instance_id:'Game_3',server_name:'Highland co-op',status:'running'}]}},
  {id:'retired',name:'Retired host',enabled:0,online:false,last_seen:null,snapshot:null}
];
const gameFixture={
 nodes:nodes.map((n,i)=>({...n,snapshot:JSON.stringify(n.snapshot),version:i===0?'1.4.0.0':i===1?'1.3.0.0':null,fingerprint:i===0?'source':'old',status:i===2?'empty':'ready',detail:i===2?'Waiting for approved game files.':'Game files detected.',updated:time})),
 releases:[{id:'preview-release',source_node:'pilot',version:'1.4.0.0',fingerprint:'source',bytes:24*1024**3,dlcs:JSON.stringify(['Highlands','PrecisionFarming']),created:time}],
 jobs:[{id:'sync-north',node_id:'north',kind:'sync',status:'waiting',done_bytes:24*1024**3,total_bytes:24*1024**3,detail:'Files downloaded. Stop all game containers on this node to apply.',created:time,updated:time},{id:'sync-retired',node_id:'retired',kind:'sync',status:'running',done_bytes:8*1024**3,total_bytes:24*1024**3,detail:'Downloading data/maps/mapUS/map.i3d',created:time,updated:time}],
 policy:{release_id:'preview-release',auto_bootstrap:1},dlcSettings:[]
};

// Members, roles and access requests: a small in-memory model so the Users & permissions pages can be exercised.
const permissionGroups=[{id:'servers',label:'Game servers',items:[
  {id:'servers.view',label:'View status',detail:'See the server, who is playing and whether it is running.'},
  {id:'servers.control',label:'Start, stop and restart',detail:'Control the game server.'},
  {id:'servers.backend',label:'Backend reboot',detail:'Restart the server’s backend services without a full restart.'},
  {id:'servers.logs',label:'View logs',detail:'Read the server’s recent log output.'},
  {id:'servers.panel',label:'Open the game web panel',detail:'Open the in-game admin web panel.'},
  {id:'servers.credentials',label:'See the web panel login',detail:'Show the web panel username and password.'},
  {id:'servers.console',label:'Open the VNC console',detail:'Remote desktop session for the server.'}]}];
const roleList=[
  {id:'admin',name:'Admin',color:'#e74c3c',position:0,is_admin:true,permissions:[],all_servers:true,servers:[],created:time},
  {id:'game-server-team',name:'Game Server Team',color:'#47d8b0',position:1,is_admin:false,permissions:['servers.view','servers.stats','servers.control','servers.backend','servers.logs','servers.panel'],all_servers:false,servers:['pilot/game-1','pilot/game-2'],created:time},
  {id:'viewer',name:'Viewer',color:'#74b6ed',position:2,is_admin:false,permissions:['servers.view','servers.stats'],all_servers:true,servers:[],created:time}];
const memberList=[
  {id:'513527870258151439',name:'Local preview administrator',avatarUrl:null,created:time-86400*90,blocked:false,lastLogin:time-60,roles:['admin'],active:true,initialAdmin:true,request:null},
  {id:'123456789012345678',name:'Riverbend Rick',avatarUrl:null,created:time-86400*30,blocked:false,lastLogin:time-3600*5,roles:['game-server-team'],active:true,initialAdmin:false,request:null},
  {id:'223456789012345678',name:'Weekend Wendy',avatarUrl:null,created:time-86400*12,blocked:false,lastLogin:time-86400*2,roles:['game-server-team','viewer'],active:true,initialAdmin:false,request:null},
  {id:'323456789012345678',name:'New Nora',avatarUrl:null,created:time-1800,blocked:false,lastLogin:time-600,roles:[],active:false,initialAdmin:false,request:{status:'open',message:'I help run the Highland co-op server.',created:time-900}},
  {id:'423456789012345678',name:'Blocked Bart',avatarUrl:null,created:time-86400*40,blocked:true,lastLogin:time-86400*20,roles:[],active:false,initialAdmin:false,request:null}];
const hasAccessRoles=ids=>ids.some(id=>{const r=roleList.find(x=>x.id===id);return r&&(r.is_admin||r.permissions.length);});
const memberView=()=>memberList.map(m=>({...m,active:hasAccessRoles(m.roles)}));
const roleView=()=>roleList.map(r=>({...r,members:memberList.filter(m=>m.roles.includes(r.id)).length}));
const catalog=nodes.filter(n=>n.snapshot?.servers?.length).map(n=>({id:n.id,name:n.name,servers:n.snapshot.servers.map(s=>({instance:s.instance_id,name:s.server_name}))}));
const sendJson=(res,data,status=200)=>res.writeHead(status,{'Content-Type':'application/json'}).end(JSON.stringify(data));
async function membersFixture(req,res,path){
  const url=new URL(req.url,'http://localhost');let body={};
  if(req.method==='POST'){let raw='';for await(const chunk of req)raw+=chunk;body=JSON.parse(raw||'{}');}
  if(path==='/api/members'&&req.method==='GET'){
    const id=url.searchParams.get('id');
    if(!id)return sendJson(res,{members:memberView(),roles:roleView(),catalog,permissionGroups});
    const member=memberView().find(m=>m.id===id);if(!member)return sendJson(res,{error:'Member not found'},404);
    return sendJson(res,{member,roles:roleView(),permissionGroups,activity:[{ts:time-600,action:'login',target:'discord'},{ts:time-3500,action:'server.restart',target:'pilot/game-1'}],changes:[{ts:time-86400,action:'member.roles',target:id+': game-server-team',actor:'513527870258151439',actor_name:'Local preview administrator'}]});
  }
  if(path==='/api/roles'&&req.method==='GET')return sendJson(res,{roles:roleView(),catalog,permissionGroups});
  if(path==='/api/members/roles'){const m=memberList.find(x=>x.id===body.id);if(!m)return sendJson(res,{error:'Member not found'},404);if(m.initialAdmin&&!body.roles.includes('admin'))body.roles.unshift('admin');m.roles=body.roles;if(m.roles.length)m.request=null;return sendJson(res,{ok:true,roles:m.roles});}
  if(path==='/api/access-requests/resolve'){const m=memberList.find(x=>x.id===body.id);if(!m)return sendJson(res,{error:'That request is no longer open'},404);if(body.action==='deny')m.request={...m.request,status:'denied'};else{m.roles=[...new Set([...m.roles,...body.roles])];m.request=null;}return sendJson(res,{ok:true});}
  if(path==='/api/users/create'){memberList.unshift({id:body.id,name:body.name,avatarUrl:null,created:time,blocked:false,lastLogin:null,roles:body.roles,active:false,initialAdmin:false,request:null});return sendJson(res,{ok:true});}
  if(path==='/api/users/block'){const m=memberList.find(x=>x.id===body.id);if(m){m.blocked=body.blocked;if(!body.blocked)m.roles=[];}return sendJson(res,{ok:true});}
  if(path==='/api/roles/delete'){const i=roleList.findIndex(r=>r.id===body.id);if(i>0){roleList.splice(i,1);for(const m of memberList)m.roles=m.roles.filter(r=>r!==body.id);}return sendJson(res,{ok:true});}
  if(path==='/api/roles'&&req.method==='POST'){
    const id=body.id||body.name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
    const existing=roleList.find(r=>r.id===id),permissions=body.permissions.length&&!body.permissions.includes('servers.view')?['servers.view',...body.permissions]:body.permissions;
    const next={id,name:body.name,color:body.color,is_admin:existing?.id==='admin'?true:body.is_admin,permissions,all_servers:body.all_servers,servers:body.servers,position:existing?.position??roleList.length,created:time};
    if(existing)Object.assign(existing,next);else roleList.push(next);return sendJson(res,{ok:true,id});
  }
  return false;
}
// What the signed-in preview member may do when PREVIEW_ROLE=operator (a limited Game Server Team member).
const previewAccess=process.env.PREVIEW_ROLE==='operator'?{admin:false,roles:[{id:'game-server-team',name:'Game Server Team',color:'#47d8b0'}],permissions:['servers.view','servers.stats','servers.control','servers.backend','servers.logs','servers.panel'],allServers:false,servers:['pilot/game-1']}:{admin:true,roles:[{id:'admin',name:'Admin',color:'#e74c3c'}],permissions:permissionGroups[0].items.map(i=>i.id),allServers:true,servers:[]};
const visibleNodes=()=>previewAccess.admin?nodes:nodes.map(n=>({...n,snapshot:n.snapshot&&{...n.snapshot,servers:(n.snapshot.servers||[]).filter(s=>previewAccess.servers.includes(n.id+'/'+s.instance_id)).map(s=>({...s,permissions:previewAccess.permissions})),samples:(previewAccess.permissions.includes('servers.stats')?(n.snapshot.samples||[]).filter(sample=>previewAccess.servers.includes(n.id+'/'+sample.scope)):[])}})).filter(n=>n.snapshot?.servers?.length);
createServer(async(req,res)=>{
  const path=new URL(req.url,'http://localhost').pathname;
  if(/^\/api\/(members|roles|access-requests|users\/(create|block))/.test(path)&&process.env.PREVIEW_ROLE!=='operator'){if(await membersFixture(req,res,path)!==false)return;}
  if(path==='/api/game-status'){
    if(req.method==='POST'){let raw='';for await(const chunk of req)raw+=chunk;const b=JSON.parse(raw);if(b.action==='approve')gameFixture.policy.release_id=b.release;if(b.action==='bootstrap')gameFixture.policy.auto_bootstrap=b.enabled?1:0;if(b.action==='dlcs'){gameFixture.dlcSettings=gameFixture.dlcSettings.filter(s=>s.node_id!==b.node||s.instance_id!==b.instance);gameFixture.dlcSettings.push({node_id:b.node,instance_id:b.instance,packages:JSON.stringify(b.packages)});}res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({ok:true}));return;}
    res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify(gameFixture));return;
  }
  if(path==='/api/nodes/notes'){
    const u=new URL(req.url,'http://localhost');let id=u.searchParams.get('id');
    if(req.method==='POST'){let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);id=body.id;const current=nodeNotes.get(id)||{version:0};if(current.version!==body.version){res.writeHead(409,{'Content-Type':'application/json'}).end(JSON.stringify({error:'Another administrator changed these notes.'}));return;}nodeNotes.set(id,{notes:body.notes,version:current.version+1,updated:Math.floor(Date.now()/1000),updatedBy:'Preview admin'});}
    res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify(nodeNotes.get(id)||{notes:'',version:0,updated:null,updatedBy:null}));return;
  }
  if(path==='/api/manage'){
    const u=new URL(req.url,'http://localhost'),op=u.searchParams.get('operation');
    const server={instance_id:'game-1',server_name:'Riverbend Springs',image_name:'fsg/fs25-runtime:local',server_port:10823,web_port:18000,tls_port:28000,vnc_port:5900,novnc_port:6080,sftp_port:2222,sftp_username:'farm',sftp_password:'fixture-secret',web_username:'admin',web_password:'fixture-secret',server_players:16,server_region:'en',server_map:'MapUS'};
    const defaults={...server,instance_id:'game-3',server_password:'fixture-secret',server_admin:'fixture-secret',vnc_password:'fixture-secret',server_difficulty:3,server_pause:2,server_save_interval:180,server_stats_interval:360,puid:1000,pgid:1000,server_crossplay:true,autostart_server:'true'};
    const host={name:'Ubuntu pilot',agent_url:'http://agent:8081',access_host:'192.0.2.10',shared_game_path:'/opt/fs25/game',shared_dlc_path:'/opt/fs25/dlc',shared_installer_path:'/opt/fs25/installer'};
    const data=req.method==='POST'?{ok:true,instance_id:'game-3',message:'Saved.'}:op==='server'?{ok:true,server,secrets:{secrets:{vnc_password:'fixture-secret'}}}:op==='inventory'?{ok:true,defaults,host,servers:nodes[0].snapshot.servers,health:{ok:true},sftp:{admin_sftp_host:'192.0.2.10',admin_sftp_password:'fixture-secret'}}:op==='files'?{ok:true,path:'/opt/fs25/game',files:[{name:'Installer.zip',is_dir:false,size:123456,modified_at:time},{name:'mods',is_dir:true,relative_path:'mods',modified_at:time}]}:{ok:true,metrics:{runtime_state:{state:'online',label:'Online',detail:'Game and web panel are answering'},cpu_percent:14.2,memory_percent:38.5,memory_used_bytes:4294967296,memory_limit_bytes:11159527424,disk_used_bytes:21474836480,disk_percent:42,containers:[{service:'fs25',name:'game-1-fs25',status:'running',running:true,health:'healthy'},{service:'sftp',name:'game-1-sftp',status:'running',running:true,health:null}]},log_output:'Server ready. Waiting for players.',docker_log_output:'Container started.'};
    for await(const chunk of req){}res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify(data));return;
  }
  if(path==='/api/audit'){
    const u=new URL(req.url,'http://localhost'),q=(u.searchParams.get('q')||'').toLowerCase(),action=u.searchParams.get('action')||'',actor=u.searchParams.get('actor')||'',before=Number(u.searchParams.get('before')||0);
    const all=Array.from({length:40},(_,i)=>({id:40-i,ts:time-i*600,actor:i%3?'preview':'123456789012345678',action:['login','server.restart','management.server','node.update','viewer.vnc'][i%5],target:['discord','pilot/game-1','pilot/game-1','pilot','north/Game_3'][i%5]}));
    const rows=all.filter(e=>(!before||e.id<before)&&(!action||e.action===action)&&(!actor||e.actor===actor)&&(!q||(e.action+' '+e.target+' '+e.actor).toLowerCase().includes(q))).slice(0,16);
    const events=rows.slice(0,15);res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({events,actions:[...new Set(all.map(e=>e.action))].sort(),nextCursor:rows.length>15?String(events[14].id):null}));return;
  }
  if(path==='/api/distribution/updates'&&req.method==='GET'){
    const cursor=new URL(req.url,'http://localhost').searchParams.get('cursor'),start=cursor?Number(cursor):0;
    res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({jobs:jobs.slice(start,start+25),nextCursor:start+25<jobs.length?String(start+25):null}));return;
  }
  if(path.startsWith('/api/')){
    const data={
      '/api/cloudflare/oauth/status':{configured:process.env.PREVIEW_OAUTH==='1',connected:false,clientId:'preview-client',scopes:'dns.read dns.write zone.read zone-access.read zone-access.write access-service-token.read access-service-token.write argotunnel.read argotunnel.write openid offline_access',callback:'https://farmservers.sargentweb.com/api/cloudflare/oauth/callback'},
      '/api/cloudflare':{settings:{account:'a'.repeat(32),zone:'b'.repeat(32),domain:'sargentweb.com',hasToken:true,enabled:true},nodes:nodes.map((n,i)=>({...n,stage:i===0?'ready':i===1?'dns':null,error:i===1?'This hostname already has a different DNS record. Existing DNS was left unchanged.':null,updated:time}))},
      '/api/live':{revision:1,editors:process.env.PREVIEW_EDITORS==='1'?[{name:'Another administrator'}]:[]},
      '/api/me':{id:'513527870258151439',name:'Local preview administrator',role:process.env.PREVIEW_ROLE||'admin',csrf:'fixture',access:previewAccess},
      '/api/users':[{id:'preview',name:'Local preview administrator',role:'admin'},{id:'123456789012345678',name:'Farm viewer',role:'viewer'}],
      '/api/notifications':notices,
      '/api/server-credentials':{web_username:'fixture-admin',web_password:'fixture-secret'},

      '/api/nodes':{nodes:visibleNodes()},
      '/api/history':{points:Array.from({length:20},(_,i)=>({timestamp:time-1800+i*90,cpu_percent:15+i%5,memory_used_bytes:8589934592,disk_used_bytes:12884901888,network_in_bytes_sec:1048576,network_out_bytes_sec:524288}))},
      '/api/distribution/releases':[{version:'v1.0.0'}],
      '/api/distribution/updates':jobs
      ,'/api/nodes/software':{installed_version:'v0.9.0',version_source:'reported',releases:[{version:'v1.0.0'}],jobs}
    };
    if(req.method==='POST'){
      let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw||'{}');
      if(path==='/api/live'){res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({...data[path],revision:Math.floor(Date.now()/15000)}));return;}
      if(path==='/api/readiness'){
        const pass=(name,detail)=>({name,state:'pass',detail});
        const fail=(name,detail,repair)=>({name,state:'fail',detail,repair});
        const report={generated:time,nodes:[
          {id:'pilot',name:'Ubuntu pilot',online:true,checks:[pass('Cloudflare connection','Gateway credentials are saved.'),pass('Access application','Node application and console bypass application are recorded.'),pass('Gateway reachable','The node answered through its tunnel.'),pass('Console path bypass','Access lets console sockets through; the node still requires the gateway token.'),pass('Node software','Running v1.0.0.')],servers:[
            {instance_id:'game-1',server_name:'Riverbend Springs',checks:[pass('Container','Running.'),pass('Management network','Reachable from the node gateway.'),pass('Admin ports','Published on loopback only.'),pass('SFTP container','Running.'),pass('Game port','Published on 10823 as configured.'),pass('Web admin port','Published on 18000 as configured.'),pass('TLS port','Published on 28000 as configured.'),fail('SFTP port','Configured for 2222 (tcp) but the container publishes 2299. Recreating the server applies the configured port.',{label:'Recreate server container',api:'nodes/apply-updates',body:{node:'pilot',instance_id:'game-1'},confirm:'Recreate the container for Riverbend Springs? The game server restarts and its players are disconnected.'}),pass('VNC console','console-fs25-0001.sargentweb.com resolves over IPv4 and IPv6.'),pass('Game admin','game-fs25-0001.sargentweb.com resolves over IPv4 and IPv6.')]},
            {instance_id:'game-2',server_name:'Weekend farm',checks:[pass('Container','Running.'),pass('Management network','Reachable from the node gateway.'),pass('Admin ports','Published on loopback only.'),pass('SFTP container','Running.'),pass('Game port','Published on 10824 as configured.'),pass('Web admin port','Published on 18001 as configured.'),pass('TLS port','Published on 28001 as configured.'),pass('SFTP port','Published on 2223 as configured.'),pass('VNC console','console-fs25-0002.sargentweb.com resolves over IPv4 and IPv6.'),pass('Game admin','game-fs25-0002.sargentweb.com resolves over IPv4 and IPv6.')]}
          ]},
          {id:'north',name:'North farm',online:false,checks:[fail('Cloudflare connection','No gateway saved. Enable Cloudflare automation and let the node connect.',{label:'Open Connection & access',href:'/nodes/north?tab=connection'}),pass('Node software','Running v1.0.0.')],servers:[]}
        ]};
        const groups={'Container':'containers','SFTP container':'containers','Management network':'containers','VNC console':'domains','Game admin':'domains','Admin ports':'ports','Game port':'ports','Web admin port':'ports','TLS port':'ports','SFTP port':'ports'};
        const tag=c=>({...c,group:groups[c.name]||'node',...(/^(VNC console|Game admin)$/.test(c.name)?{host:c.detail.split(' ')[0]}:{})});
        const scoped=report.nodes.filter(n=>!body.node||n.id===body.node).map(n=>({...n,checks:n.checks.map(tag),servers:n.servers.filter(x=>!body.instance||x.instance_id===body.instance).map(x=>({...x,checks:x.checks.map(tag)}))}));
        res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({generated:Math.floor(Date.now()/1000),nodes:scoped}));return;
      }
      if(path==='/api/action'&&body.action==='logs'){res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({ok:true,result:{stdout:'Console: Server marked as starting...' + String.fromCharCode(10) + 'Console: Server is online.' + String.fromCharCode(10)}}));return;}
      if(path==='/api/notifications/read')for(const notice of notices)if(body.ids.includes(notice.id))notice.read=true;
      if(path==='/api/nodes/update'){const node=nodes.find(n=>n.id===body.id);Object.assign(node,{name:body.name,enabled:body.enabled?1:0});}
      if(path==='/api/nodes'){if(!nodes.some(n=>n.id===body.id))nodes.push({id:body.id,name:body.name,enabled:1,online:false,last_seen:null,snapshot:null});res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({id:body.id,notice:'Node created.'}));return;}
      if(path==='/api/nodes/token'){res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({id:'pilot',token:'a'.repeat(64)}));return;}
      if(path==='/api/distribution/updates')jobs.push({id:'fixture',node_id:'pilot',version:'v1.0.0',status:'queued',updated:Math.floor(Date.now()/1000)});
      if(path==='/api/distribution/cancel')jobs.length=0;
      res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({ok:true}));return;
    }
    res.writeHead(path in data?200:404,{'Content-Type':'application/json'}).end(JSON.stringify(data[path]||{error:'Fixture endpoint unavailable'}));return;
  }
  const name=path==='/'||path==='/setup.html'||/^\/(nodes|servers|access|users|cloudflare|setup|install|game-status|status)(\/|$)/.test(path)?'index.html':path.slice(1);
  if(!['favicon.svg','favicon-32.png','apple-touch-icon.png','fs-farmservers-logo.svg','fs-farmservers-logo.png','index.html','live.js','startup-progress.js','server-status.js','game-status.js','status.js','install.js','management.js','app.js','members.js','login.js','cloudflare.js','account.js','charts.js','software.js','style.css','node-distribution.txt','central-setup.txt'].includes(name)){res.writeHead(404).end();return;}
  const type=name.endsWith('.svg')?'image/svg+xml':name.endsWith('.png')?'image/png':name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':name.endsWith('.html')?'text/html':'text/plain';
  res.writeHead(200,{'Content-Type':type+'; charset=utf-8'}).end(await readFile(new URL('../public/'+name,import.meta.url)));
}).listen(Number(process.env.PREVIEW_PORT||8766),'127.0.0.1',()=>console.log('Synthetic dashboard: http://127.0.0.1:8766'));
