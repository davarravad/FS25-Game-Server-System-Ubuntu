async function gameStatusPage(){
  title('Game status','Detect game versions, prepare new nodes and sync approved game files.','game-status');
  const intro=section('Your game library');
  intro.append(element('p','1. Publish game files from a ready node. 2. Approve the version. 3. Sync your other nodes. Empty new nodes can prepare themselves automatically.'),element('p','Transfers resume in the background. Files are verified before use, and updates wait until all game containers on the destination node are stopped. Each server still needs its own game and DLC license activation.','muted'));
  const controls=element('div'),library=element('div',undefined,'game-release-list');intro.append(controls,library);
  const fleet=section('Node readiness'),grid=element('div',undefined,'grid');fleet.append(grid);
  const message=element('p');message.setAttribute('role','status');intro.append(message);
  let busy=false,signature='';const dirtyDlc=new Set();
  const action=async body=>{message.textContent='Saving request…';try{await api('game-status',body);if(body.action==='dlcs')dirtyDlc.delete(body.node+'/'+body.instance);message.textContent='Request saved. Nodes pick up work automatically.';signature='';await draw();}catch(e){message.textContent=e.message;}};
  const draw=async()=>{
    if(busy||!intro.isConnected||document.hidden)return;busy=true;
    try{
      const data=await api('game-status');
      if(!intro.isConnected)return;
      if(dirtyDlc.size)return;
      if(intro.contains(document.activeElement)&&document.activeElement.closest('form')||grid.contains(document.activeElement)&&document.activeElement.closest('form'))return;
      const next=JSON.stringify(data);if(signature===next)return;controls.replaceChildren();library.replaceChildren();grid.replaceChildren();
      const approved=data.releases.find(r=>r.id===data.policy.release_id),auto=element('label',undefined,'game-auto'),checkbox=element('input');checkbox.type='checkbox';checkbox.checked=!!data.policy.auto_bootstrap;checkbox.onchange=()=>action({action:'bootstrap',enabled:checkbox.checked});auto.append(checkbox,element('span','Automatically prepare empty new nodes with the approved version'));
      const sync=button('Sync other nodes',()=>action({action:'sync',node:'all'}));sync.disabled=!approved;controls.append(element('p',approved?'Approved version: '+approved.version:'No approved game version yet.'),auto,sync);
      for(const release of data.releases){const row=element('article',undefined,'game-release'),source=data.nodes.find(n=>n.id===release.source_node);row.append(element('strong','Version '+release.version),element('span',(source?.name||release.source_node)+' · '+bytes(release.bytes)+' · '+stamp(release.created),'muted'));
        if(release.id===data.policy.release_id)row.append(badge('Approved'));else row.append(button('Approve this version',()=>action({action:'approve',release:release.id})));library.append(row);}
      if(!data.releases.length)empty(library,'Publish a complete installation from one of your nodes to create the game library.');
      const packages=approved?JSON.parse(approved.dlcs||'[]'):[];
      for(const node of data.nodes){
        const card=element('article',undefined,'card'),heading=element('div',undefined,'card-heading'),job=data.jobs.find(j=>j.node_id===node.id),active=job&&['queued','running','waiting'].includes(job.status),online=node.enabled&&node.last_seen&&Date.now()/1000-node.last_seen<120;
        heading.append(link(node.name,nodeUrl(node),'card-title'),badge(!node.enabled?'Disabled':!online?'Offline':node.status==='ready'?'Game files ready':node.status==='empty'?'Needs game files':node.status||'Update node software'));card.append(heading,element('p',node.version?'Installed version: '+node.version:'Installed version: not reported'),element('p',node.detail||'Install the latest node software to enable game detection and synchronization.','muted'));
        if(node.updated)card.append(element('p','Last game scan: '+stamp(node.updated),'muted'));
        if(job){card.append(element('p',(job.kind==='publish'?'Publish':'Sync')+': '+job.status),element('p',job.detail,'muted'));if(job.total_bytes){const progress=element('progress');progress.max=job.total_bytes;progress.value=job.done_bytes;progress.setAttribute('aria-label','Game transfer progress for '+node.name);progress.className='game-transfer-progress';card.append(progress,element('p',bytes(job.done_bytes)+' / '+bytes(job.total_bytes)+' · '+Math.round(job.done_bytes/job.total_bytes*100)+'%','muted'));}if(active&&Date.now()/1000-job.updated>300)card.append(element('p','Waiting for the node to reconnect or resume its transfer.','muted'));}
        const actions=element('div',undefined,'actions'),publish=button('Publish installed version',()=>action({action:'publish',node:node.id})),copy=button(job?.status==='failed'?'Retry sync':'Sync approved version',()=>action({action:'sync',node:node.id}));publish.disabled=active||node.status!=='ready'||!node.enabled;copy.disabled=active||!approved||!node.enabled;actions.append(publish,copy,link('Create server',managementUrl(node,null,'create')));card.append(actions);
        const servers=JSON.parse(node.snapshot||'{}')?.servers||[];
        if(servers.length&&packages.length){const details=element('details',undefined,'game-dlc-settings');details.append(element('summary','DLC to sync per server'),element('p','Match the DLC enabled in each server’s game admin. Save selections, then sync this node. Shared DLC installers are copied only for selected packages; license activation remains per server.','muted'));
          for(const server of servers){const form=element('form'),group=element('fieldset');group.append(element('legend',server.server_name));const selected=JSON.parse(data.dlcSettings.find(s=>s.node_id===node.id&&s.instance_id===server.instance_id)?.packages||'[]');
            for(const name of packages){const label=element('label',undefined,'game-auto'),input=element('input');input.type='checkbox';input.name='dlc';input.value=name;input.checked=selected.includes(name);label.append(input,element('span',name));group.append(label);}const save=element('button','Save DLC selections');form.oninput=()=>dirtyDlc.add(node.id+'/'+server.instance_id);form.append(group,save);form.onsubmit=async e=>{e.preventDefault();save.disabled=true;await action({action:'dlcs',node:node.id,instance:server.instance_id,packages:[...new FormData(form).getAll('dlc')]});save.disabled=false;};details.append(form);
          }card.append(details);
        }
        grid.append(card);
      }
      signature=next;
    }catch(e){message.textContent='Game status unavailable: '+e.message;}finally{busy=false;}
  };
  await draw();const timer=setInterval(()=>{if(!intro.isConnected){clearInterval(timer);return;}void draw();},5000);
}
