'use strict';
// Server status board for one game server: everything the server depends on, in one place. It joins the node's live runtime
// report (is the game up, container health, resource headroom) with the read-only readiness check (containers wired up,
// public ports, VNC and game panel hostnames, Cloudflare connection, node software). Anything that is not healthy carries its
// repair next to it. The model builder is a pure function so it can be tested without a browser.
const statusGroups=[
  ['runtime','Game server','Is the game running and answering?'],
  ['containers','Containers','The game and file-transfer containers on the node'],
  ['domains','Domains','Public addresses for the game panel and the VNC console'],
  ['ports','Ports & security','What players and admins connect through'],
  ['node','Node & connection','The host, its Cloudflare tunnel and its software']
];
const statusRank={pass:0,warn:1,fail:2};
const worstState=checks=>checks.reduce((worst,check)=>statusRank[check.state]>statusRank[worst]?check.state:worst,'pass');
const liveContainerText=container=>[container.name,container.status,container.health?'health: '+container.health:'',container.exit_code!=null&&!container.running?'exit code '+container.exit_code:''].filter(Boolean).join(' · ');
const percentText=value=>(Number(value)||0).toFixed(0)+'%';
const sizeText=value=>{const n=Number(value)||0,i=Math.min(4,Math.floor(Math.log(Math.max(n,1))/Math.log(1024)));return (n/1024**i).toFixed(i>1?1:0)+' '+['B','KB','MB','GB','TB'][i];};

// What the node's live report says about the game process and its resources.
function liveChecks(live,node,server){
  const control=(label,action,confirmText)=>({label,api:'action',body:{node:node.id,instance_id:server.instance_id,action},...(confirmText?{confirm:confirmText}:{})});
  if(!live?.metrics)return [{name:'Live status',group:'runtime',state:'warn',detail:'The node has not reported live status yet.'}];
  const metrics=live.metrics,runtime=metrics.runtime_state||{state:'offline',label:'Offline',detail:''},checks=[];
  const text=(runtime.label||'')+(runtime.detail?' — '+runtime.detail:'');
  if(runtime.state==='online')checks.push({name:'Game server',group:'runtime',state:'pass',detail:text||'Online.'});
  else if(runtime.state==='booting')checks.push({name:'Game server',group:'runtime',state:'warn',detail:text||'Starting up.'});
  else if(runtime.state==='degraded')checks.push({name:'Game server',group:'runtime',state:'fail',detail:text||'Some required containers are not healthy.',repair:control('Restart server','restart','Restart '+server.server_name+'? Connected players will be disconnected.')});
  else checks.push({name:'Game server',group:'runtime',state:'warn',detail:text||'The server is stopped.',repair:control('Start server','start')});
  if(['online','booting','degraded'].includes(runtime.state)){
    // Docker reports a container's CPU as a total across cores (999% is about ten busy cores), so the board shows the host's
    // overall CPU instead, which the node already reports as a true 0-100% share. Only memory and disk can raise a finding.
    const hostCpu=node.snapshot?.samples?.find(item=>item.scope==='host')?.data?.cpu_percent,memory=Number(metrics.memory_percent)||0,disk=Number(metrics.disk_percent)||0,worst=Math.max(memory,disk);
    checks.push({name:'Resources',group:'runtime',state:worst>=95?'fail':worst>=85?'warn':'pass',detail:(Number.isFinite(hostCpu)?'Host CPU '+percentText(hostCpu)+' · ':'')+'RAM '+sizeText(metrics.memory_used_bytes)+' / '+sizeText(metrics.memory_limit_bytes)+' ('+percentText(memory)+') · Disk '+sizeText(metrics.disk_used_bytes)+(worst>=85?'. Running low on headroom.':'')});
  }
  return checks;
}

