'use strict';

let me, nodes=[], hours=1, pending=false, pageVersion=0, redrawFleet, refreshTelemetry, refreshHistory, dirty=false;

const $=id=>document.getElementById(id);

const element=(tag,text,className)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(className)e.className=className;return e;};

const link=(text,href,className='button')=>{const e=element('a',text,className);e.href=href;return e;};

const button=(text,action)=>{const e=element('button',text);e.type='button';e.onclick=action;return e;};

const nodeUrl=node=>'/nodes/'+encodeURIComponent(node.id);

const serverUrl=(node,server)=>'/servers/'+encodeURIComponent(node.id)+'/'+encodeURIComponent(server.instance_id);

const stamp=ts=>ts?new Date(ts*1000).toLocaleString():'Never';

const nodeStatus=node=>!node.enabled?'Disabled':node.online?'Online':'Offline';

const serverStatus=(node,server)=>!node.enabled?'Node disabled':!node.online?'Host offline':({start:'Start requested',stop:'Stop requested',restart:'Restart requested',backend_reboot:'Game process restart requested'}[server.status]||server.status||'Unknown');

const badge=text=>element('span',text,'badge '+(['online','running','started'].includes(text.toLowerCase())?'good':['offline','host offline','stopped','disabled','node disabled'].includes(text.toLowerCase())?'quiet':'warning'));

const sample=(node,scope='host')=>node?.snapshot?.samples?.find(s=>s.scope===scope)?.data;

function bytes(n){if(n==null)return '—';const i=Math.min(4,Math.floor(Math.log(Math.max(n,1))/Math.log(1024)));return (n/1024**i).toFixed(i?1:0)+' '+['B','KB','MB','GB','TB'][i];}

function capacity(data,key,label){

  const box=element('div',undefined,'capacity'),used=data?.[key+'_used_bytes'],total=data?.[key+'_limit_bytes'];

  const hasUsed=Number.isFinite(used)&&used>=0,hasTotal=Number.isFinite(total)&&total>0;

  box.append(element('div',`${label}: ${hasUsed?bytes(used):'—'} / ${hasTotal?bytes(total):'unknown'} total`,'capacity-value'));

  if(hasUsed&&hasTotal){

    const percent=used/total*100,meter=element('progress');meter.max=100;meter.value=Math.min(100,percent);meter.setAttribute('aria-label',label+' used');

    meter.className=percent>=90?'capacity-critical':percent>=75?'capacity-warning':'';

    box.append(meter,element('p',`${percent.toFixed(1)}% used · ${bytes(Math.max(0,total-used))} remaining`,'muted'));

  }else box.append(element('p',hasTotal?'Usage not reported': 'Total capacity not reported','muted'));

  return box;

}

const metrics=[['cpu_percent','CPU',n=>n==null?'—':n.toFixed(1)+'%'],['memory_used_bytes','Memory',bytes],['disk_used_bytes','Disk',bytes],['network_in_bytes_sec','Network in',n=>n==null?'—':bytes(n)+'/s'],['network_out_bytes_sec','Network out',n=>n==null?'—':bytes(n)+'/s']];

async function api(path,body,options={}){

  const r=await fetch('/api/'+path,{signal:options.signal,cache:'no-store',headers:body?{'Content-Type':'application/json','X-CSRF-Token':me.csrf}:{},method:body?'POST':'GET',body:body?JSON.stringify(body):undefined});

  const data=r.status===204?{}:await r.json();

  if(!r.ok){if(r.status===401){document.body.hidden=true;location.replace('/');}throw new Error(data.error||'Request failed');}return data;

}

function route(){

  const parts=location.pathname.replace(/\/$/,'').split('/').filter(Boolean);

  if(!parts.length||parts[0]==='index.html')return {type:'overview'};

  if(parts[0]==='nodes'&&parts.length===1)return {type:'access'};

  if(parts[0]==='nodes'&&parts.length===2)return {type:'node',id:parts[1]};

  if(parts[0]==='servers'&&parts.length===3)return {type:'server',id:parts[1],instance:parts[2]};

  if(['servers','access','users','cloudflare','setup','install','game-status'].includes(parts[0])&&parts.length===1)return {type:parts[0]};

  if(parts[0]==='setup.html')return {type:'setup'};

  return {type:'missing'};

}

