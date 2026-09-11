'use strict';
const managementUrl=(node,server,tab)=> (server?serverUrl(node,server):nodeUrl(node))+'?tab='+tab;
function managementNavigation(node,server){
  const nav=element('nav',undefined,'management-tabs');nav.setAttribute('aria-label','Management pages');
  const tabs=server?[['overview','Overview'],['logs','Logs & containers']]:[['overview','Overview']];
  if(me.role==='admin')tabs.push(...(server?[['settings','Settings'],['files','Files'],['maintenance','Maintenance']]:[['settings','Host settings'],['connection','Connection & access'],['create','Create game server'],['files','Shared files'],['export','Export & access']]));
  tabs.push(['help','Operator guide']);
  for(const [tab,label] of tabs){const a=link(label,managementUrl(node,server,tab));if((new URLSearchParams(location.search).get('tab')||'overview')===tab)a.setAttribute('aria-current','page');nav.append(a);}
  $('page').append(nav);
}
function manageApi(node,operation,server,body,params={}){
  return api('manage?'+new URLSearchParams({node:node.id,operation,...(server?{instance_id:server.instance_id}:{}),...params}),body,{signal:AbortSignal.timeout(125000)}).then(data=>{if(data.ok===false)throw new Error(data.error||'The node could not complete this operation');return data;});
}
const managementLabels={server_name:'Server name',instance_id:'Instance ID',image_name:'Runtime image',server_players:'Player limit',server_port:'Game port',web_port:'Game admin port',tls_port:'Game TLS port',vnc_port:'VNC port',novnc_port:'Browser VNC port',sftp_port:'SFTP port',server_password:'Join password',server_admin:'Game admin password',web_username:'Web username',web_password:'Web password',sftp_username:'SFTP username',sftp_password:'SFTP password',vnc_password:'VNC password',server_region:'Region',server_map:'Map',server_difficulty:'Difficulty',server_pause:'Pause mode',server_save_interval:'Save interval (seconds)',server_stats_interval:'Stats interval (seconds)',puid:'User ID',pgid:'Group ID',server_crossplay:'Crossplay',autostart_server:'Startup mode',name:'Host name',agent_url:'Agent API URL',access_host:'Game access hostname / IP',agent_token:'Agent token',shared_game_path:'Shared game path',shared_dlc_path:'Shared DLC path',shared_installer_path:'Shared installer path'};
function managementField(form,key,value,creating=false){
  const secret=/password|server_admin|agent_token/.test(key),label=managementLabels[key]||key;
  if(key==='autostart_server'||key==='server_crossplay'){
    const box=element('label',label),input=element('select');input.name=key;
    for(const [v,text] of key==='autostart_server'?[['true','Start game automatically'],['web_only','Game admin only'],['false','Manual start']]:[['true','Enabled'],['false','Disabled']]){const o=element('option',text);o.value=v;input.append(o);}input.value=String(value);box.append(input);form.append(box);return;
  }
  const numeric=/_port$|^server_(players|difficulty|pause|save_interval|stats_interval)$|^p[ug]id$/.test(key);
  const input=field(form,label,key,value??'',{type:secret?'password':numeric?'number':'text',required:!secret&&key!=='agent_token',maxLength:255});
  if(numeric){input.min=key.endsWith('_port')?'1':'0';input.max=key.endsWith('_port')?'65535':key==='server_players'?'16':'2147483647';input.step=key==='server_save_interval'?'0.1':'1';}
  if(key==='instance_id')input.readOnly=!creating;
  if(key==='agent_token')input.placeholder='Saved — leave blank to keep';
  if(secret){input.autocomplete='off';const reveal=button('Show',()=>{input.type=input.type==='password'?'text':'password';reveal.textContent=input.type==='password'?'Show':'Hide';});input.parentElement.append(reveal);}
}
function managementForm(parent,node,server,operation,values,creating=false){
  const form=element('form',undefined,'edit-form');
  if(operation==='host-save'){
    form.classList.add('host-settings-form');
    for(const [heading,description,keys] of [
      ['Host & connection','Identify this host and configure its local agent connection.',['name','access_host','agent_url','agent_token']],
      ['Shared storage','These folders are shared by game servers on this host.',['shared_game_path','shared_dlc_path','shared_installer_path']]
    ]){
      const group=element('fieldset'),grid=element('div',undefined,'host-settings-grid');
      group.append(element('legend',heading),element('p',description,'muted'),grid);
      for(const key of keys)managementField(grid,key,values[key]);
      if(keys.includes('agent_token')){const input=grid.querySelector('[name="agent_token"]'),label=input.parentElement,reveal=label.querySelector('button'),control=element('span',undefined,'host-secret-control');control.append(input,reveal);label.append(control,element('span','Leave blank to keep the saved token.','muted'));input.placeholder='Saved token';}
      form.append(group);
    }
  }else if(creating||operation==='save'){
    form.classList.add('host-settings-form','server-create-form');
    const assigned=new Set();
    const group=(heading,description,keys,parent=form)=>{
      if(!keys.some(key=>key in values))return;
      const box=element('fieldset'),grid=element('div',undefined,'host-settings-grid');
      box.append(element('legend',heading),element('p',description,'muted'),grid);
      for(const key of keys){if(!(key in values))continue;managementField(grid,key,values[key],creating);assigned.add(key);}
      parent.append(box);
    };
    group('Server basics','Choose a name and capacity. The instance ID identifies this server on the host.',['server_name','instance_id','server_players','autostart_server']);
    group('Game options',creating?'Review the suggested map and game settings.':'Update the map, region and available game options.',['server_map','server_region','server_crossplay']);
    const credentials=element('details',undefined,'create-options');credentials.append(element('summary','Passwords & access'),element('p',creating?'Suggested credentials are filled in. Expand to review or change them.':'Expand to review or change web panel and file-transfer access.','muted'));
    group('Player & game admin access','The join password controls player access; the game admin password grants in-game administration.',['server_password','server_admin'],credentials);
    group('Management access','Credentials for the web panel, file transfers and remote desktop.',['web_username','web_password','sftp_username','sftp_password','vnc_password'],credentials);form.append(credentials);
    const advanced=element('details',undefined,'create-options');advanced.append(element('summary','Advanced settings'),element('p',creating?'Keep the host’s suggested values unless your setup requires changes.':'Network ports and container configuration. Change these only when your setup requires it.','muted'));
    group('Network ports','Each server on this host needs its own ports.',['server_port','web_port','tls_port','vnc_port','novnc_port','sftp_port'],advanced);
    group('Game tuning','Node-provided difficulty and pause codes, plus save and statistics intervals. Keep the defaults unless you need different behavior.',['server_difficulty','server_pause','server_save_interval','server_stats_interval'],advanced);
    group('Runtime','Container image and filesystem ownership used by the server.',['image_name','puid','pgid'],advanced);
    const remaining=Object.keys(values).filter(key=>!assigned.has(key));if(remaining.length)group('Additional options','Other defaults supplied by this host.',remaining,advanced);form.append(advanced);
    for(const input of form.querySelectorAll('input[type="password"]')){const label=input.parentElement,reveal=label.querySelector('button'),control=element('span',undefined,'host-secret-control');control.append(input,reveal);label.append(control);}
    form.addEventListener('invalid',event=>{for(let parent=event.target.parentElement;parent&&parent!==form;parent=parent.parentElement)if(parent.tagName==='DETAILS')parent.open=true;},true);
  }else for(const [key,value] of Object.entries(values))managementField(form,key,value,creating);
  const submit=element('button',creating?'Create game server':'Save settings'),message=element('p');message.setAttribute('role','status');
  if(operation==='host-save'||creating||operation==='save'){const actions=element('div',undefined,'host-settings-actions');actions.append(submit,message);form.append(actions);parent.append(form);}else{form.append(submit);parent.append(form,message);}
  form.onsubmit=async event=>{event.preventDefault();submit.disabled=true;message.textContent=creating?'Creating game server…':'Saving and applying settings…';
    try{const result=await manageApi(node,operation,server,Object.fromEntries(new FormData(form)));message.textContent=result.message||'Saved.';dirty=false;
      if(creating){form.replaceChildren(message,link('Open new server',serverUrl(node,{instance_id:result.instance_id})),link('Create another server',managementUrl(node,null,'create')));}
    }catch(error){message.textContent=error.message;}finally{submit.disabled=false;}};
}
async function managementPage(node,server,tab){
  if(tab==='connection'&&!server&&me.role==='admin'){nodeEditor(node);return;}
  const panel=section(({settings:server?'Game server settings':'Host settings',create:'Create game server',files:server?'Server files':'Shared files',logs:'Logs & containers',maintenance:'Server maintenance',export:'Export & access',help:'Operator guide'})[tab]||'Management');
  const loading=element('p','Loading node…');panel.append(loading);
  try{
    if(tab==='help'){loading.remove();managementHelp(panel,!!server);return;}
    if(me.role!=='admin'&&tab!=='logs')throw new Error('Administrator access required.');
    if(tab==='logs'){loading.remove();managementLogs(panel,node,server);return;}
    if(tab==='files'){loading.remove();managementFiles(panel,node,server);return;}
    if(tab==='maintenance'){
      loading.remove();panel.append(element('p','Choose the maintenance action for '+server.server_name+'. Each action applies to this game server. Review its impact before confirming.'));
      const cards=element('div',undefined,'maintenance-grid');panel.append(cards);let active=false;
      const actions=[
        {operation:'command',action:'backend_reboot',label:'Restart game process',title:'Restart server process',icon:'↻',tone:'routine',tag:'Process recovery',description:'Stops the dedicated server process and lets its launcher bring it back online.',use:'Use when the dedicated server or game admin stops responding while the container is still running.',impact:'The runtime container must be running. Server availability may be interrupted while the launcher restarts the process.',data:'Existing files and settings stay in place. Save progress before restarting.',pending:'Restart requested. Waiting for the node…',done:'Restart command completed. Check Logs & containers to confirm the process is back online.'},
        {operation:'reinstall',action:'reinstall_game',label:'Recreate game container',title:'Recreate game container',icon:'◇',tone:'disruptive',tag:'Game downtime',description:'Replaces and starts this server’s game runtime container using its configured image and saved settings.',use:'Use when the game container is unhealthy or a process restart has not resolved the problem.',impact:'Players, game admin and VNC sessions disconnect while the container restarts.',data:'Mounted saves, mods, configuration and shared game files are retained. This does not reinstall the licensed game files.',pending:'Recreating the game container. This may take a few minutes…',done:'Game container recreated. Check its status and logs before players reconnect.'},
        {operation:'reinstall',action:'reinstall_sftp',label:'Recreate SFTP container',title:'Repair file-transfer access',icon:'⇄',tone:'routine',tag:'SFTP downtime',description:'Replaces and starts the SFTP container used to transfer this server’s profile files.',use:'Use when SFTP connections fail or the file-transfer service is unhealthy.',impact:'Active SFTP connections and transfers disconnect. The game container continues running.',data:'Profile files and configured SFTP credentials are retained.',pending:'Recreating the SFTP container…',done:'SFTP container recreated. Reconnect your file-transfer client.'},
        {operation:'delete',action:'',label:'Permanently delete server',title:'Delete game server',icon:'×',tone:'danger',tag:'Permanent deletion',description:'Removes this game server, its containers and its instance directory from the node.',use:'Use only when you are retiring this instance and have copied everything you need.',impact:'The server goes offline and its instance configuration, saves, mods and logs are deleted.',data:'Shared game, DLC and installer folders remain. Deleted instance files cannot be restored from this page.',pending:'Deleting the server and its instance files…',done:'Server deleted.'}
      ];
      for(const item of actions){
        const card=element('article',undefined,'maintenance-card maintenance-'+item.tone),header=element('div',undefined,'maintenance-heading'),icon=element('span',item.icon,'maintenance-icon');icon.setAttribute('aria-hidden','true');
        const heading=element('div');heading.append(element('span',item.tag,'maintenance-tag'),element('h3',item.title));header.append(icon,heading);card.append(header,element('p',item.description,'maintenance-description'));
        const facts=element('dl');for(const [label,text]of [['When to use',item.use],['Service impact',item.impact],['Files & settings',item.data]])facts.append(element('dt',label),element('dd',text));card.append(facts);
        const confirm=element('details',undefined,'maintenance-confirm');confirm.append(element('summary',item.operation==='delete'?'Review deletion & confirm':'Review & confirm'));
        const form=element('form',undefined,'maintenance-form'),code=field(form,'Type '+server.instance_id+' to confirm','code','',{required:true,autocomplete:'off',spellcheck:false,placeholder:server.instance_id});
        code.setAttribute('aria-label','Confirm '+item.title+' by typing '+server.instance_id);
        const submit=element('button',item.label),message=element('p');message.setAttribute('role','status');message.className='maintenance-message';submit.disabled=true;form.append(submit,message);confirm.append(form);card.append(confirm);cards.append(card);
        const validate=()=>{submit.disabled=active||code.value!==server.instance_id;};code.oninput=validate;
        form.onsubmit=async event=>{event.preventDefault();if(active||code.value!==server.instance_id)return;active=true;for(const b of cards.querySelectorAll('button'))b.disabled=true;message.textContent=item.pending;card.setAttribute('aria-busy','true');
          try{await manageApi(node,item.operation,server,{action:item.action,delete_code:code.value,reinstall_code:code.value});message.textContent=item.done;code.value='';if(item.operation==='delete'){dirty=false;location.href=nodeUrl(node);}}
          catch(e){message.textContent=e.message;}
          finally{active=false;card.removeAttribute('aria-busy');for(const input of cards.querySelectorAll('input'))input.oninput();}
        };
      }return;    }
    if(tab==='settings'&&server){const data=await manageApi(node,'server',server);loading.remove();managementForm(panel,node,server,'save',data.server);if(data.secrets?.secrets)managementSecrets(panel,data.secrets.secrets);return;}
    const data=await manageApi(node,'inventory');loading.remove();
    if(tab==='create'){panel.append(element('p','Ports and credentials are suggested by this node. Prepare shared game and installer files before creating a server.'));managementForm(panel,node,null,'create',data.defaults,true);}
    else if(tab==='settings'){
      const values={};for(const key of ['name','agent_url','access_host','shared_game_path','shared_dlc_path','shared_installer_path'])values[key]=data.host[key];values.agent_token='';managementForm(panel,node,null,'host-save',values);
      const storage=element('div',undefined,'host-storage-action'),message=element('p');message.setAttribute('role','status');
      const prepare=button('Prepare shared storage',async()=>{prepare.disabled=true;message.textContent='Preparing storage…';try{await manageApi(node,'prepare',null,{});message.textContent='Shared storage prepared.';}catch(e){message.textContent=e.message;}finally{prepare.disabled=false;}});
      storage.append(element('h3','Prepare folders'),element('p','Save any path changes first, then prepare the shared folders on this host.'),prepare,message);panel.append(storage);
      const health=element('div',undefined,'host-health');health.append(element('h3','Agent health'),badge(data.health?.ok?'Healthy':'Needs attention'));
      const diagnostics=element('details');diagnostics.append(element('summary','Technical details'),element('pre',JSON.stringify(data.health,null,2)));health.append(diagnostics);panel.append(health);
    }else if(tab==='export'){
      panel.append(element('p','The settings export contains server credentials. Keep the downloaded file private.'),link('Download settings for all servers on this node','/api/manage?'+new URLSearchParams({node:node.id,operation:'export'})));
      if(data.sftp)managementSecrets(panel,Object.fromEntries(Object.entries(data.sftp).filter(([key])=>key.startsWith('admin_sftp_'))));
    }
  }catch(error){loading.textContent=error.message;panel.append(link('Node software & updates',nodeUrl(node)+'#node-software'),link('Cloudflare connections','/cloudflare'));}
}
function managementSecrets(parent,values){const box=element('details'),heading=element('summary','Connection credentials');box.append(heading);for(const [key,value] of Object.entries(values)){const form=element('div',undefined,'edit-form');managementField(form,key,value);for(const input of form.querySelectorAll('input'))input.readOnly=true;box.append(form);}parent.append(box);}
function managementLogs(panel,node,server){
  const toolbar=element('div',undefined,'actions'),label=element('label','Include Docker logs'),docker=element('input');docker.type='checkbox';label.append(docker);const message=element('p'),state=element('p'),containers=element('div'),runtime=element('pre'),dockerOutput=element('pre');let busy=false;
  for(const [output,name] of [[runtime,'Runtime logs'],[dockerOutput,'Docker logs']]){output.className='log-output';output.tabIndex=0;output.setAttribute('role','region');output.setAttribute('aria-label',name);}
  const updateLog=(output,text)=>{if(output.textContent===text)return;const top=output.scrollTop,left=output.scrollLeft;output.textContent=text;output.scrollTop=top;output.scrollLeft=left;};
  const refresh=async()=>{if(busy||!panel.isConnected||document.hidden)return;busy=true;try{const data=await manageApi(node,'live',server,undefined,{include_docker_logs:docker.checked?'1':'0'});if(!panel.isConnected)return;state.textContent=data.metrics?.runtime_state?.label+' — '+data.metrics?.runtime_state?.detail;containers.replaceChildren(...(data.metrics?.containers||[]).map(c=>element('p',`${c.service}: ${c.status}${c.health?' · '+c.health:''}${c.exit_code!=null?' · exit '+c.exit_code:''}`)));updateLog(runtime,data.log_output||'No game logs.');dockerOutput.hidden=!docker.checked;updateLog(dockerOutput,data.docker_log_output||'');message.textContent='Updated '+new Date().toLocaleTimeString();}catch(e){message.textContent=e.message;}finally{busy=false;}};
  toolbar.append(label,button('Refresh logs',refresh));panel.append(toolbar,message,state,containers,element('h3','Runtime logs'),runtime,dockerOutput);docker.onchange=refresh;void refresh();const timer=setInterval(()=>{if(!panel.isConnected){clearInterval(timer);return;}void refresh();},5000);
}
function managementFiles(panel,node,server){
  const controls=element('div',undefined,'actions'),target=element('select');target.setAttribute('aria-label','File location');for(const value of server?['profile','mods','saves','logs']:['game','dlc','installer']){const o=element('option',value);o.value=value;target.append(o);}
  const path=element('p'),message=element('p'),list=element('div'),upload=element('form'),file=element('input'),submit=element('button','Upload file'),meter=element('progress');file.type='file';file.required=true;file.setAttribute('aria-label','File to upload');meter.max=100;meter.value=0;let subpath='',uploading=false;
  const refresh=async()=>{try{const data=await manageApi(node,'files',server,undefined,{target:target.value,subpath});path.textContent=data.path||subpath||'/';list.replaceChildren();for(const item of data.files||[]){const row=element('div',undefined,'file-row');row.append(item.is_dir?button(item.name+' /',()=>{if(uploading)return;subpath=item.relative_path;void refresh();}):element('span',item.name),element('span',item.is_dir?'Folder':bytes(item.size)),element('span',stamp(item.modified_at)));if(!server&&target.value==='installer'&&!subpath&&/\.zip$/i.test(item.name))row.append(button('Extract installer',async()=>{if(!confirm('Extract '+item.name+' into shared installer storage?'))return;message.textContent='Extracting…';try{await manageApi(node,'unzip',null,{filename:item.name});message.textContent='Extracted.';await refresh();}catch(e){message.textContent=e.message;}}));list.append(row);}if(!list.children.length)list.append(element('p','This folder is empty.'));}catch(e){message.textContent=e.message;}};
  controls.append(target,button('Up one folder',()=>{if(uploading)return;subpath=subpath.split('/').slice(0,-1).join('/');void refresh();}),button('Refresh files',refresh));target.onchange=()=>{subpath='';void refresh();};
  upload.append(file,submit,meter);panel.append(controls,path,message,list,element('h3','Upload to this folder'),upload);
  upload.onsubmit=async event=>{event.preventDefault();const selected=file.files[0];if(!selected||uploading)return;if(!confirm('Upload '+selected.name+' here? An existing file with this name will be replaced.'))return;uploading=true;dirty=true;submit.disabled=true;target.disabled=true;
    const chosenTarget=target.value,chosenPath=subpath;
    try{const chunkSize=2*1024*1024;for(let offset=0;offset<selected.size||offset===0;offset+=chunkSize){const end=Math.min(selected.size,offset+chunkSize),query=new URLSearchParams({node:node.id,operation:'upload',...(server?{instance_id:server.instance_id}:{}),target:chosenTarget,subpath:chosenPath,filename:selected.name,offset:String(offset),total_size:String(selected.size),is_last:end===selected.size?'1':'0'});
      const r=await fetch('/api/manage?'+query,{method:'POST',headers:{'Content-Type':'application/octet-stream','X-CSRF-Token':me.csrf},body:selected.slice(offset,end),signal:AbortSignal.timeout(125000)}),result=await r.json();if(!r.ok||result.ok===false)throw new Error(result.error||'Upload failed');meter.value=selected.size?end/selected.size*100:100;message.textContent='Uploaded '+bytes(end)+' / '+bytes(selected.size);if(end===selected.size)break;}
      message.textContent='Upload completed.';file.value='';await refresh();
    }catch(e){message.textContent=e.message+' — select the file again to restart the upload.';}finally{uploading=false;dirty=false;submit.disabled=false;target.disabled=false;}};
  void refresh();
}
function managementHelp(panel,server){
  const steps=server?[
    ['Settings','Edit the name, image, ports, map, region, player limit and SFTP/web credentials. Saved settings sync to the node. Use Game admin for gameplay settings managed by the game itself.'],
    ['Game installation','Open VNC console, run Setup to install licensed game files, then Setup Server to prepare the instance. Use Start on the overview when ready.'],
    ['Files','Browse and upload profile files, mods, saves and logs. Large files upload in small chunks with progress.'],
    ['Logs & containers','Inspect game logs, optionally Docker logs, and each container’s status, health and exit code.'],
    ['Maintenance','Restart the game process, reinstall the game or SFTP container, or delete the server. Each operation requires its instance ID. Deletion removes instance data.']
  ]:[
    ['Host settings','Configure the local agent connection and shared game, DLC and installer paths. Prepare shared storage before installing games.'],
    ['Shared files','Upload licensed installers to installer storage and extract ZIP archives there. Game and DLC storage are shared across servers on this host.'],
    ['Create game server','Review suggested ports and generated passwords, select map and startup options, then create the instance. Complete game installation from its VNC console.'],
    ['Export & access','Download all server settings as an Excel-compatible file and view node SFTP connection information. Exports contain passwords.'],
    ['Connection & access','Rename the node, enable or disable it, follow its Cloudflare connection, rotate the gateway credentials or publishing token, and recreate every server after configuration changes. Enable automatic connections on the Cloudflare page.'],
    ['Node software','Install new node releases from the Node software section on the Overview tab, or update several nodes at once from Node updates.']
  ];for(const [name,text] of steps)panel.append(element('h3',name),element('p',text));panel.append(link('Installation and recovery instructions','/node-distribution.txt'));
}

