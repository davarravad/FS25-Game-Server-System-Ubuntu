'use strict';
// Start-up progress for a game server. The first start does a lot behind the scenes (builds the game runtime,
// creates the containers, boots the game, waits for its web panel), so the page turns the node's own runtime log into
// a step list and keeps it current in place. The parser is a pure function so it can be tested without a browser.
const startupSteps=[
  ['request','Start requested'],
  ['image','Preparing the game software'],
  ['containers','Starting containers'],
  ['files','Preparing server files'],
  ['game','Starting the game server'],
  ['panel','Waiting for the game panel'],
  ['online','Online']
];
const containersRunning=runtime=>(runtime?.containers||[]).some(container=>container.running);
// everRan: the server has come online at least once, which is when first-time setup is over.
function parseStartup(logText,runtime){
  const result=parseStartupLog(logText,runtime);
  return {...result,everRan:result.state==='online'||/Server marked as running|\[Webserver\]: Now accessible/.test(String(logText||''))};
}
function parseStartupLog(logText,runtime){
  const lines=String(logText||'').split('\n').map(line=>line.trim()).filter(Boolean);
  const text=line=>line.replace(/^\[[^\]]*\]\s*/,'');
  const stamp=line=>((/^\[([^\]]*)\]/.exec(line)||[])[1])||'';
  const everRan=lines.some(line=>/Server marked as running|\[Webserver\]: Now accessible/.test(line));
  let start=-1;
  for(let i=lines.length-1;i>=0;i--)if(/Console: Server marked as starting/.test(lines[i])){start=i;break;}
  const pending=startupSteps.map(([id,label])=>({id,label,state:'pending',detail:''}));
  if(start<0){
    // The log keeps only its recent lines, so a server that has been up for a long time can have no start marker left.
    if(runtime?.state==='online'||containersRunning(runtime))return {state:'online',steps:pending.map(step=>({...step,state:'done'})),percent:100,firstTime:false,current:6,since:'',detail:''};
    return {state:'idle',steps:pending,percent:0,firstTime:!everRan,current:-1,since:'',detail:''};
  }
  const after=lines.slice(start);
  const last=pattern=>{for(let i=after.length-1;i>=0;i--)if(pattern.test(after[i]))return i;return -1;};
  const idx={
    stopped:last(/Server marked as (offline|stopping)/),
    imageBuild:last(/Building the game runtime image/),imageReady:last(/Game runtime image ready/),
    containersStart:last(/Starting containers/),containersDone:last(/Containers started/),
    filesPrep:last(/Preparing server files|Verifying files/),
    gameStart:last(/Starting server with version|Server starting\.\.\./),
    panelWait:last(/Waiting for webserver|control panel is online - Attempt/),
    panelUp:last(/\[Webserver\]: Now accessible|Server marked as running/),
    fail:last(/Runtime image build failed|Containers failed to start|Missing dedicatedServer\.exe|Timed out waiting for the control panel|Server process exited/)
  };
  const since=stamp(after[0]);
  if(idx.stopped>=0&&idx.panelUp<0&&idx.fail<0)return {state:'stopped',steps:pending,percent:0,firstTime:false,current:-1,since,detail:''};
  const containers=runtime?.containers||[];
  let reached=0;
  if(idx.imageBuild>=0||idx.imageReady>=0)reached=1;
  if(idx.imageReady>=0)reached=2;
  if(idx.containersStart>=0||containers.some(c=>c.running))reached=Math.max(reached,2);
  if(idx.containersDone>=0)reached=Math.max(reached,3);
  if(idx.filesPrep>=0)reached=Math.max(reached,3);
  if(idx.gameStart>=0)reached=Math.max(reached,4);
  if(idx.panelWait>=0)reached=Math.max(reached,5);
  const online=idx.panelUp>=0&&(!runtime?.state||runtime.state!=='offline');
  if(online)reached=6;
  const attempt=(after[idx.panelWait]||'').match(/Attempt (\d+)/)?.[1];
  const details=[
    '',
    idx.imageBuild>=0&&idx.imageReady<0?'First start only: the game runtime is being built. This can take several minutes and shows no output while it works.':'The game runtime is ready.',
    'Creating the game server and SFTP containers.',
    'The game software is booting and preparing this server’s files. The first boot sets up the Windows compatibility layer, so it takes longer.',
    'The dedicated server process is starting.',
    attempt?'Checking whether the game’s web panel answers (attempt '+attempt+').':'Waiting for the game’s web panel to answer.',
    ''
  ];
  const failure=idx.fail>=0&&!online?text(after[idx.fail]):'';
  // The error belongs on the step that failed, whatever else the node reports at the same time.
  if(failure){const failedAt=[[/Runtime image build failed/,1],[/Containers failed to start/,2],[/Missing dedicatedServer|Server process exited/,4],[/Timed out waiting for the control panel/,5]].find(([pattern])=>pattern.test(failure));if(failedAt)reached=failedAt[1];}
  const steps=pending.map((step,i)=>({...step,state:i<reached||online&&i===6?'done':i===reached?(failure?'error':'active'):'pending',detail:i===reached&&!online?(failure||details[i]):''}));
  const done=steps.filter(step=>step.state==='done').length,percent=online?100:Math.round((done+(failure?0:.5))/steps.length*100);
  return {state:online?'online':failure?'failed':'running',steps,percent,firstTime:!everRan||idx.imageBuild>=0,current:online?6:reached,since,detail:failure};
}
let startupKick;
// Mount the live panel on a game server's page. Administrators read the runtime log through the node's management API.
function startupProgressPanel(node,server){
  if(me.role!=='admin')return;
  const panel=section('Startup progress'),head=element('div',undefined,'conn-head'),spin=element('span',undefined,'spinner'),label=element('strong',undefined,'conn-label'),count=element('span',undefined,'muted conn-count');
  const bar=element('div',undefined,'progress-bar'),fill=element('div',undefined,'progress-fill'),list=element('ol',undefined,'startup-steps'),note=element('p',undefined,'muted'),box=element('div',undefined,'conn-progress');
  spin.setAttribute('aria-hidden','true');head.setAttribute('role','status');bar.setAttribute('role','progressbar');bar.setAttribute('aria-valuemin','0');bar.setAttribute('aria-valuemax','100');
  bar.append(fill);head.append(spin,label,count);box.append(head,bar);
  const items=startupSteps.map(([id,text])=>{const li=element('li',undefined,'startup-step'),name=element('span',text,'startup-step-name'),detail=element('span',undefined,'startup-step-detail muted');li.append(name,detail);list.append(li);return {li,detail};});
  panel.append(box,list,note);panel.hidden=true;
  let busy=false,timer;
  const draw=result=>{
    const state=result.state==='failed'?'error':result.state==='running'?'active':result.state==='idle'?'idle':'done';
    box.dataset.state=state;panel.hidden=['online','stopped'].includes(result.state)||result.state==='idle'&&!result.firstTime;
    if(panel.hidden)return;
    const current=result.steps[result.current];
    label.textContent=result.state==='idle'?'Not started yet':result.state==='failed'?'Setup needs attention':(result.firstTime?'First-time setup: ':'')+(current?current.label:'Starting');
    count.textContent=result.state==='idle'?'':result.state==='failed'?'Stopped at: '+(current?.label||'start'):'Step '+(result.current+1)+' of '+result.steps.length;
    fill.style.width=result.percent+'%';bar.setAttribute('aria-valuenow',String(result.percent));bar.setAttribute('aria-valuetext',label.textContent);
    result.steps.forEach((step,i)=>{items[i].li.dataset.state=step.state;items[i].detail.textContent=step.detail;});
    note.textContent=result.state==='idle'?'Choose Start to begin. The first start builds the game runtime and boots the game for the first time, which takes several minutes. Progress appears here as it happens.':result.state==='failed'?'Open Logs & containers for the full output, fix the problem, then start the server again.':'Updates live. You can leave this page; the server keeps starting.'+(result.since?' Started '+result.since+' (node time).':'');
  };
  const refresh=async()=>{
    if(busy||!panel.isConnected)return;busy=true;
    try{const data=await manageApi(node,'live',server);draw(parseStartup(data.log_output,{state:data.metrics?.runtime_state?.state,containers:data.metrics?.containers||[]}));}
    catch{ /* The node may be busy building; the next poll tries again. */ }
    finally{busy=false;}
  };
  const schedule=()=>{clearTimeout(timer);if(!panel.isConnected)return;timer=setTimeout(async()=>{if(!document.hidden)await refresh();schedule();},panel.hidden?15000:4000);};
  startupKick=()=>{void refresh().then(schedule);};
  void refresh().then(schedule);
}
if(typeof module!=='undefined')module.exports={parseStartup,startupSteps};
