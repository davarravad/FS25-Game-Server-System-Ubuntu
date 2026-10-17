'use strict';
// Overview: everything happening across the fleet on one screen. Cheap facts come from what every node already publishes (status,
// players, resources); administrators also get first-time setup progress (read from each unfinished server's start-up log) and
// game-file preparation. The model builder is a pure function so it can be tested without a browser.
const ovStarting=['booting','start requested','restart requested','game process restart requested'];
function ovServerState(label){
  const text=String(label||'').toLowerCase();
  if(['online','running','started'].includes(text))return 'good';
  if(ovStarting.includes(text))return 'warn';
  return /degraded|error|fail|unhealthy|crash|restart/.test(text)?'bad':'quiet';
}
const ovUsage=(data,key)=>{const used=data?.[key+'_used_bytes'],total=data?.[key+'_limit_bytes'];return Number.isFinite(used)&&Number.isFinite(total)&&total>0?{used,total,percent:used/total*100}:null;};
const ovUptime=seconds=>!(Number.isFinite(seconds)&&seconds>=0)?'—':seconds>=86400?Math.floor(seconds/86400)+'d '+Math.floor(seconds%86400/3600)+'h':seconds>=3600?Math.floor(seconds/3600)+'h '+Math.floor(seconds%3600/60)+'m':Math.floor(seconds/60)+'m';
const ovPlural=(count,word)=>count+' '+word+(count===1?'':'s');
// Notifications the overview already shows from live data are left out of its heads-up list.
const ovCovered=/^(offline|capacity|server):/;

