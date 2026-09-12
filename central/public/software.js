const compareVersions=(a,b)=>{const x=a.slice(1).split('.').map(Number),y=b.slice(1).split('.').map(Number);return x[0]-y[0]||x[1]-y[1]||x[2]-y[2];};

// Panel & console readiness: one pass over every enabled node and each of its game servers,
// checking what the main-site game admin panel and VNC console need. The check is read-only;
// each finding that needs attention carries its own repair button or link. The last report is
// kept so it survives the page being rebuilt (the Node updates page rebuilds itself when the
// site's audit revision changes, which the check and every repair cause).
let lastReadiness=null,lastReadinessStatus='';
function readinessPanel(){
  if($('readiness'))return;
  const panel=section('Panel & console readiness');panel.id='readiness';
  panel.append(element('p','Checks every enabled node and each of its game servers for what the game admin panels and VNC console need: the Cloudflare connection, gateway reachability, the console bypass, the installed release, DNS for each panel hostname, and each container\'s network and port setup. The check changes nothing; every finding that needs attention has a repair action next to it.','muted'));
  const run=button('Check all nodes',()=>{}),status=element('p'),results=element('div');status.setAttribute('role','status');status.setAttribute('aria-live','polite');results.id='readiness-results';
  panel.append(run,status,results);
  const mark=state=>element('span',state==='pass'?'OK':state==='warn'?'Attention':'Problem','badge '+(state==='pass'?'good':state==='warn'?'warning':'bad'));
  const say=text=>{lastReadinessStatus=text;status.textContent=text;};
  const runCheck=async()=>{
    run.disabled=true;say('Checking every node… this can take up to a minute per node.');
    try{const report=await api('readiness',{});lastReadiness=report;render(report);const findings=report.nodes.flatMap(n=>[...n.checks,...n.servers.flatMap(s=>s.checks)]).filter(c=>c.state!=='pass').length;say('Checked '+report.nodes.length+' node(s) at '+stamp(report.generated)+(findings?' · '+findings+' finding(s) need attention.':' · everything is ready.'));}
    catch(e){say(e.message);}
    finally{run.disabled=false;}
  };
  const repairControl=check=>{
    const repair=check.repair;if(!repair)return null;
    if(repair.href)return link(repair.label,repair.href,'text-link readiness-repair');
    const control=button(repair.label,async()=>{
      if(repair.confirm&&!confirm(repair.confirm))return;
      control.disabled=true;say(repair.label+'…');
      try{const result=await api(repair.api,repair.body);say(result.message||(result.ok===false?(result.error||repair.label+' failed.'):repair.label+' done. Re-checking…'));await runCheck();}
      catch(e){say(e.message);control.disabled=false;}
    });control.className='readiness-repair';return control;
  };
  const list=checks=>{const ul=element('ul',undefined,'readiness-list');for(const check of checks){const li=element('li');li.append(mark(check.state),element('strong',' '+check.name+': '),document.createTextNode(check.detail+' '));const control=repairControl(check);if(control)li.append(control);ul.append(li);}return ul;};
  const render=report=>{
    results.replaceChildren();
    if(!report.nodes.length){results.append(element('p','No enabled nodes to check.','muted'));return;}
    for(const node of report.nodes){
      const block=element('div',undefined,'readiness-node'),all=[...node.checks,...node.servers.flatMap(s=>s.checks)];
      const worst=all.some(c=>c.state==='fail')?'fail':all.some(c=>c.state==='warn')?'warn':'pass';
      const heading=element('h3');heading.append(link(node.name,'/nodes/'+encodeURIComponent(node.id),'text-link'),document.createTextNode(node.online?' ':' (offline) '),mark(worst));
      block.append(heading,list(node.checks));
      if(!node.servers.length)block.append(element('p','No game servers reported on this node.','muted'));
      for(const server of node.servers){const title=element('h4');title.append(link(server.server_name+' ('+server.instance_id+')','/servers/'+encodeURIComponent(node.id)+'/'+encodeURIComponent(server.instance_id),'text-link'));block.append(title,list(server.checks));}
      results.append(block);
    }
  };
  run.onclick=runCheck;
  if(lastReadiness){render(lastReadiness);status.textContent=lastReadinessStatus;}
}
function nodeSoftware(node){
  const panel=section('Node software');panel.id='node-software';
  const contents=element('div'),message=element('p');message.setAttribute('role','status');message.setAttribute('aria-live','polite');panel.append(contents,message);
  let loading=false,acting=false,previousStatus='';
  const refresh=async()=>{
    if(loading||acting||!panel.isConnected||document.hidden)return;loading=true;
    try{
      const data=await api('nodes/software?'+new URLSearchParams({node:node.id}));if(!panel.isConnected)return;
      const current=data.installed_version,releases=data.releases.sort((a,b)=>compareVersions(b.version,a.version)),latest=releases[0],active=data.jobs.find(j=>['queued','running'].includes(j.status));
      contents.replaceChildren(element('p','Installed version: '+(current||'Not reported'),'capacity-value'));
      if(data.version_source==='successful_update')contents.append(element('p','Version from the last successful update.','muted'));
      if(!current)contents.append(element('p','This node has not reported its installed release yet. A successful managed update will record it.','muted'));
      contents.append(element('p','Latest published release: '+(latest?.version||'None')));
      const newer=latest&&current&&compareVersions(latest.version,current)>0;
      if(current&&latest&&!newer)contents.append(badge(compareVersions(current,latest.version)===0?'Up to date':'Installed version is newer than published releases'));
      if(me.role==='admin'&&latest&&(newer||!current)&&!active){
        const update=button((current?'Update to ':'Install release ')+latest.version,async()=>{
          if(!confirm(`Update ${node.name} to ${latest.version}? Running games remain active; control-panel sessions may disconnect.${node.online?'':' The node will start when it reconnects.'}`))return;
          acting=true;update.disabled=true;
          try{await api('distribution/updates',{node:node.id,version:latest.version});message.textContent='Update queued.';}
          catch(e){message.textContent=e.message;}
          finally{acting=false;await refresh();}
        });update.disabled=!node.enabled;contents.append(update);
        if(!node.enabled)contents.append(element('p','Enable this node before requesting an update.','muted'));
      }else if(newer&&me.role!=='admin')contents.append(element('p','An update is available. An administrator can start it.'));
      const job=active||data.jobs[0];
      if(job){
        const labels={queued:'Queued — waiting for the node',running:'Running — the node is applying the update',succeeded:'Succeeded — update completed',failed:'Failed or cancelled — inspect node logs before retrying'};
        const progress=element('div',undefined,'update-progress');progress.append(element('h3','Update progress'),element('p',job.version+' · '+labels[job.status]),element('p','Last update: '+stamp(job.updated),'muted'));
        if(['queued','running'].includes(job.status)){const meter=element('progress');meter.setAttribute('aria-label','Update in progress');progress.append(meter,element('p',job.status==='queued'?'Nodes check for updates about once a minute. Offline nodes wait until reconnecting.':'Waiting for the node to report success or failure. This may take several minutes.','muted'));}
        if(job.status==='queued'&&me.role==='admin')progress.append(button('Cancel queued update',async()=>{acting=true;try{const result=await api('distribution/cancel',{id:job.id});message.textContent=result.ok?'Queued update cancelled.':'The update has already started; it cannot be cancelled.';}catch(e){message.textContent=e.message;}finally{acting=false;await refresh();}}));
        contents.append(progress);
        const status=job.id+job.status;if(previousStatus&&status!==previousStatus)message.textContent=labels[job.status];previousStatus=status;
      }else contents.append(element('p','No update jobs for this node yet.','muted'));
      contents.append(element('p','Update status refreshes every 5 seconds.','muted'));
    }catch(e){message.textContent=e.message+' — retrying automatically.';}finally{loading=false;}
  };
  const timer=setInterval(()=>{if(!panel.isConnected){clearInterval(timer);return;}void refresh();},5000);
  void refresh();
}