function title(text,description,nav){

  $('page-title').textContent=text;$('page-description').textContent=description;document.title=text+' · Farm Servers';

  for(const a of document.querySelectorAll('[data-nav]')){if(a.dataset.nav===nav)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');}

}

function section(text,parent=$('page')){const s=element('section');s.append(element('h2',text));parent.append(s);return s;}

function fleetSwitcher(r){
  $('fleet-switcher')?.remove();
  const servers=['server','servers'].includes(r.type);
  if(!servers&&!['node','access'].includes(r.type))return;
  const menu=element('details',undefined,'fleet-switcher');menu.id='fleet-switcher';
  const trigger=element('summary'),panel=element('div',undefined,'fleet-switcher-panel'),search=element('input'),results=element('div',undefined,'fleet-switcher-results');
  const currentNode=nodes.find(n=>n.id===r.id),currentServer=currentNode?.snapshot?.servers?.find(s=>s.instance_id===r.instance);
  const label=servers?'Game server':'Server node';
  trigger.append(element('span',label,'muted'),element('strong',servers?(currentServer?.server_name||'Select a game server'):(currentNode?.name||'Select a server node')),element('span','⌄','fleet-switcher-chevron'));
  search.type='search';search.placeholder=servers?'Search game servers…':'Search server nodes…';search.setAttribute('aria-label',search.placeholder);
  const draw=()=>{
    results.replaceChildren();const query=search.value.trim().toLowerCase();
    const tab=['node','server'].includes(r.type)?new URLSearchParams(location.search).get('tab'):null;
    for(const node of nodes){for(const server of servers?(node.snapshot?.servers||[]):[null]){
      const name=server?server.server_name:node.name,detail=server?`${node.name} · ${node.id} / ${server.instance_id}`:node.id;
      if(!`${name} ${detail}`.toLowerCase().includes(query))continue;
      const href=(server?serverUrl(node,server):nodeUrl(node))+(tab?'?'+new URLSearchParams({tab}):'');
      const option=link('',href,'fleet-switcher-option');option.append(element('strong',name),element('span',detail,'muted'));
      if(node.id===r.id&&(!server||server.instance_id===r.instance)){option.setAttribute('aria-current','page');option.append(element('span','Selected','muted'));}
      results.append(option);
    }}
    if(!results.children.length)empty(results,servers?'No matching game servers.':'No matching server nodes.');
  };
  search.oninput=draw;
  menu.addEventListener('toggle',()=>{if(menu.open){draw();search.focus();}});
  menu.addEventListener('keydown',event=>{
    if(event.key==='Escape'){event.preventDefault();menu.open=false;trigger.focus();}
    if(event.key==='ArrowDown'||event.key==='ArrowUp'){
      const options=[...results.querySelectorAll('a')],index=options.indexOf(document.activeElement);
      const next=event.key==='ArrowDown'?options[index+1]:options[index<0?options.length-1:index-1];
      if(next){event.preventDefault();next.focus();}else if(index===0&&event.key==='ArrowUp'){event.preventDefault();search.focus();}
    }
    if(event.key==='Enter'&&event.target===search){event.preventDefault();results.querySelector('a')?.click();}
  });
  panel.append(search,results);menu.append(trigger,panel);$('live-status').before(menu);draw();
}

document.addEventListener('click',event=>{const menu=$('fleet-switcher');if(menu?.open&&!menu.contains(event.target))menu.open=false;});

function empty(parent,text){parent.append(element('p',text,'empty-state'));}

function field(form,text,name,value='',options={}){const label=element('label',text),input=element('input');input.name=name;input.value=value;Object.assign(input,options);label.append(input);form.append(label);return input;}

function summary(items){const box=element('div',undefined,'summary');for(const [label,value] of items){const card=element('div',undefined,'summary-item');card.append(element('strong',String(value)),element('span',label));box.append(card);}return box;}

function nodeCard(node,admin=false){

  const card=element('article',undefined,'card fleet-card'),head=element('div',undefined,'card-heading');

  head.append(link(node.name,nodeUrl(node),'card-title'),badge(nodeStatus(node)));card.append(head,element('p',node.id,'muted'));

  const current=sample(node);card.append(element('p',`${node.snapshot?.servers?.length||0} game servers · CPU ${metrics[0][2](current?.cpu_percent)}`),capacity(current,'memory','RAM'),capacity(current,'disk','Disk'),element('p','Last seen '+stamp(node.last_seen),'muted'));

  const actions=element('div',undefined,'actions');actions.append(link(admin?'View & edit node':'Open node',nodeUrl(node)));card.append(actions);return card;

}

function serverCard(node,server){

  const card=element('article',undefined,'card fleet-card'),head=element('div',undefined,'card-heading');head.append(link(server.server_name,serverUrl(node,server),'card-title'),badge(serverStatus(node,server)));

  card.append(head,(me.role==='operator'?element('span',node.name):link(node.name,nodeUrl(node),'text-link')),element('p',server.instance_id,'muted'));
  const game=element('dl',undefined,'server-game-details'),fresh=node.online&&node.enabled&&Number.isFinite(server.game_sampled_at)&&Date.now()/1000-server.game_sampled_at<120;
  const capacity=server.player_capacity;
  const players=fresh&&Number.isInteger(server.player_count)?String(server.player_count):'—';
  for(const [label,value] of [['Game version',server.game_version||'Not reported'],['Players',players+(Number.isInteger(capacity)?' / '+capacity:'')],['Map',server.game_map||'Not reported']]){
    const item=element('div');item.append(element('dt',label),element('dd',value));game.append(item);
  }
  card.append(game,element('p',fresh?'Game feed checked '+stamp(server.game_sampled_at):'Live player count unavailable','muted'));
  if(me.role!=='operator')card.append(serverCardStats(node,server));
  card.append(element('p','Last reported '+stamp(node.last_seen),'muted'),link('Open server',serverUrl(node,server)));return card;

}

function serverCardStats(node,server){
  const box=element('div',undefined,'server-card-stats'),record=node.snapshot?.samples?.find(s=>s.scope===server.instance_id),data=record?.data;
  const valid=n=>Number.isFinite(n)&&n>=0;
  const stats=element('div',undefined,'server-resource-grid');
  for(const [label,key,limitKey,tone] of [['CPU','cpu_percent',null,'cpu'],['RAM','memory_used_bytes','memory_limit_bytes','ram'],['Disk','disk_used_bytes',null,'disk']]){
    const value=data?.[key],limit=limitKey&&data?.[limitKey],item=element('div',undefined,'server-resource '+tone),heading=element('div',undefined,'server-resource-heading');
    heading.append(element('span',label),element('strong',valid(value)?(key==='cpu_percent'?value.toFixed(1)+'%':bytes(value)):'—'));item.append(heading);
    const maximum=key==='cpu_percent'?100:valid(limit)&&limit>0?limit:null;
    if(valid(value)&&maximum){const meter=element('progress');meter.max=maximum;meter.value=Math.min(value,maximum);meter.setAttribute('aria-label',label+' usage for '+server.server_name);item.append(meter);}
    item.append(element('span',label==='RAM'?(valid(limit)&&limit>0?'of '+bytes(limit):'Limit not reported'):label==='Disk'?'Server storage used':'CPU usage','muted'));stats.append(item);
  }
  const activity=element('dl',undefined,'server-activity');
  const uptime=data?.uptime_seconds;
  const duration=valid(uptime)?(uptime>=86400?Math.floor(uptime/86400)+'d '+Math.floor(uptime%86400/3600)+'h':uptime>=3600?Math.floor(uptime/3600)+'h '+Math.floor(uptime%3600/60)+'m':Math.floor(uptime/60)+'m'):'—';
  for(const [label,value] of [['Network in',valid(data?.network_in_bytes_sec)?bytes(data.network_in_bytes_sec)+'/s':'—'],['Network out',valid(data?.network_out_bytes_sec)?bytes(data.network_out_bytes_sec)+'/s':'—'],['Uptime',duration]]){
    const item=element('div');item.append(element('dt',label),element('dd',value));activity.append(item);
  }
  const stale=!node.online||!node.enabled||!record?.timestamp||Date.now()/1000-record.timestamp>120;
  box.append(stats,activity,element('p',record?(stale?'Last known stats · ':'Stats sampled · ')+stamp(record.timestamp):'Waiting for server telemetry','muted'));return box;
}

function browse(kind,parent=$('page')){

  const toolbar=element('div',undefined,'toolbar'),search=element('input'),filter=element('select'),grid=element('div',undefined,'grid');search.type='search';search.placeholder=kind==='servers'?'Search servers or nodes…':'Search nodes…';search.setAttribute('aria-label',search.placeholder);filter.setAttribute('aria-label','Filter by status');

  const statuses=kind==='servers'?['All statuses',...new Set(nodes.flatMap(n=>(n.snapshot?.servers||[]).map(s=>serverStatus(n,s))))]:['All statuses','Online','Offline','Disabled'];

  for(const value of statuses){const option=element('option',value);option.value=value;filter.append(option);}toolbar.append(search,filter);parent.append(toolbar,grid);

  const draw=()=>{grid.replaceChildren();const q=search.value.toLowerCase();for(const node of nodes){

    if(kind==='servers'){for(const server of node.snapshot?.servers||[]){if(!`${server.server_name} ${server.instance_id} ${node.name} ${node.id}`.toLowerCase().includes(q)||filter.value!=='All statuses'&&serverStatus(node,server)!==filter.value)continue;grid.append(serverCard(node,server));}}

    else if(`${node.name} ${node.id}`.toLowerCase().includes(q)&&(filter.value==='All statuses'||filter.value===nodeStatus(node)))grid.append(nodeCard(node,kind==='admin'));

  }if(!grid.children.length)empty(grid,kind==='servers'?'No matching game servers. Nodes publish their inventory when connected.':'No matching nodes. Try another search or create a node in Server Nodes.');};

  search.oninput=draw;filter.onchange=draw;draw();return draw;

}

async function openViewer(node,kind,instance='',message=$('message')){

  const tab=window.open('about:blank','_blank');if(tab)tab.opener=null;

  message.textContent='Opening management page…';

  try{

    const result=await api('launch?'+new URLSearchParams({node,kind,instance}),{});

    if(tab&&!tab.closed)tab.location=result.url;else location.href=result.url;

    message.textContent=result.public?'Public game panel opened. Share its address; visitors sign in using the game panel login.':'Management page opened.';

  }catch(error){

    const detail='Unable to open management page: '+error.message;

    message.textContent=detail;

    if(tab&&!tab.closed){try{tab.document.title='Unable to open management page';const heading=tab.document.createElement('h1'),description=tab.document.createElement('p');heading.textContent='Connection could not be opened';description.textContent=detail;tab.document.body.replaceChildren(heading,description);}catch{ /* The inline error remains available if the browser isolates this tab. */ }}

  }

}

function tokenControls(node,parent){

  const box=element('div',undefined,'token-controls'),value=element('pre','••••••••••••••••'),message=element('p');value.setAttribute('aria-label','Publishing token for '+node.name);message.setAttribute('role','status');

  const hide=()=>{value.textContent='••••••••••••••••';view.textContent='View token';view.setAttribute('aria-expanded','false');copy.hidden=true;};

  const view=button('View token',async()=>{if(view.getAttribute('aria-expanded')==='true'){hide();return;}view.disabled=true;message.textContent='';try{const data=await api('nodes/token',{id:node.id});if(!box.isConnected||document.hidden)return;value.textContent=data.token;view.textContent='Hide token';view.setAttribute('aria-expanded','true');copy.hidden=false;}catch(e){message.textContent=e.message;}finally{view.disabled=false;}});

  const copy=button('Copy token',async()=>{try{await navigator.clipboard.writeText(value.textContent);message.textContent='Token copied.';}catch{message.textContent='Select the visible token and copy it manually.';}});hide();

  const actions=element('div',undefined,'actions');actions.append(view,copy);box.append(value,actions,message);box.hideToken=hide;parent.append(box);

}

function nodeEditor(node){

  const s=section('Node administration'),form=element('form',undefined,'edit-form');

  field(form,'Node ID','id',node.id,{readOnly:true});const name=field(form,'Display name','name',node.name,{required:true,maxLength:100});

  const label=element('label','Node access'),enabled=element('select');enabled.setAttribute('aria-label','Node access');for(const [v,t] of [['true','Enabled'],['false','Disabled']]){const o=element('option',t);o.value=v;enabled.append(o);}enabled.value=String(!!node.enabled);label.append(enabled);form.append(label);

  const save=element('button','Save changes');form.append(save);s.append(element('p','Edit the name or enable / disable central access. Saving does not change the publishing token.'),form);

  form.oninput=()=>{dirty=true;};

  form.onsubmit=async event=>{event.preventDefault();if(enabled.value==='false'&&node.enabled&&!confirm('Disable this node? Publishing and central management will stop until it is enabled again.'))return;save.disabled=true;try{await api('nodes/update',{id:node.id,name:name.value,enabled:enabled.value==='true'});await load();$('message').textContent='Node changes saved.';}catch(e){$('message').textContent=e.message;}finally{save.disabled=false;}};

  const applyStatus=element('div',undefined,'apply-updates-status');
  const applyUpdates=button('Apply updates to all servers',async()=>{
    if(!confirm('Recreate every enabled game server container on '+node.name+' to apply the latest configuration? This briefly interrupts all of its servers.'))return;
    const servers=node.snapshot?.servers||[];
    applyUpdates.disabled=true;applyStatus.replaceChildren();
    if(!servers.length){$('message').textContent='No published servers to update on '+node.name+'.';applyUpdates.disabled=false;return;}
    const rows=new Map(servers.map(server=>{const row=element('p',server.server_name+' ('+server.instance_id+'): waiting…','apply-updates-row apply-updates-waiting');applyStatus.append(row);return [server.instance_id,row];}));
    let failures=0;
    for(const server of servers){
      const row=rows.get(server.instance_id);row.textContent=server.server_name+' ('+server.instance_id+'): applying…';row.className='apply-updates-row apply-updates-running';
      try{
        const data=await api('nodes/apply-updates',{node:node.id,instance_id:server.instance_id});
        const result=(data.results||[])[0];
        if(result&&result.ok===false){failures++;row.textContent=server.server_name+' ('+server.instance_id+'): failed — '+(result.error||'unknown error');row.className='apply-updates-row apply-updates-failed';}
        else{row.textContent=server.server_name+' ('+server.instance_id+'): done.';row.className='apply-updates-row apply-updates-done';}
      }catch(e){failures++;row.textContent=server.server_name+' ('+server.instance_id+'): failed — '+e.message;row.className='apply-updates-row apply-updates-failed';}
    }
    $('message').textContent=failures?'Applied with '+failures+' failure(s) on '+node.name+'.':'Configuration applied to all '+servers.length+' server(s) on '+node.name+'.';
    applyUpdates.disabled=false;
  });
  applyUpdates.className='apply-updates-button';
  const applyUpdatesWrap=element('div',undefined,'apply-updates');
  applyUpdatesWrap.append(element('p','Recreates every enabled server container on this node so it picks up config, mod, or version changes. Each server restarts briefly; this is separate from Save changes above.','muted'),applyUpdates);
  s.append(applyUpdatesWrap,applyStatus);

  void nodeConnectionPanel(node);

  void gatewayCredentialsPanel(node);

  const tokens=section('Publishing token');tokenControls(node,tokens);

  tokens.append(button('Rotate token',async()=>{if(!confirm('Rotate the publishing token for '+node.name+'? Update CENTRAL_NODE_TOKEN on the node afterward.'))return;try{await api('nodes',{id:node.id,name:node.name});await load();$('message').textContent='Token rotated. View and copy the new token, then update the node configuration.';}catch(e){$('message').textContent=e.message;}}));

}

function accessHostName(value){return String(value||'').trim().replace(/^[a-z][a-z0-9+.-]*:\/\//i,'').split(/[\/?#]/)[0].replace(/:\d+$/,'');}

function sftpSection(node,server,loadCredentials){
  const s=section('SFTP access');
  s.append(element('p','Connection details for this server’s SFTP service. Copy each value into a third-party SFTP client or automation tool. This port is published directly, so it needs no VPN or SSH tunnel, but the node’s Access Host/IP must be its real public address or hostname for the host address below to be reachable.'));
  const message=element('p');message.setAttribute('role','status');
  const fieldsWrap=element('div',undefined,'edit-form');
  const fields=[['sftp_host','Host address'],['sftp_port','Port'],['sftp_username','Username'],['sftp_password','Password']];
  const show=data=>{fieldsWrap.replaceChildren();for(const [key,label] of fields)credentialField(fieldsWrap,key,data[key]==null?'':String(data[key]),label);};
  show({});s.append(fieldsWrap,message);
  if(!node.online){message.textContent='Node offline. SFTP details load when the node reports in.';return s;}
  message.textContent='Loading…';
  loadCredentials().then(data=>{show(data);message.textContent=data.sftp_host?'':'No access hostname or IP is set for this node. Set it under the node’s Host settings.';}).catch(e=>{message.textContent=e.message;});
  return s;
}

function credentialField(container,key,value,labelText){
  managementField(container,key,value??'',false,labelText);
  const label=container.lastElementChild,input=label.querySelector('input');input.readOnly=true;if(!value)input.placeholder='Not set';
  const reveal=label.querySelector('button');if(reveal)reveal.disabled=!value;
  const copy=button('Copy',async()=>{try{await navigator.clipboard.writeText(value||'');copy.textContent='Copied';}catch{copy.textContent='Copy failed';}finally{setTimeout(()=>{copy.textContent='Copy';},1500);}});copy.disabled=!value;
  const control=element('span',undefined,'host-secret-control');control.append(input);if(reveal)control.append(reveal);control.append(copy);label.append(control);
}

function viewerSection(title,description,node,server,kind,openLabel,loadCredentials,fields,extra){
  const s=section(title);s.append(element('p',description));
  const message=element('p');message.setAttribute('role','status');
  const actions=element('div',undefined,'actions');
  const open=button(openLabel,()=>openViewer(node.id,kind,server.instance_id,message));open.disabled=!node.online;actions.append(open);
  if(extra)actions.append(extra(message));
  s.append(actions,message);
  const credentials=element('details',undefined,'credential-details'),credMessage=element('p');credMessage.setAttribute('role','status');
  credentials.append(element('summary','Login credentials'));
  let loaded=false;
  credentials.ontoggle=async()=>{
    if(!credentials.open||loaded)return;loaded=true;credentials.append(credMessage);credMessage.textContent='Loading…';
    try{const data=await loadCredentials();credMessage.remove();const fieldsWrap=element('div',undefined,'edit-form');for(const key of fields)credentialField(fieldsWrap,key,data[key]);credentials.append(fieldsWrap);}
    catch(e){credMessage.textContent=e.message;loaded=false;}
  };
  s.append(credentials);
  return s;
}

async function historyPanel(node,scope,version){

  const s=section('Resource history'),toolbar=element('div',undefined,'toolbar'),range=element('select');range.id='range';range.setAttribute('aria-label','History range');

  for(const [value,label] of [[1,'Last hour'],[6,'6 hours'],[24,'24 hours'],[168,'7 days'],[720,'30 days']]){const o=element('option',label);o.value=value;range.append(o);}range.value=hours;

  const chart=element('div',undefined,'grid'),historyStatus=element('p',undefined,'muted');historyStatus.setAttribute('role','status');chart.id='charts';toolbar.append(element('p','Checks every second while this page is active. New node readings arrive about every 30 seconds.'),range);s.append(toolbar,historyStatus,chart);

  let requestVersion=0;

  const draw=async()=>{const request=++requestVersion;try{const data=await api('history?'+new URLSearchParams({node:node.id,scope,hours}),undefined,{signal:AbortSignal.timeout(15000)});if(version===pageVersion&&request===requestVersion&&chart.isConnected){historyStatus.textContent='';charts(data.points,sample(nodes.find(n=>n.id===node.id),scope));}}catch(e){if(request===requestVersion&&chart.isConnected)historyStatus.textContent='History update failed. Keeping the last readings; retrying automatically.';}};

  refreshHistory=draw;range.onchange=()=>{hours=Number(range.value);void draw();};await draw();

}

async function details(r,version){

  const node=nodes.find(n=>n.id===r.id);let server=node?.snapshot?.servers?.find(s=>s.instance_id===r.instance);

  if(node&&r.type==='server'&&!server&&me.role==='admin'){try{const live=await manageApi(node,'inventory');server=live.servers.find(s=>s.instance_id===r.instance);}catch{ /* Published inventory remains usable while disconnected. */ }}

  if(!node||r.type==='server'&&!server){title('Not found','This node or server is no longer in the published inventory.','overview');$('page').append(link('Back to overview','/'));return;}

  title(server?server.server_name:node.name,server?(me.role==='operator'?'Game server status and start, stop or restart controls.':'Game server details, resource history and management.'):'Node details, hosted game servers and resource history.',server?'servers':'access');

  $('breadcrumbs').append(link(server?'Game Servers':'Server Nodes',server?'/servers':'/nodes','text-link'));if(server&&me.role!=='operator')$('breadcrumbs').append(element('span',' / '),link(node.name,nodeUrl(node),'text-link'));

  if(me.role==='admin'){managementNavigation(node,server);const tab=new URLSearchParams(location.search).get('tab')||'overview';if(tab!=='overview'){await managementPage(node,server,tab);return;}}

  const s=section('At a glance'),liveSummary=element('div');s.append(liveSummary);

  let nodeFleet;

  refreshTelemetry=()=>{

    const fresh=nodes.find(n=>n.id===node.id);if(!fresh)return;

    Object.assign(node,fresh);

    const currentServer=server&&node.snapshot?.servers?.find(item=>item.instance_id===server.instance_id);

    if(currentServer)Object.assign(server,currentServer);

    liveSummary.replaceChildren(badge(server?serverStatus(node,server):nodeStatus(node)),element('p',server?'Instance ID: '+server.instance_id+' - Node: '+node.name:'Node ID: '+node.id),element('p','Last heartbeat: '+stamp(node.last_seen)));

    const collected=node.snapshot?.samples?.find(item=>item.scope===(server?server.instance_id:'host'))?.timestamp;

    if(me.role!=='operator')liveSummary.append(element('p','Latest telemetry sample: '+stamp(collected),'muted'));

    if(!node.online)liveSummary.append(element('p','Node offline. Showing the last received telemetry.','notice'));

    if(nodeFleet){nodeFleet.replaceChildren();for(const item of node.snapshot?.servers||[])nodeFleet.append(serverCard(node,item));if(!nodeFleet.children.length)empty(nodeFleet,'No game servers have been reported.');}

  };

  const viewerMessage=element('p');viewerMessage.setAttribute('role','status');

  const actions=element('div',undefined,'actions');

  if(server){for(const action of ['start','stop','restart']){const control=button(action[0].toUpperCase()+action.slice(1),async()=>{if(action!=='start'&&!confirm(action+' '+server.server_name+'? Connected players may be interrupted.'))return;control.disabled=true;try{const result=await api('action',{node:node.id,instance_id:server.instance_id,action});$('message').textContent=result.ok?'Command accepted. Status updates on the next node heartbeat.':result.error||'Action failed';}catch(e){$('message').textContent=e.message;}finally{control.disabled=!node.online;}});control.disabled=!node.online;actions.append(control);}

  }else{if(me.role==='admin')actions.append(link('Create game server',managementUrl(node,null,'create')));if(me.role==='admin')actions.append(link('Node updates','#node-software'),link('Connection & access',managementUrl(node,null,'connection')));}

  if(me.role!=='viewer')s.append(actions,viewerMessage);

  if(server&&me.role==='admin'){
    let credentialsPromise;const loadCredentials=()=>credentialsPromise??=manageApi(node,'server',server).then(async d=>{let host=d.access?.host;if(host===undefined){try{host=accessHostName((await manageApi(node,'inventory')).host?.access_host);}catch{host='';}}return {...d.server,vnc_password:d.secrets?.secrets?.vnc_password,sftp_host:host||''};});
    viewerSection('Game admin','Opens this server’s web admin panel in a new tab. It’s reachable at a public address, so anyone with the link signs in using the web username and password below.',node,server,'web','Open game admin panel',loadCredentials,['web_username','web_password'],msg=>button('Copy public game panel URL',async()=>{try{const result=await api('launch?'+new URLSearchParams({node:node.id,kind:'web',instance:server.instance_id}),{});msg.replaceChildren(element('span','Public game panel: '),link(result.url,result.url));try{await navigator.clipboard.writeText(result.url);msg.append(element('span',' · Copied'));}catch{msg.append(element('span',' · Select the link to copy its address'));}}catch(e){msg.textContent=e.message;}}));
    viewerSection('VNC console','Opens a remote desktop session for this server’s console through the central dashboard. When it connects, enter the VNC password below.',node,server,'vnc','Open VNC console',loadCredentials,['vnc_password']);
    sftpSection(node,server,loadCredentials);
  }

  if(!server){const fleet=section('Game servers on this node'),grid=element('div',undefined,'grid');fleet.append(grid);nodeFleet=grid;for(const item of node.snapshot?.servers||[])grid.append(serverCard(node,item));if(!grid.children.length)empty(grid,'No game servers have been reported. Use Create game server to add one.');}

  refreshTelemetry();
  if(me.role==='operator')return;

  if(!server)nodeSoftware(node);

  await historyPanel(node,server?server.instance_id:'host',version);if(version!==pageVersion)return;

  if(!server&&me.role==='admin')void nodeNotesPanel(node);

}

async function access(version){

  title('Server Nodes','Create and manage server nodes, publishing tokens and gateway settings.','access');

  if(me.role!=='admin'){redrawFleet=browse('nodes');return;}

  const s=section('Nodes');redrawFleet=browse('admin',s);

  const create=section('Create a node'),form=element('form',undefined,'edit-form');field(form,'Node ID','id','',{required:true,pattern:'[a-z0-9][a-z0-9-]{0,62}',placeholder:'node-1'});field(form,'Display name','name','',{required:true,maxLength:100,placeholder:'Farm host 01'});const submit=element('button','Create node');form.append(submit);create.append(form);

  form.onsubmit=async e=>{e.preventDefault();submit.disabled=true;try{const data=await api('nodes',{...Object.fromEntries(new FormData(form)),createOnly:true});location.href='/nodes/'+encodeURIComponent(data.id);}catch(error){$('message').textContent=error.message;submit.disabled=false;}};

  s.append(element('p','Node connections are set up automatically when Cloudflare automation is enabled. Open a node to see its connection status.'));

}

function guides(install){

  title(install?'Install a node':'Node updates',install?'Every step from a fresh Ubuntu 24.04 install to a running game server, with the same paths as your existing nodes.':'Prepare your control plane and manage node software releases.',install?'install':'setup');

  const tabs=element('div',undefined,'subnav');tabs.append(link('Node updates','/setup'),link('Install a node','/install'));$('page').append(tabs);

  if(install)installGuide();

}

function setupGuidance(){

  const s=section('Control plane setup');s.append(element('p','Configure Discord login, D1 migrations, the publishing-token encryption key, private release storage and the public signing key. Enable Cloudflare automation to create protected node connections.'),link('Control plane setup guide','/central-setup.txt'),link('Release & migration guide','/node-distribution.txt'));

  const recovery=section('Update guidance & recovery');recovery.append(element('p','Publish a signed release and update one pilot node first. Updates preserve running games; control-panel sessions may disconnect. Offline nodes process queued jobs after reconnecting. Keep GitHub public until every existing node has successfully updated from this site.'),element('p','Inspect failed or interrupted updates before retrying. Keep SSH access and off-host game-save backups.'),element('pre','sudo journalctl -u farmservers-update.service -n 100'),element('p','Root-only update backups: /var/backups/farmservers/JOB-ID'));

}

async function render(){

  const version=++pageVersion,r=route();dirty=false;editDirty=false;redrawFleet=undefined;refreshTelemetry=undefined;refreshHistory=undefined;$('page').replaceChildren();$('breadcrumbs').replaceChildren();
  fleetSwitcher(r);

  if(r.type==='overview'){title('Your nodes','Browse every host, check its status and open its details.','overview');$('page').append(summary([['Total nodes',nodes.length],['Online',nodes.filter(n=>n.online).length],['Offline',nodes.filter(n=>n.enabled&&!n.online).length],['Disabled',nodes.filter(n=>!n.enabled).length]]));redrawFleet=browse('nodes');}

  else if(r.type==='servers'){title('Game Servers','Every game server across your fleet, with its latest reported status.','servers');const servers=nodes.flatMap(n=>n.snapshot?.servers||[]);$('page').append(summary([['Game servers',servers.length],['Reporting nodes',nodes.filter(n=>n.online).length]]));if(me.role==='admin'){const create=section('Create a game server'),actions=element('div',undefined,'create-server-actions');create.append(actions);for(const node of nodes.filter(n=>n.enabled))actions.append(link('Create on '+node.name,managementUrl(node,null,'create')));}redrawFleet=browse('servers');}

  else if(r.type==='node'||r.type==='server')await details(r,version);

  else if(r.type==='access')await access(version);

  else if(r.type==='users')await userManagement();

  else if(r.type==='game-status')await gameStatusPage();

  else if(r.type==='cloudflare')await cloudflarePage();

  else if(r.type==='setup'||r.type==='install'){guides(r.type==='install');if(r.type==='setup'&&me.role==='admin'){try{await software();const selected=new URLSearchParams(location.search).get('node');if(selected&&$('update-node'))$('update-node').value=selected;}catch(e){$('message').textContent=e.message;}}if(r.type==='setup')setupGuidance();}

  else {title('Page not found','Choose a page from the navigation.','');$('page').append(link('Overview','/'));}

}

function setLiveStatus(state,message,ping=false){
  const status=$('live-status'),dot=element('span',undefined,'live-status-dot');
  dot.setAttribute('aria-hidden','true');status.dataset.state=state;
  status.replaceChildren(dot,document.createTextNode(message));
  status.title=state==='healthy'?'Live data connection is healthy':state==='error'?'Live data connection failed; displayed values may be stale':'Live updates are paused';
  if(ping&&!document.hidden)dot.classList.add('live-status-ping');
}

async function load(){({nodes}=await api('nodes'));await render();setLiveStatus('healthy','Live - checked '+new Date().toLocaleTimeString(),true);}

async function refresh(){

  if(pending||document.hidden||refreshHistory&&!document.hasFocus())return;pending=true;

  try{const current=await api('me',undefined,{signal:AbortSignal.timeout(15000)});if(current.role!==me.role){location.reload();return;}me=current;updateAccountAvatar();$('user-name').textContent=me.name;({nodes}=await api('nodes',undefined,{signal:AbortSignal.timeout(15000)}));

    if(redrawFleet)redrawFleet();

    if(refreshTelemetry)refreshTelemetry();

    if(refreshHistory)await refreshHistory();

    const currentSummary=$('page').querySelector('.summary');

    if(currentSummary)currentSummary.replaceWith(route().type==='overview'?summary([['Total nodes',nodes.length],['Online',nodes.filter(n=>n.online).length],['Offline',nodes.filter(n=>n.enabled&&!n.online).length],['Disabled',nodes.filter(n=>!n.enabled).length]]):summary([['Game servers',nodes.reduce((sum,n)=>sum+(n.snapshot?.servers?.length||0),0)],['Reporting nodes',nodes.filter(n=>n.online).length]]));

    setLiveStatus('healthy','Live - checked '+new Date().toLocaleTimeString(),true);

  }catch(e){setLiveStatus('error','Reconnecting - '+e.message+' - retrying; values may be stale.');}finally{pending=false;}

}

document.addEventListener('visibilitychange',()=>{if(document.hidden){setLiveStatus('paused','Live updates paused while this tab is hidden');for(const box of document.querySelectorAll('.token-controls'))box.hideToken();}else void refresh();});

window.addEventListener('focus',()=>{if(refreshHistory)void refresh();});

window.addEventListener('pageshow',event=>{if(event.persisted){document.body.hidden=true;location.reload();}});

(async()=>{try{me=await api('me');if(!['admin','operator','viewer'].includes(me.role)){location.replace('/');return;}document.body.hidden=false;$('admin-nav').hidden=me.role==='operator';if(location.pathname.replace(/\/$/,'')==='/access')history.replaceState(null,'','/nodes');$('identity').append(element('strong',me.name),element('p',me.role==='operator'?'Staff':me.role),button('Sign out',async()=>{try{await api('logout',{});location.href='/';}catch(e){$('message').textContent=e.message;}}));

  const legacy={overview:'/',fleet:'/servers',access:'/nodes','node-management':'/nodes',software:'/setup'}[location.hash.slice(1)];if(legacy){location.replace(legacy);return;}

  setupHeader();setupLive();if(me.role==='operator'&&!['servers','server'].includes(route().type)){location.replace('/servers');return;}await load();const query=new URLSearchParams(location.search);if(query.has('launch')){history.replaceState(null,'','/');await openViewer(query.get('launch'),query.get('kind')||'panel',query.get('instance')||'');}

}catch(e){document.body.hidden=false;$('message').textContent=e.message;}let lastPoll=0;setInterval(()=>{const interval=refreshHistory?1000:5000;if(Date.now()-lastPoll>=interval){lastPoll=Date.now();void refresh();}},1000);})();