function overviewModel(nodes,extras={},now=Date.now()/1000){
  const issues=[],setup=[],servers=[],rows=[],progress=extras.progress||new Map(),game=extras.game;
  let players=0,capacity=0,serversOnline=0,nodesOnline=0,nodesEnabled=0;
  for(const node of nodes){
    const host=node.snapshot?.samples?.find(item=>item.scope==='host')?.data,memory=ovUsage(host,'memory'),disk=ovUsage(host,'disk'),list=node.snapshot?.servers||[];
    rows.push({id:node.id,name:node.name,href:nodeUrl(node),state:!node.enabled?'quiet':node.online?'good':'bad',label:nodeStatus(node),servers:list.length,cpu:Number.isFinite(host?.cpu_percent)?host.cpu_percent:null,memory,disk,lastSeen:node.last_seen});
    if(!node.enabled)continue;
    nodesEnabled++;
    if(!node.online){
      issues.push({state:'bad',title:node.name+' is offline',detail:node.last_seen?'No heartbeat since '+stamp(node.last_seen)+'.':'This node has not connected yet.',href:nodeUrl(node)});
    }else{
      nodesOnline++;
      for(const [label,usage] of [['RAM',memory],['Disk',disk]])if(usage&&usage.percent>=85)issues.push({state:usage.percent>=95?'bad':'warn',title:node.name+': '+label+' '+Math.round(usage.percent)+'% full',detail:bytes(usage.total-usage.used)+' remaining.',href:nodeUrl(node)});
      const inventory=game?.nodes?.find(item=>item.id===node.id),job=game?.jobs?.find(item=>item.node_id===node.id);
      if(job&&['queued','running','waiting'].includes(job.status))setup.push({kind:'files',state:'active',title:node.name+': game files',detail:(job.kind==='publish'?'Publishing':'Syncing')+' · '+(job.detail||job.status),percent:job.total_bytes?Math.round(job.done_bytes/job.total_bytes*100):null,href:'/game-status'});
      else if(job?.status==='failed')issues.push({state:'bad',title:node.name+': game file sync failed',detail:job.detail||'Open Game status to retry.',href:'/game-status'});
      else if(inventory?.status==='empty')(game.wanted||[]).includes(node.id)?setup.push({kind:'files',state:'idle',title:node.name+': game files',detail:'Waiting for a node to publish its game files; this node downloads them automatically afterwards.',percent:null,href:'/game-status'}):issues.push({state:'warn',title:node.name+' needs game files',detail:'No game is installed on this node yet. Download it from Game status.',href:'/game-status'});
    }
    for(const server of list){
      const label=serverStatus(node,server),key=node.id+'/'+server.instance_id,entry=progress.get(key),href=serverUrl(node,server),data=node.snapshot?.samples?.find(item=>item.scope===server.instance_id)?.data;
      let state=ovServerState(label);
      const fresh=node.online&&Number.isFinite(server.game_sampled_at)&&now-server.game_sampled_at<120;
      if(fresh&&Number.isInteger(server.player_count))players+=server.player_count;
      if(fresh&&Number.isInteger(server.player_capacity))capacity+=server.player_capacity;
      if(node.online&&entry?.setup){
        const parsed=entry.parsed,step=parsed.steps?.[parsed.current],failed=parsed.state==='failed';
        state=failed?'bad':'setup';
        setup.push({kind:'server',state:failed?'failed':parsed.state==='idle'?'idle':'active',title:server.server_name,detail:failed?'Setup stopped at "'+(step?.label||'start')+'"'+(parsed.detail?': '+parsed.detail:'.'):parsed.state==='idle'?'Created. Waiting for its first start.':(parsed.firstTime?'First-time setup: ':'')+(step?.label||'Starting')+' (step '+(parsed.current+1)+' of '+parsed.steps.length+')',percent:parsed.state==='idle'?null:parsed.percent,href,node:node.name});
        if(failed)issues.push({state:'bad',title:server.server_name+': setup needs attention',detail:'Stopped at "'+(step?.label||'start')+'". Open the server for the log and fixes.',href});
      }else if(node.online&&state==='bad')issues.push({state:'bad',title:server.server_name+': '+label,detail:'Reported by '+node.name+'.',href});
      if(state==='good')serversOnline++;
      servers.push({state,label:state==='setup'?'Setting up':label,name:server.server_name,instance:server.instance_id,node:node.name,href,nodeHref:nodeUrl(node),players:fresh&&Number.isInteger(server.player_count)?server.player_count+(Number.isInteger(server.player_capacity)?' / '+server.player_capacity:''):'—',map:server.game_map||'—',version:server.game_version||'—',ram:Number.isFinite(data?.memory_used_bytes)?data.memory_used_bytes:null,uptime:node.online?ovUptime(data?.uptime_seconds):'—'});
    }
  }
  const rank={bad:0,setup:1,warn:2,good:3,quiet:3};
  servers.sort((a,b)=>rank[a.state]-rank[b.state]||a.name.localeCompare(b.name));
  issues.sort((a,b)=>(a.state==='bad'?0:1)-(b.state==='bad'?0:1));
  const bad=issues.filter(item=>item.state==='bad').length,warn=issues.length-bad;
  const state=!nodes.length?'idle':bad?'problem':warn?'attention':setup.length?'setup':'ok';
  const title=!nodes.length?'No nodes yet':bad?ovPlural(bad+warn,'issue')+' need'+(bad+warn===1?'s':'')+' attention':warn?ovPlural(warn,'thing')+' to look at':setup.length?ovPlural(setup.length,'item')+' being set up':'Everything is running smoothly';
  const percent=servers.length?Math.round(serversOnline/servers.length*100):nodesEnabled?Math.round(nodesOnline/nodesEnabled*100):0;
  const headsUp=(extras.notices||[]).filter(item=>!item.read&&!ovCovered.test(item.id)).slice(0,5).map(({title,detail,href})=>({title,detail,href}));
  return {
    state,title,percent,ringText:servers.length?serversOnline+'/'+servers.length:nodesOnline+'/'+nodesEnabled,
    subtitle:!nodes.length?'Create a node in Server Nodes to get started.':serversOnline+' of '+ovPlural(servers.length,'game server')+' online · '+nodesOnline+' of '+ovPlural(nodesEnabled,'node')+' online',
    tiles:[
      {label:'Players online',value:capacity?players+' / '+capacity:String(players)},
      {label:'Servers online',value:serversOnline+' / '+servers.length},
      {label:'Nodes online',value:nodesOnline+' / '+nodesEnabled},
      {label:'Being set up',value:String(setup.length)}
    ],
    issues,setup,servers,nodes:rows,headsUp
  };
}

