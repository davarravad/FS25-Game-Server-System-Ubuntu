import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {digest} from '../src/security';

type Repair={label:string;api?:string;body?:Record<string,unknown>;href?:string;confirm?:string};
type Check={name:string;state:string;detail:string;repair?:Repair};
type Report={generated:number;nodes:{id:string;name:string;online:boolean;checks:Check[];servers:{instance_id:string;checks:Check[]}[]}[]};

test('fleet readiness reports node connection, console bypass, release, hostnames and container setup, each with its repair',async()=>{
  const origin='https://farmservers.sargentweb.com',key='c'.repeat(64);
  let bypassStatus=403,inspectSupported=true;const probes:string[]=[];
  const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:'readiness',modules:true,scriptPath:'dist/index.js',compatibilityDate:'2026-09-09',compatibilityFlags:['nodejs_compat'],d1Databases:['DB'],bindings:{APP_ORIGIN:origin,NODE_TOKEN_KEY:key,BOOTSTRAP_ADMIN_ID:'123456789012345678',NODE_GATEWAYS:JSON.stringify({'node-1':{origin:'https://origin-node-1.sargentweb.com',token:'a'.repeat(64),accessClientId:'client',accessClientSecret:'secret'}})},outboundService:async req=>{
    const url=new URL(req.url);probes.push(url.pathname+url.search);
    if(url.hostname==='cloudflare-dns.com'){const name=url.searchParams.get('name')!,type=url.searchParams.get('type')!;return Response.json(name==='console-fs25-0001.sargentweb.com'||(name==='game-fs25-0001.sargentweb.com'&&type==='AAAA')?{Status:0,Answer:[{name,type:type==='A'?1:28,TTL:300,data:'x'}]}:{Status:3});}
    assert.equal(url.hostname,'origin-node-1.sargentweb.com');
    if(url.pathname.startsWith('/central/view/readiness-check/vnc/websockify/')){assert.equal(req.headers.get('CF-Access-Client-Secret'),null,'The bypass probe must not present Access credentials');return new Response('forbidden',{status:bypassStatus});}
    assert.equal(req.headers.get('X-Central-Token'),'a'.repeat(64));assert.equal(req.headers.get('CF-Access-Client-Secret'),'secret');assert.equal(req.headers.get('X-Central-Role'),'admin');
    if(url.searchParams.get('route')==='api_central_health')return Response.json({node:'node-1'});
    if(url.searchParams.get('route')==='api_node_readiness'){
      if(!inspectSupported)return new Response('<html>not found</html>',{status:404,headers:{'Content-Type':'text/html'}});
      return Response.json({ok:true,servers:[
        {instance_id:'game-1',server_name:'First',is_enabled:true,container:{exists:true,running:true,status:'running',networks:['fsg-management'],management_network:true,admin_ports_loopback:true,exposed_admin_ports:[]}},
        {instance_id:'game-2',server_name:'Second',is_enabled:true,container:{exists:true,running:false,status:'exited',networks:['game-2_default'],management_network:false,admin_ports_loopback:false,exposed_admin_ports:['0.0.0.0:5901->5900/tcp']}},
        {instance_id:'game-3',server_name:'Third',is_enabled:true,container:{exists:false,running:false,status:'missing',networks:[],management_network:false,admin_ports_loopback:true,exposed_admin_ports:[]}}]});
    }
    assert.fail('Unexpected node request '+url.pathname+url.search);
  }}]}));
  try{
    const db=await mf.getD1Database('DB');for(const file of (await readdir('migrations')).filter(f=>f.endsWith('.sql')).sort())await db.exec(await readFile('migrations/'+file,'utf8'));
    const time=Math.floor(Date.now()/1000);
    await db.prepare('INSERT INTO users(id,name,role,created,blocked) VALUES(?,?,?,?,?)').bind('123456789012345678','Admin','admin',time,0).run();
    await db.prepare('INSERT INTO users(id,name,role,created,blocked) VALUES(?,?,?,?,?)').bind('223456789012345678','Viewer','viewer',time,0).run();
    await db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').bind(await digest('admin'),'123456789012345678','csrf',time+3600).run();
    await db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').bind(await digest('viewer'),'223456789012345678','csrf2',time+3600).run();
    await db.prepare('INSERT INTO nodes(id,name,token_hash,enabled,last_seen,installed_version,snapshot) VALUES(?,?,?,1,?,?,?)').bind('node-1','First node','unused',time,'v1.0.1',JSON.stringify({servers:[{instance_id:'game-1',server_name:'First'},{instance_id:'game-2',server_name:'Second'}]})).run();
    await db.prepare('INSERT INTO nodes(id,name,token_hash,enabled) VALUES(?,?,?,0)').bind('node-off','Disabled node','unused').run();
    await db.prepare("INSERT INTO releases(version,manifest,signature,object_key,created) VALUES('v1.0.2','{}','sig','key',?)").bind(time).run();
    await db.prepare('INSERT INTO game_slots(id,node_id,instance) VALUES(1,?,?)').bind('node-1','game-1').run();
    await db.prepare('INSERT INTO game_endpoints(host,node_id,instance,kind,ready) VALUES(?,?,?,?,?)').bind('console-fs25-0001.sargentweb.com','node-1','game-1','vnc',1).run();
    await db.prepare('INSERT INTO game_endpoints(host,node_id,instance,kind,ready) VALUES(?,?,?,?,?)').bind('game-fs25-0001.sargentweb.com','node-1','game-1','web',1).run();
    const headers={Cookie:'__Host-farmservers=admin',Origin:origin,'X-CSRF-Token':'csrf','Content-Type':'application/json'};
    assert.equal((await mf.dispatchFetch(origin+'/api/readiness',{method:'POST',headers:{...headers,Cookie:'__Host-farmservers=viewer','X-CSRF-Token':'csrf2'},body:'{}'})).status,403);
    assert.equal((await mf.dispatchFetch(origin+'/api/readiness',{method:'POST',headers:{Cookie:headers.Cookie},body:'{}'})).status,403,'CSRF is enforced');
    let response=await mf.dispatchFetch(origin+'/api/readiness',{method:'POST',headers,body:'{}'});assert.equal(response.status,200);
    let report=await response.json() as Report;
    assert.deepEqual(report.nodes.map(n=>n.id),['node-1'],'Disabled nodes are skipped');
    const node=report.nodes[0];const find=(checks:Check[],name:string)=>checks.find(c=>c.name===name)!;
    assert.equal(find(node.checks,'Cloudflare connection').state,'pass');assert.equal(find(node.checks,'Cloudflare connection').repair,undefined,'Passing checks carry no repair');
    assert.equal(find(node.checks,'Access application').state,'warn');assert.equal(find(node.checks,'Access application').repair?.href,'/cloudflare');
    assert.equal(find(node.checks,'Gateway reachable').state,'pass');
    assert.equal(find(node.checks,'Console path bypass').state,'pass');
    assert.equal(find(node.checks,'Node software').state,'warn');assert.match(find(node.checks,'Node software').detail,/v1\.0\.2 is available/);
    assert.deepEqual(find(node.checks,'Node software').repair,{label:'Queue update to v1.0.2',api:'distribution/updates',body:{node:'node-1',version:'v1.0.2'},confirm:'Update First node to v1.0.2? Running games stay up; control-panel sessions may disconnect briefly.'});
    assert.deepEqual(node.servers.map(s=>s.instance_id),['game-1','game-2','game-3'],'Servers come from the node inspection');
    const [first,second,third]=node.servers;
    assert.deepEqual(first.checks.map(c=>c.state),['pass','pass','pass','pass','fail']);
    assert.match(find(first.checks,'VNC console').detail,/console-fs25-0001.*resolves over IPv4 and IPv6/);
    assert.match(find(first.checks,'Game admin').detail,/game-fs25-0001.*does not resolve on both/,'A hostname with only an AAAA answer is not ready');
    assert.deepEqual(find(first.checks,'Game admin').repair,{label:'Re-check DNS',api:'readiness/repair',body:{node:'node-1',action:'provision-hostname',instance:'game-1',kind:'web'}});
    assert.equal(find(second.checks,'Container').state,'warn');assert.deepEqual(find(second.checks,'Container').repair,{label:'Start server',api:'action',body:{node:'node-1',instance_id:'game-2',action:'start'}});
    assert.equal(find(second.checks,'Management network').state,'fail');assert.equal(find(second.checks,'Management network').repair?.api,'nodes/apply-updates');assert.deepEqual(find(second.checks,'Management network').repair?.body,{node:'node-1',instance_id:'game-2'});assert.ok(find(second.checks,'Management network').repair?.confirm);
    assert.equal(find(second.checks,'Admin ports').state,'fail');assert.match(find(second.checks,'Admin ports').detail,/0\.0\.0\.0:5901/);
    assert.match(find(second.checks,'VNC console').detail,/not created yet/);assert.equal(find(second.checks,'VNC console').repair?.label,'Provision hostname now');
    assert.equal(find(third.checks,'Container').state,'fail');assert.equal(find(third.checks,'Container').repair?.href,'/servers/node-1/game-3');
    const audit=await db.prepare("SELECT target FROM audit WHERE action='fleet.readiness'").first<{target:string}>();assert.ok(audit);

    // Repairs: hostname provisioning runs the same path as a launch and reports Cloudflare's state; the bypass repair needs a connection record.
    const repair=(body:unknown)=>mf.dispatchFetch(origin+'/api/readiness/repair',{method:'POST',headers,body:JSON.stringify(body)});
    assert.equal((await repair({node:'node-1',action:'bogus'})).status,422);
    assert.equal((await repair({node:'node-1',action:'provision-hostname',instance:'game-9',kind:'vnc'})).status,404,'Unknown servers cannot be provisioned');
    const provision=await repair({node:'node-1',action:'provision-hostname',instance:'game-2',kind:'vnc'});
    assert.equal(provision.status,503,await provision.clone().text());assert.match((await provision.json() as {error:string}).error,/Connect Cloudflare/,'Without a Cloudflare connection the repair explains what is missing');
    const slot=await db.prepare('SELECT host,ready FROM game_endpoints WHERE node_id=? AND instance=? AND kind=?').bind('node-1','game-2','vnc').first<{host:string;ready:number}>();
    assert.ok(slot&&/^console-fs25-\d{4}\.sargentweb\.com$/.test(slot.host)&&slot.ready===0,'The hostname is allocated but not marked ready');
    const bypass=await repair({node:'node-1',action:'console-bypass'});
    assert.equal(bypass.status,503,await bypass.clone().text());assert.match((await bypass.json() as {error:string}).error,/not connected/);
    assert.ok(await db.prepare("SELECT 1 FROM audit WHERE action='readiness.repair'").first()===null,'Failed repairs are not recorded as done');

    // Access still challenging the console path and a node without readiness support degrade to explicit findings.
    bypassStatus=401;inspectSupported=false;
    response=await mf.dispatchFetch(origin+'/api/readiness',{method:'POST',headers,body:'{}'});report=await response.json() as Report;
    const degraded=report.nodes[0];
    assert.equal(find(degraded.checks,'Console path bypass').state,'fail');assert.match(find(degraded.checks,'Console path bypass').detail,/HTTP 401/);assert.deepEqual(find(degraded.checks,'Console path bypass').repair,{label:'Create console bypass now',api:'readiness/repair',body:{node:'node-1',action:'console-bypass'}});
    assert.equal(find(degraded.checks,'Server inspection').state,'warn');assert.equal(find(degraded.checks,'Server inspection').repair?.api,'distribution/updates');
    assert.deepEqual(degraded.servers.map(s=>s.instance_id),['game-1','game-2'],'Falls back to the heartbeat snapshot');
    assert.deepEqual(degraded.servers[0].checks.map(c=>c.name),['VNC console','Game admin'],'No container checks without node support');
  }finally{await mf.dispose();}
});