// Join the live report and the readiness report into the cards the board draws.
function buildServerStatus(report,live,node,server){
  const reportNode=report?.nodes?.[0],reportServer=reportNode?.servers?.find(item=>item.instance_id===server.instance_id);
  const containers=live?.metrics?.containers||[],serviceOf={'Container':'fs25','SFTP container':'sftp'};
  const readiness=[...(reportServer?.checks||[]),...(reportNode?.checks||[])].map(check=>{
    const container=containers.find(item=>item.service===serviceOf[check.name]);
    return container?{...check,detail:check.detail+' ('+liveContainerText(container)+')'}:check;
  });
  // A node that cannot inspect its containers and ports says so on every server it hosts. That is a limit of the check, not a
  // problem with this server, so it is shown as a note and never counted as a finding.
  const notes=readiness.filter(check=>check.name==='Server inspection').map(check=>check.detail);
  let checks=[...liveChecks(live,node,server),...readiness.filter(check=>check.name!=='Server inspection')];
  // A node that cannot inspect its containers still reports them in the live status.
  if(report&&!checks.some(check=>check.group==='containers'))for(const container of containers)checks.push({name:container.service==='sftp'?'SFTP container':container.service==='fs25'?'Container':container.service||'Container',group:'containers',state:container.restarting?'fail':container.running?'pass':'warn',detail:liveContainerText(container)});
  checks.push(node.online?{name:'Node heartbeat',group:'node',state:'pass',detail:'Last heartbeat '+stamp(node.last_seen)+'.'}:{name:'Node heartbeat',group:'node',state:'fail',detail:'The node is not reporting. Last heartbeat '+stamp(node.last_seen)+'.',repair:{label:'Open node',href:nodeUrl(node)}});
  // While a server is being set up for the first time, missing hostnames and stopped containers are part of the process, so the
  // board only reports status; repairs appear once the server has started successfully and something then goes wrong.
  // The log keeps only recent lines, but its "Server created" line is still there for a young server and long gone for an old
  // one, so a server whose log has rotated is never mistaken for one still being set up.
  const setup=!!live&&typeof parseStartup==='function'&&/Server created/.test(String(live.log_output||''))&&!parseStartup(live.log_output,{state:live.metrics?.runtime_state?.state,containers}).everRan;
  if(setup)checks=checks.map(({repair,...check})=>check);
  const groups=statusGroups.map(([id,title,blurb])=>{
    const items=checks.filter(check=>(check.group||'node')===id).sort((a,b)=>statusRank[b.state]-statusRank[a.state]);
    return {id,title,blurb,checks:items,state:worstState(items)};
  }).filter(group=>group.checks.length);
  const counts={pass:0,warn:0,fail:0,total:checks.length};
  for(const check of checks)counts[check.state]++;
  const state=setup?'setup':counts.fail?'problem':counts.warn?'attention':'ok';
  const title=setup?'Setting up this server':state==='ok'?'All systems operational':counts.fail+counts.warn===1?'1 thing needs '+(counts.fail?'fixing':'attention'):counts.fail+counts.warn+' things need '+(counts.fail?'fixing':'attention');
  // The same repair often fixes several findings (recreating a container), so each distinct action runs once.
  const seen=new Set(),fixes=[];
  for(const check of checks)if(check.state!=='pass'&&check.repair?.api){const key=check.repair.api+JSON.stringify(check.repair.body||{});if(!seen.has(key)){seen.add(key);fixes.push(check.repair);}}
  return {groups,counts,state,title,setup,notes,percent:counts.total?Math.round(counts.pass/counts.total*100):0,fixes,checked:!!report};
}

const statusIcons={
  runtime:'M5 3l14 9-14 9z',
  containers:'M3 7l9-4 9 4v10l-9 4-9-4z M3 7l9 4 9-4 M12 11v10',
  domains:'M12 21a9 9 0 100-18 9 9 0 000 18z M3 12h18 M12 3c2.5 2.6 3.8 5.6 3.8 9S14.5 18.4 12 21c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z',
  ports:'M12 3l8 3v6c0 4.5-3.2 8-8 9-4.8-1-8-4.5-8-9V6z M9 12l2 2 4-4',
  node:'M3 4h18v7H3z M3 13h18v7H3z M7 7.5h.01 M7 16.5h.01 M11 7.5h6 M11 16.5h6'
};
function statusIcon(path){
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg'),shape=document.createElementNS('http://www.w3.org/2000/svg','path');
  svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('fill','none');svg.setAttribute('stroke','currentColor');svg.setAttribute('stroke-width','1.6');svg.setAttribute('stroke-linecap','round');svg.setAttribute('stroke-linejoin','round');svg.setAttribute('aria-hidden','true');
  shape.setAttribute('d',path);svg.append(shape);return svg;
}