const ovStateText={good:'Online',warn:'Starting',bad:'Problem',setup:'Setting up',quiet:'Offline'};
function ovItem(item,kind){
  const row=link('',item.href,'ov-item'),text=element('div',undefined,'ov-item-text');
  row.dataset.state=item.state;
  text.append(element('strong',item.title),element('p',item.detail,'muted'));
  if(Number.isFinite(item.percent)){const bar=element('div',undefined,'progress-bar ov-progress'),fill=element('div',undefined,'progress-fill');fill.style.width=item.percent+'%';bar.setAttribute('role','progressbar');bar.setAttribute('aria-valuenow',String(item.percent));bar.setAttribute('aria-valuemin','0');bar.setAttribute('aria-valuemax','100');bar.setAttribute('aria-label',item.title+' progress');bar.append(fill);const wrap=element('div',undefined,'conn-progress ov-bar');wrap.dataset.state=item.state==='failed'?'error':'active';wrap.append(bar);text.append(wrap);}
  row.append(element('span',undefined,'ss-dot'),text,element('span','›','ov-chevron'));
  row.setAttribute('aria-label',item.title+'. '+item.detail+(kind?' ('+kind+')':''));
  return row;
}
function ovMeter(usage,label){
  const box=element('div',undefined,'ov-meter');
  if(!usage){box.append(element('span',label+' —','muted'));return box;}
  const meter=element('progress');meter.max=100;meter.value=Math.min(100,usage.percent);meter.setAttribute('aria-label',label+' used');meter.className=usage.percent>=95?'capacity-critical':usage.percent>=85?'capacity-warning':'';
  box.append(element('span',label+' '+Math.round(usage.percent)+'%','muted'),meter);return box;
}
function renderOverview(root,model){
  const hero=element('div',undefined,'ss-hero'),ring=element('div',undefined,'ss-ring'),headline=element('div',undefined,'ss-headline'),actions=element('div',undefined,'ss-tools');
  hero.dataset.state=model.state;ring.style.setProperty('--pct',String(model.percent));ring.append(element('strong',model.ringText));
  headline.append(element('h3',model.title),element('p',model.subtitle,'muted'));
  if(me.role==='admin'){
    const firstNode=nodes.find(node=>node.enabled);
    actions.append(link('Run full health check','/status'));
    if(firstNode)actions.append(link('Create game server',nodes.filter(node=>node.enabled).length===1?managementUrl(firstNode,null,'create'):'/servers'));
  }
  hero.append(ring,headline,actions);
  const tiles=element('div',undefined,'ov-tiles');
  for(const tile of model.tiles){const box=element('div',undefined,'ov-tile');box.append(element('strong',tile.value),element('span',tile.label));tiles.append(box);}
  const parts=[hero,tiles];
  const listSection=(heading,items,kind,note)=>{const s=element('section'),h=element('h2',heading);h.append(element('span',String(items.length),'ov-count'));s.append(h);if(note)s.append(element('p',note,'muted'));const list=element('div',undefined,'ov-list');for(const item of items)list.append(ovItem(item,kind));s.append(list);parts.push(s);};
  if(model.issues.length)listSection('Needs attention',model.issues,'issue');
  if(model.setup.length)listSection('Being set up',model.setup,'setup','Repairs stay hidden while a server is being set up; they appear on the server once it has started successfully.');

  const servers=element('section'),serversHead=element('h2','Game servers');serversHead.append(element('span',String(model.servers.length),'ov-count'));servers.append(serversHead);
  if(!model.servers.length)empty(servers,'No game servers have been reported yet.');
  else{
    const scroll=element('div',undefined,'ov-scroll'),table=element('table',undefined,'ov-table'),head=element('tr');
    for(const [label,cls] of [['Status',''],['Server',''],['Node','ov-hide-sm'],['Players',''],['Map','ov-hide-md'],['Game version','ov-hide-md'],['RAM','ov-hide-sm'],['Uptime','ov-hide-sm']]){const th=element('th',label,cls);head.append(th);}
    const thead=element('thead'),body=element('tbody');thead.append(head);
    for(const item of model.servers){
      const tr=element('tr'),status=element('td'),name=element('td'),nodeCell=element('td',undefined,'ov-hide-sm'),pill=element('span',item.label,'ov-pill');
      pill.dataset.state=item.state;status.append(pill);
      const a=link(item.name,item.href,'text-link');name.append(a,element('div',item.instance,'muted'));
      nodeCell.append(link(item.node,item.nodeHref,'text-link'));
      tr.append(status,name,nodeCell,element('td',item.players),element('td',item.map,'ov-hide-md'),element('td',item.version,'ov-hide-md'),element('td',item.ram==null?'—':bytes(item.ram),'ov-hide-sm'),element('td',item.uptime,'ov-hide-sm'));
      body.append(tr);
    }
    table.append(element('caption','Every game server with its latest reported status.'),thead,body);scroll.append(table);servers.append(scroll);
  }
  parts.push(servers);

  const fleet=element('section'),fleetHead=element('h2','Nodes');fleetHead.append(element('span',String(model.nodes.length),'ov-count'));fleet.append(fleetHead);
  const grid=element('div',undefined,'ov-nodes');
  for(const row of model.nodes){
    const card=link('',row.href,'ov-node');card.dataset.state=row.state;
    const head=element('div',undefined,'ov-node-head');head.append(element('strong',row.name),element('span',row.label,'ov-pill'));head.lastChild.dataset.state=row.state;
    card.append(head,element('p',ovPlural(row.servers,'game server')+(row.cpu==null?'':' · CPU '+row.cpu.toFixed(0)+'%'),'muted'),ovMeter(row.memory,'RAM'),ovMeter(row.disk,'Disk'),element('p','Last seen '+stamp(row.lastSeen),'muted'));
    grid.append(card);
  }
  if(!model.nodes.length)empty(grid,'No nodes yet. Create one in Server Nodes.');
  fleet.append(grid);parts.push(fleet);
  if(model.headsUp.length)listSection('Updates & requests',model.headsUp.map(item=>({...item,state:'info'})),'');
  root.replaceChildren(...parts);
}