async function nodeNotesPanel(node){
  if(me.role!=='admin')return;
  const panel=section('Admin notes'),form=element('form',undefined,'node-notes-form'),label=element('label','Node information and notes'),input=element('textarea'),meta=element('p',undefined,'muted'),message=element('p'),actions=element('div',undefined,'actions'),save=element('button','Save notes');
  input.rows=7;input.maxLength=10000;input.placeholder='Location, hardware details, maintenance reminders, or other node information';input.disabled=true;label.append(input);message.setAttribute('role','status');save.disabled=true;
  let version=0,edited=false;
  const draw=data=>{input.value=data.notes;version=data.version;edited=false;input.disabled=false;save.disabled=false;meta.textContent=data.updated?'Last saved '+stamp(data.updated)+(data.updatedBy?' by '+data.updatedBy:''):'No notes saved yet.';};
  const reload=button('Load saved notes',async()=>{if(edited&&!confirm('Discard your unsaved notes and load the saved version?'))return;reload.disabled=true;try{draw(await api('nodes/notes?'+new URLSearchParams({id:node.id})));message.textContent='Saved notes loaded.';}catch(e){message.textContent=e.message;}finally{reload.disabled=false;}});
  actions.append(save,reload);form.append(label,actions);panel.append(element('p','Only administrators can view or edit these notes. Notes are saved on the main site, even when the node is offline.'),form,meta,message);
  input.oninput=()=>{edited=true;};
  form.onsubmit=async event=>{event.preventDefault();save.disabled=true;reload.disabled=true;input.readOnly=true;try{draw(await api('nodes/notes',{id:node.id,notes:input.value,version}));message.textContent='Notes saved.';}catch(e){message.textContent=e.message;}finally{save.disabled=false;reload.disabled=false;input.readOnly=false;}};
  try{const data=await api('nodes/notes?'+new URLSearchParams({id:node.id}));if(panel.isConnected)draw(data);}catch(e){message.textContent=e.message;}
}