let serverStatusKick;
// Mount the board on a game server's page. Only administrators can run the node checks.
function serverStatusBoard(node,server){
  if(me.role!=='admin')return;
  const panel=section('Server status'),hero=element('div',undefined,'ss-hero'),ring=element('div',undefined,'ss-ring'),ringText=element('strong'),headline=element('div',undefined,'ss-headline'),title=element('h3'),sub=element('p',undefined,'muted'),tools=element('div',undefined,'ss-tools'),grid=element('div',undefined,'ss-grid'),note=element('p');
  const recheck=button('Re-check',()=>void runCheck()),fixAll=button('Fix all',()=>void repairAll());
  ring.append(ringText);headline.append(title,sub);tools.append(fixAll,recheck);hero.append(ring,headline,tools);
  note.setAttribute('role','status');note.setAttribute('aria-live','polite');note.className='ss-note muted';
  const limits=element('p',undefined,'ss-note muted');
  panel.classList.add('ss-board');panel.append(hero,limits,note,grid);
  let report=null,live=null,checkedAt=0,liveAt=0,busy=false,drawn='',model=null;

  const say=text=>{note.textContent=text;};
  const draw=()=>{
    model=buildServerStatus(report,live,node,server);
    const view=JSON.stringify(model);
    updateHeader();
    if(view===drawn)return;drawn=view;
    grid.replaceChildren(...model.groups.map(group=>{
      const card=element('article',undefined,'ss-card'),head=element('header',undefined,'ss-card-head'),icon=element('span',undefined,'ss-card-icon'),text=element('div'),list=element('ul',undefined,'ss-rows');
      list.tabIndex=0;list.setAttribute('aria-label',group.title+' checks');
      card.dataset.state=group.state;icon.append(statusIcon(statusIcons[group.id]));
      text.append(element('h3',group.title),element('p',group.blurb,'muted'));
      head.append(icon,text,element('span',group.state==='pass'?'Healthy':group.state==='warn'?'Attention':'Problem','ss-pill'));
      for(const check of group.checks){
        const row=element('li',undefined,'ss-row'),main=element('div',undefined,'ss-main'),name=element('strong',check.name),fix=statusRepairControl(check,say,runCheck);
        row.dataset.state=check.state;
        main.append(name,element('span',check.state==='pass'?'OK':check.state==='warn'?'Attention':'Problem','ss-sr'),element('p',check.detail,'ss-detail'));
        if(check.host){const host=element('button',check.host,'ss-host');host.type='button';host.title='Copy this address';host.onclick=async()=>{try{await navigator.clipboard.writeText(check.host);say('Copied '+check.host);}catch{say('Select the address to copy it: '+check.host);}};main.append(host);}
        row.append(element('span',undefined,'ss-dot'),main);if(fix)row.append(fix);list.append(row);
      }
      card.append(head,list);return card;
    }));
  };
  const updateHeader=()=>{
    hero.dataset.state=model.checked?model.state:'checking';
    ring.style.setProperty('--pct',String(model.checked?model.percent:0));
    ringText.textContent=model.checked?model.counts.pass+'/'+model.counts.total:'…';
    title.textContent=model.checked?model.title:'Checking this server…';
    sub.textContent=model.checked?'Checked '+timeAgo(Date.now()-checkedAt)+' · '+model.counts.pass+' of '+model.counts.total+(model.setup?' checks ready. Repairs appear after the first successful start.':' checks passing'):'Looking at containers, domains, ports and the node connection. This can take up to half a minute.';
    limits.textContent=model.notes.length?'Not checked on this node: '+model.notes.join(' '):'';
    fixAll.hidden=!model.fixes.length;fixAll.textContent=model.fixes.length>1?'Fix all ('+model.fixes.length+')':'Fix issue';
    recheck.disabled=busy;fixAll.disabled=busy;
  };

  async function refreshLive(){
    if(!panel.isConnected)return;
    try{live=await manageApi(node,'live',server);liveAt=Date.now();}catch{ /* Keep the last live reading; the check below reports an unreachable node. */ }
    draw();
  }
  async function runCheck(){
    if(busy||!panel.isConnected)return;busy=true;draw();
    try{
      const [result]=await Promise.all([api('readiness',{node:node.id,instance:server.instance_id}),refreshLive()]);
      report=result;checkedAt=Date.now();say('');
    }catch(e){say('The check could not finish: '+e.message);}
    finally{busy=false;drawn='';draw();}
  }
  async function repairAll(){
    if(busy||!model.fixes.length)return;
    if(!confirm('Run these repairs, one after another?\n\n'+model.fixes.map(fix=>'• '+fix.label).join('\n')+'\n\nA recreate or restart disconnects connected players.'))return;
    busy=true;draw();
    try{
      for(const fix of model.fixes){say(fix.label+'…');const result=await api(fix.api,fix.body);if(result.ok===false)throw new Error(result.error||fix.label+' failed.');}
      say('Repairs finished. Re-checking…');
    }catch(e){say(e.message);}
    finally{busy=false;}
    await runCheck();
  }

  serverStatusKick=()=>void runCheck();
  draw();void runCheck();
  // Every read is a request through the node's tunnel (the start-up panel already polls the same live status), so the board reads it
  // every 30 seconds and runs the full check every 5 minutes while the page is open.
  const timer=setInterval(()=>{
    if(!panel.isConnected){clearInterval(timer);return;}
    if(document.hidden||busy)return;
    if(Date.now()-checkedAt>300000)void runCheck();else if(Date.now()-liveAt>=30000)void refreshLive();
  },10000);
}
if(typeof module!=='undefined')module.exports={buildServerStatus,statusGroups};