// Mount the overview. The page redraws from live node data on every refresh; administrators also load game-file and setup details.
function overviewPage(version){
  const root=element('div',undefined,'ov-root');$('page').append(root);
  const extras={progress:new Map(),game:null,notices:[]},checkedAt=new Map();let drawn='',progressBusy=false;
  const draw=()=>{
    if(!root.isConnected||version!==pageVersion)return;
    const model=overviewModel(nodes,extras),signature=JSON.stringify(model);
    if(signature===drawn)return;drawn=signature;renderOverview(root,model);
  };
  redrawFleet=draw;draw();
  const loadSlow=async()=>{
    if(!root.isConnected)return;
    try{extras.notices=await api('notifications');}catch{ /* The overview still works from node data. */ }
    if(me.role==='admin')try{extras.game=await api('game-status');}catch{ /* Game files are reported on Game status. */ }
    draw();
  };
  const loadProgress=async()=>{
    if(me.role!=='admin'||progressBusy||!root.isConnected)return;progressBusy=true;
    try{
      const wanted=[];
      for(const node of nodes)if(node.enabled&&node.online)for(const server of node.snapshot?.servers||[])if(ovServerState(serverStatus(node,server))!=='good')wanted.push([node,server]);
      const keep=new Set(wanted.map(([node,server])=>node.id+'/'+server.instance_id));
      for(const key of [...extras.progress.keys()])if(!keep.has(key)){extras.progress.delete(key);checkedAt.delete(key);}
      // Stopped servers rarely change, so they are re-read once a minute; starting ones every pass.
      for(const [node,server] of wanted.slice(0,8)){
        const key=node.id+'/'+server.instance_id;
        if(ovServerState(serverStatus(node,server))==='quiet'&&Date.now()-(checkedAt.get(key)||0)<60000)continue;
        try{
          const data=await manageApi(node,'live',server),log=String(data.log_output||''),parsed=parseStartup(log,{state:data.metrics?.runtime_state?.state,containers:data.metrics?.containers||[]});
          extras.progress.set(key,{parsed,setup:/Server created/.test(log)&&!parsed.everRan});checkedAt.set(key,Date.now());
        }catch{ /* The node may be busy; the next pass tries again. */ }
      }
    }finally{progressBusy=false;}
    draw();
  };
  void loadSlow();void loadProgress();
  const timer=setInterval(()=>{if(!root.isConnected){clearInterval(timer);return;}if(!document.hidden)void loadProgress();},15000);
  const slowTimer=setInterval(()=>{if(!root.isConnected){clearInterval(slowTimer);return;}if(!document.hidden)void loadSlow();},30000);
}
if(typeof module!=='undefined')module.exports={overviewModel,ovServerState};
