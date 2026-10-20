'use strict';
// Server table: every game server as a sortable, filterable table with choosable columns and copy buttons.
// It extends the Game Servers page. Public details come from the node inventory; hostnames come from one read-only
// request; logins and SFTP details are loaded per server, only for rows on screen and only while a column that needs
// them is shown. Passwords stay masked, and the copy button still copies the real value.

const serverTablePrefsKey='farmservers.serverTable.v1';
const serverTableCredentialLifetime=5*60*1000;
const serverTableGroups=['Server','Access','SFTP'];
const clipboardIcon='<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/></svg>';
const checkIcon='<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

const serverTablePlayers=row=>{
  const server=row.server,fresh=row.node.online&&row.node.enabled&&Number.isFinite(server.game_sampled_at)&&Date.now()/1000-server.game_sampled_at<120;
  return {count:fresh&&Number.isInteger(server.player_count)?server.player_count:null,capacity:Number.isInteger(server.player_capacity)?server.player_capacity:null};
};
// Each column: value() is the text shown and copied; needs says which extra data it waits for; secret columns are masked.
const serverTableColumns=[
  {id:'name',label:'Server name',group:'Server',always:true,value:row=>row.server.server_name||row.server.instance_id,href:row=>serverUrl(row.node,row.server)},
  {id:'node',label:'Node',group:'Server',value:row=>row.node.name},
  {id:'instance',label:'Instance ID',group:'Server',value:row=>row.server.instance_id},
  {id:'status',label:'Status',group:'Server',badge:true,copy:false,value:row=>serverStatus(row.node,row.server)},
  {id:'players',label:'Players',group:'Server',copy:false,value:row=>{const p=serverTablePlayers(row);return p.count===null&&p.capacity===null?'':(p.count===null?'—':p.count)+(p.capacity===null?'':' / '+p.capacity);},sort:row=>serverTablePlayers(row).count??-1},
  {id:'map',label:'Map',group:'Server',value:row=>row.server.game_map||row.server.server_map||''},
  {id:'version',label:'Game version',group:'Server',value:row=>row.server.game_version||''},
  {id:'panel_url',label:'Game panel URL',group:'Access',needs:'endpoints',open:true,value:row=>row.endpoints?.web?'https://'+row.endpoints.web+'/':''},
  {id:'web_username',label:'Game admin user',group:'Access',needs:'details',value:row=>row.details?.web_username},
  {id:'web_password',label:'Game admin password',group:'Access',needs:'details',secret:true,value:row=>row.details?.web_password},
  {id:'vnc_password',label:'VNC password',group:'Access',needs:'details',secret:true,value:row=>row.details?.vnc_password},
  {id:'game_port',label:'Game port',group:'Access',needs:'details',value:row=>row.details?.server_port},
  {id:'sftp_url',label:'SFTP address',group:'SFTP',needs:'details',value:row=>row.details?.sftp_url},
  {id:'sftp_host',label:'SFTP host',group:'SFTP',needs:'details',value:row=>row.details?.sftp_host},
  {id:'sftp_port',label:'SFTP port',group:'SFTP',needs:'details',value:row=>row.details?.sftp_port},
  {id:'sftp_username',label:'SFTP user',group:'SFTP',needs:'details',value:row=>row.details?.sftp_username},
  {id:'sftp_password',label:'SFTP password',group:'SFTP',needs:'details',secret:true,value:row=>row.details?.sftp_password}
];
const serverTableDefaults=['name','node','status','players','panel_url'];
const serverTableColumn=id=>serverTableColumns.find(column=>column.id===id);

function serverTableLoadPrefs(){
  const prefs={columns:[...serverTableDefaults],sort:{id:'name',dir:'asc'}};
  try{
    const saved=JSON.parse(localStorage.getItem(serverTablePrefsKey)||'null');
    if(Array.isArray(saved?.columns)){const ids=saved.columns.filter(id=>serverTableColumn(id));if(ids.length)prefs.columns=ids;}
    if(serverTableColumn(saved?.sort?.id)&&['asc','desc'].includes(saved.sort.dir))prefs.sort={id:saved.sort.id,dir:saved.sort.dir==='desc'?'desc':'asc'};
  }catch{ /* Preferences are a convenience; fall back to the defaults. */ }
  if(!prefs.columns.includes('name'))prefs.columns.unshift('name');
  return prefs;
}
function serverTableSavePrefs(prefs){try{localStorage.setItem(serverTablePrefsKey,JSON.stringify(prefs));}catch{ /* Storage can be unavailable. */ }}