async function software(){
  if(me?.role!=='admin')return;
  if($('software'))return $('software').refreshUpdates();
  const panel=section('Node updates');panel.id='software';
  panel.append(element('p','Update individual nodes or all enabled nodes to the latest release. Offline nodes wait until they reconnect. Nodes already current or updating are skipped.'));
  const message=element('p');message.id='software-message';message.setAttribute('role','status');
  const all=button('Update all to latest',()=>{});
  const allSection=element('div',undefined,'update-section');
  allSection.append(element('p','Queues this release for every enabled node that is not already running it. Offline nodes update when they reconnect; nodes already current or mid-update are skipped.','muted'),all);

  const form=element('form'),node=element('select'),release=element('select');node.id='update-node';node.setAttribute('aria-label','Node to update');release.id='update-release';release.setAttribute('aria-label','Release version');
  const queue=element('button','Update selected node');form.append(node,release,queue);
  const formSection=element('div',undefined,'update-section');
  formSection.append(element('p','Queue a one-off update for a single node, without waiting for "Update all to latest".','muted'),form);

  const withdraw=button('Withdraw selected release',()=>{});withdraw.className='danger-button';
  const withdrawSection=element('div',undefined,'update-section');
  withdrawSection.append(element('p','Withdraws the release picked above for everyone — not just the node above. Stops new downloads and fails any jobs still queued for it. Nodes that already finished updating keep running it.','muted'),withdraw);

  const latestLabel=element('p'),historyStatus=element('p');historyStatus.setAttribute('role','status');
  const wrap=element('div',undefined,'update-table-wrap'),table=element('table',undefined,'update-table'),head=element('thead'),heading=element('tr');
  for(const label of ['Node','Version','Status','Queued','Last updated','Actions']){const cell=element('th',label);cell.scope='col';heading.append(cell);}head.append(heading);const rows=element('tbody');table.append(element('caption','Node update history'),head,rows);wrap.append(table);
  const more=button('Load more',async()=>{pages++;try{await refresh();}catch(e){pages--;message.textContent=e.message;}}),manual=button('Refresh update status',()=>refresh().catch(e=>{message.textContent=e.message;}));
  const historySection=element('div',undefined,'update-section');
  historySection.append(element('p','History of update jobs queued by either action above, across all nodes. Refreshes automatically every 5 seconds.','muted'),manual);
  panel.append(latestLabel,allSection,formSection,withdrawSection,message,historySection,historyStatus,wrap,more);
  let pages=1,latest='',loading=false,acting=false;
  const controls=disabled=>{for(const control of [all,queue,withdraw,more,manual])control.disabled=disabled;};
  const refresh=async()=>{
    if(loading||!panel.isConnected)return;loading=true;controls(true);
    try{
      const [releases,fleet]=await Promise.all([api('distribution/releases'),api('nodes')]);releases.sort((a,b)=>compareVersions(b.version,a.version));latest=releases[0]?.version||'';
      let cursor=null,jobs=[];
      for(let page=0;page<pages;page++){const data=await api('distribution/updates'+(cursor?'?'+new URLSearchParams({cursor}):''));jobs.push(...data.jobs);cursor=data.nextCursor;if(!cursor)break;}
      if(!panel.isConnected)return;
      for(const[select,items]of [[node,fleet.nodes.filter(n=>n.enabled).map(n=>[n.id,n.name])],[release,releases.map(r=>[r.version,r.version])]]){const previous=select.value;select.replaceChildren(...items.map(([value,label])=>{const option=element('option',label);option.value=value;return option;}));if(items.some(([value])=>value===previous))select.value=previous;}
      latestLabel.textContent='Latest release: '+(latest||'None published');all.textContent='Update all to latest'+(latest?' ('+latest+')':'');
      rows.replaceChildren(...jobs.map(job=>{
        const row=element('tr'),name=element('td'),status=element('td'),actions=element('td');name.append(link(job.node_name||job.node_id,'/nodes/'+encodeURIComponent(job.node_id),'text-link'),element('div',job.node_id,'muted'));
        const labels={queued:'Queued — waiting for node',running:'Running — applying update',succeeded:'Succeeded',failed:'Failed / cancelled'};status.append(badge(labels[job.status]||job.status));
        if(job.status==='queued'){const cancel=button('Cancel',()=>run(async()=>{const result=await api('distribution/cancel',{id:job.id});return result.ok?'Queued update cancelled.':'Update has already started.';}));cancel.setAttribute('aria-label','Cancel update for '+job.node_id);actions.append(cancel);}
        if(job.status==='failed')actions.append(element('span','Inspect node logs before retrying.','muted'));
        row.append(name,element('td',job.version),status,element('td',stamp(job.created)),element('td',stamp(job.updated)),actions);row.title='Process ID: '+job.id;return row;
      }));
      historyStatus.textContent=jobs.length?'Showing '+jobs.length+' updates · newest first · refreshes every 5 seconds.':'No update jobs yet.';more.hidden=!cursor;
    }finally{loading=false;controls(acting);all.disabled=acting||!latest;queue.disabled=acting||!node.value||!release.value;withdraw.disabled=acting||!release.value;}
  };
  const run=async action=>{if(acting||loading)return;acting=true;controls(true);try{message.textContent=await action();}catch(e){message.textContent=e.message;}finally{acting=false;await refresh().catch(e=>{message.textContent=e.message;});}};
  form.onsubmit=event=>{event.preventDefault();if(node.value&&release.value&&confirm('Update '+node.value+' to '+release.value+'? Control services may briefly disconnect.'))void run(async()=>{await api('distribution/updates',{node:node.value,version:release.value});return 'Update queued.';});};
  all.onclick=()=>{if(latest&&confirm('Update all eligible enabled nodes to '+latest+'? Control services may briefly disconnect. Offline nodes will update when they reconnect.'))void run(async()=>{const result=await api('distribution/update-all',{version:latest});return result.queued+' node update(s) queued for '+result.version+'. Nodes already current, disabled or updating were skipped.';});};
  withdraw.onclick=()=>{if(release.value&&confirm('Withdraw '+release.value+'? New downloads stop and queued jobs fail.'))void run(async()=>{await api('distribution/withdraw',{version:release.value});return 'Release withdrawn.';});};
  panel.refreshUpdates=refresh;
  readinessPanel();
  const timer=setInterval(()=>{if(!panel.isConnected){clearInterval(timer);return;}if(!document.hidden&&!acting)void refresh().catch(e=>{message.textContent=e.message+' — retrying automatically.';});},5000);
  await refresh();
}