// Loaded logins are kept in memory only (never stored in the browser) and are dropped after a few minutes.
let serverTableCache={at:0,details:new Map(),endpoints:null,endpointsError:''};

async function serverTableFetchDetails(row){
  if(!row.node.online)throw new Error('Node offline');
  const data=await manageApi(row.node,'server',row.server),server=data.server||{};
  const host=String(data.access?.host||''),port=server.sftp_port;
  return {...server,vnc_password:data.secrets?.secrets?.vnc_password,sftp_host:host,sftp_url:data.access?.sftp_url||(host&&port?'sftp://'+host+':'+port:'')};
}

function serverTableCopyButton(text,label){
  const copy=element('button',undefined,'st-copy');copy.type='button';copy.innerHTML=clipboardIcon;copy.title='Copy '+label;copy.setAttribute('aria-label','Copy '+label);
  copy.onclick=async()=>{try{await navigator.clipboard.writeText(text);copy.innerHTML=checkIcon;copy.title='Copied';}catch{copy.title='Copy failed';}finally{setTimeout(()=>{copy.innerHTML=clipboardIcon;copy.title='Copy '+label;},1500);}};
  return copy;
}

function serverTablePage(){
  title('Server table','Sort, filter and copy the details of every game server. Choose which columns to show.','servers');
  $('breadcrumbs').append(link('Game Servers','/servers','text-link'));
  if(me.role!=='admin'){$('page').append(element('p','Administrator access is required for the server table.'));return;}
  if(Date.now()-serverTableCache.at>serverTableCredentialLifetime)serverTableCache={at:Date.now(),details:new Map(),endpoints:null,endpointsError:''};
  // A page rebuilt while requests were in flight would wait forever on their "loading" markers.
  for(const [key,entry] of serverTableCache.details)if(entry.state==='loading')serverTableCache.details.delete(key);
  if(serverTableCache.endpointsError==='loading')serverTableCache.endpointsError='';
  const prefs=serverTableLoadPrefs(),state={search:'',node:'',status:'',reveal:false};
  const section_=section('Game servers'),toolbar=element('div',undefined,'toolbar st-toolbar');
  const search=element('input'),nodeFilter=element('select'),statusFilter=element('select'),reveal=element('label',undefined,'st-reveal'),revealBox=element('input'),count=element('p',undefined,'muted st-count');
  search.type='search';search.placeholder='Search servers…';search.setAttribute('aria-label','Search servers');
  nodeFilter.setAttribute('aria-label','Filter by node');statusFilter.setAttribute('aria-label','Filter by status');
  revealBox.type='checkbox';reveal.append(revealBox,element('span','Show passwords'));
  const picker=element('details',undefined,'st-columns'),refreshDetails=button('Reload details',()=>{serverTableCache.details.clear();serverTableCache.at=Date.now();draw();});
  refreshDetails.title='Load logins and SFTP details again';
  toolbar.append(search,nodeFilter,statusFilter,reveal,picker,refreshDetails);
  const wrap=element('div',undefined,'server-table-wrap'),table=element('table',undefined,'server-table'),head=element('thead'),body=element('tbody');
  table.append(head,body);wrap.append(table);section_.append(toolbar,count,wrap);

  const allRows=()=>nodes.flatMap(node=>sortedServers(node).map(server=>({key:node.id+'/'+server.instance_id,node,server,endpoints:serverTableCache.endpoints?.[node.id+'/'+server.instance_id],details:serverTableCache.details.get(node.id+'/'+server.instance_id)?.data})));
  const visibleColumns=()=>prefs.columns.map(serverTableColumn).filter(Boolean);
  const textOf=(row,column)=>{const value=column.value(row);return value===undefined||value===null?'':String(value);};

  const fillFilters=()=>{
    const nodeValue=nodeFilter.value,statusValue=statusFilter.value;
    nodeFilter.replaceChildren(new Option('All nodes',''));for(const node of nodes)if(node.snapshot?.servers?.length)nodeFilter.append(new Option(node.name,node.id));
    const statuses=[...new Set(allRows().map(row=>serverStatus(row.node,row.server)))].sort();
    statusFilter.replaceChildren(new Option('All statuses',''));for(const status of statuses)statusFilter.append(new Option(status,status));
    nodeFilter.value=[...nodeFilter.options].some(o=>o.value===nodeValue)?nodeValue:'';statusFilter.value=[...statusFilter.options].some(o=>o.value===statusValue)?statusValue:'';
    state.node=nodeFilter.value;state.status=statusFilter.value;
  };

  const drawPicker=()=>{
    const open=picker.open;picker.replaceChildren(element('summary','Columns ('+prefs.columns.length+')'));
    const panel=element('div',undefined,'st-columns-panel');
    for(const group of serverTableGroups){
      const box=element('fieldset',undefined,'st-columns-group');box.append(element('legend',group));
      for(const column of serverTableColumns.filter(c=>c.group===group)){
        const label=element('label'),input=element('input');input.type='checkbox';input.checked=prefs.columns.includes(column.id);input.disabled=!!column.always;
        input.onchange=()=>{prefs.columns=serverTableColumns.filter(c=>c.always||(c.id===column.id?input.checked:prefs.columns.includes(c.id))).map(c=>c.id);serverTableSavePrefs(prefs);drawPicker();draw();};
        label.append(input,element('span',column.label));box.append(label);
      }
      panel.append(box);
    }
    const reset=button('Reset columns',()=>{prefs.columns=[...serverTableDefaults];serverTableSavePrefs(prefs);drawPicker();draw();});
    panel.append(reset);picker.append(panel);picker.open=open;
  };

  const compare=(a,b,column,dir)=>{
    const sortValue=column.sort?column.sort:row=>textOf(row,column);
    const left=sortValue(a),right=sortValue(b),emptyLeft=left===''||left===undefined,emptyRight=right===''||right===undefined;
    if(emptyLeft!==emptyRight)return emptyLeft?1:-1;
    const result=typeof left==='number'&&typeof right==='number'?left-right:String(left).localeCompare(String(right),undefined,{numeric:true,sensitivity:'base'});
    return (dir==='desc'?-result:result)||serverNameCompare(a.server,b.server);
  };
  const filtered=()=>{
    const query=state.search.trim().toLowerCase(),columns=visibleColumns().filter(c=>!c.secret);
    const rows=allRows().filter(row=>(!state.node||row.node.id===state.node)&&(!state.status||serverStatus(row.node,row.server)===state.status)&&(!query||[...new Set([serverTableColumn('name'),serverTableColumn('node'),serverTableColumn('instance'),...columns])].map(c=>textOf(row,c)).join('\n').toLowerCase().includes(query)));
    const column=serverTableColumn(prefs.sort.id)||serverTableColumn('name');
    return rows.sort((a,b)=>compare(a,b,column,prefs.sort.dir));
  };

  // Hostnames come in one read-only request; logins load a few at a time, only for the rows being shown.
  let queued=[],running=0,drawTimer;
  const scheduleDraw=()=>{clearTimeout(drawTimer);drawTimer=setTimeout(draw,120);};
  const loadEndpoints=()=>{
    if(serverTableCache.endpoints||serverTableCache.endpointsError==='loading')return;serverTableCache.endpointsError='loading';
    api('server-table/endpoints').then(data=>{serverTableCache.endpoints=data.endpoints||{};serverTableCache.endpointsError='';},e=>{serverTableCache.endpointsError=e.message;}).finally(scheduleDraw);
  };
  const pump=()=>{
    while(running<4&&queued.length){
      const row=queued.shift();running++;
      serverTableFetchDetails(row).then(data=>serverTableCache.details.set(row.key,{state:'ok',data}),e=>serverTableCache.details.set(row.key,{state:'error',error:e.message})).finally(()=>{running--;pump();scheduleDraw();});
    }
  };
  const loadDetails=row=>{if(serverTableCache.details.has(row.key))return;serverTableCache.details.set(row.key,{state:'loading'});queued.push(row);pump();};

  const cell=(row,column)=>{
    const td=element('td'),box=element('div',undefined,'st-cell');td.append(box);
    if(column.needs==='details'){
      const entry=serverTableCache.details.get(row.key);
      if(!entry||entry.state==='loading'){box.append(element('span','Loading…','muted'));return td;}
      if(entry.state==='error'){const message=element('span','Unavailable','muted');message.title=entry.error;box.append(message);return td;}
    }
    if(column.needs==='endpoints'){
      if(!serverTableCache.endpoints){const message=element('span',serverTableCache.endpointsError&&serverTableCache.endpointsError!=='loading'?'Unavailable':'Loading…','muted');if(message.textContent==='Unavailable')message.title=serverTableCache.endpointsError;box.append(message);return td;}
    }
    const text=textOf(row,column);
    if(!text){const none=element('span','—','muted');if(column.needs==='endpoints')none.title='No public address has been set up for this server yet.';box.append(none);return td;}
    let shown;
    if(column.badge)shown=badge(text);
    else if(column.href)shown=link(text,column.href(row),'st-link');
    else if(column.open){shown=link(text,text,'st-link');shown.target='_blank';shown.rel='noopener noreferrer';}
    else shown=element('span',column.secret&&!state.reveal?'••••••••':text,column.secret?'st-secret':'st-value');
    box.append(shown);
    if(column.copy!==false)box.append(serverTableCopyButton(text,column.label.toLowerCase()+' for '+row.server.server_name));
    return td;
  };

  let lastSignature='';
  const signature=()=>JSON.stringify([prefs,state,[...serverTableCache.details].map(([k,v])=>k+v.state),!!serverTableCache.endpoints,filtered().map(row=>visibleColumns().filter(c=>!c.needs).map(c=>textOf(row,c)))]);
  function draw(){
    const columns=visibleColumns(),rows=filtered();
    if(columns.some(c=>c.needs==='endpoints'))loadEndpoints();
    if(columns.some(c=>c.needs==='details'))for(const row of rows)loadDetails(row);
    head.replaceChildren();const tr=element('tr');
    for(const column of columns){
      const th=element('th'),sorted=prefs.sort.id===column.id,sortButton=element('button',column.label,'st-sort');sortButton.type='button';
      th.scope='col';th.setAttribute('aria-sort',sorted?(prefs.sort.dir==='desc'?'descending':'ascending'):'none');
      sortButton.append(element('span',sorted?(prefs.sort.dir==='desc'?'▼':'▲'):'↕','st-sort-mark'));
      sortButton.onclick=()=>{prefs.sort=sorted?{id:column.id,dir:prefs.sort.dir==='asc'?'desc':'asc'}:{id:column.id,dir:'asc'};serverTableSavePrefs(prefs);draw();};
      th.append(sortButton);tr.append(th);
    }
    head.append(tr);
    body.replaceChildren(...rows.map(row=>{const line=element('tr');for(const column of columns)line.append(cell(row,column));return line;}));
    const total=allRows().length;
    count.textContent=total?'Showing '+rows.length+' of '+total+' game server'+(total===1?'':'s')+'.':'';
    if(!rows.length){const none=element('tr'),td=element('td','No matching game servers.','empty-state');td.colSpan=columns.length;none.append(td);body.append(none);}
    lastSignature=signature();
  }

  let searchTimer;
  search.oninput=()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>{state.search=search.value;draw();},180);};
  nodeFilter.onchange=()=>{state.node=nodeFilter.value;draw();};
  statusFilter.onchange=()=>{state.status=statusFilter.value;draw();};
  revealBox.onchange=()=>{state.reveal=revealBox.checked;draw();};
  fillFilters();drawPicker();draw();
  // The page refreshes every few seconds; redraw only when something shown has changed so copying is never interrupted.
  redrawFleet=()=>{fillFilters();if(signature()!==lastSignature)draw();};
}
