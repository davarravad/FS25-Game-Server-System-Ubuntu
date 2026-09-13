// System Status: one page answering "is every node and every game server set up the way it
// should be right now, and if not, what needs doing?" Runs the same read-only fleet check the
// Node updates page used to embed (Cloudflare connection, gateway, console bypass, installed
// release, container wiring, DNS) plus a check that each server's public ports — game, web
// admin, TLS and SFTP — are actually published and firewalled as configured, not just what
// settings say they should be. Every finding that is not a pass carries its own repair.
let lastStatusReport=null,lastStatusMessage='';

function statusMark(state){
  return element('span',state==='pass'?'OK':state==='warn'?'Attention':'Problem','badge '+(state==='pass'?'good':state==='warn'?'warning':'bad'));
}

function statusEmptyRow(columns,text){
  const row=element('tr'),cell=element('td',text,'empty-state');cell.colSpan=columns;row.append(cell);return row;
}

function statusRepairControl(check,say,rerun){
  const repair=check.repair;if(!repair)return null;
  if(repair.href)return link(repair.label,repair.href,'text-link readiness-repair');
  const control=button(repair.label,async()=>{
    if(repair.confirm&&!confirm(repair.confirm))return;
    control.disabled=true;say(repair.label+'…');
    try{const result=await api(repair.api,repair.body);say(result.message||(result.ok===false?(result.error||repair.label+' failed.'):repair.label+' done. Re-checking…'));await rerun();}
    catch(e){say(e.message);control.disabled=false;}
  });control.className='readiness-repair';return control;
}

async function statusPage(){
  title('System Status','Checks every enabled node and each of its game servers for what they need to be reachable: the Cloudflare connection, gateway, console bypass, installed release, container wiring, DNS for each panel hostname, and each server\'s public ports (game, web admin, TLS, SFTP) actually published and firewalled as configured. The check changes nothing; every finding that needs attention has a repair action next to it.','status');
  if(me.role!=='admin'){$('page').append(element('p','Administrator access required.','muted'));return;}

  const overview=section('Nodes'),overviewWrap=element('div',undefined,'update-table-wrap'),overviewTable=element('table',undefined,'update-table'),overviewHead=element('thead'),overviewHeadRow=element('tr');
  for(const label of ['Node','Online','Servers','Findings'])overviewHeadRow.append(element('th',label));
  overviewHead.append(overviewHeadRow);const overviewRows=element('tbody');overviewTable.append(overviewHead,overviewRows);overviewWrap.append(overviewTable);overview.append(overviewWrap);

  const panel=section('Findings');
  const toolbar=element('div',undefined,'toolbar');
  const run=button('Check all nodes',()=>{});
  const filterLabel=element('label');const filterBox=element('input');filterBox.type='checkbox';filterLabel.append(filterBox,document.createTextNode(' Show only issues'));
  toolbar.append(run,filterLabel);
  const status=element('p');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  const wrap=element('div',undefined,'update-table-wrap'),table=element('table',undefined,'update-table'),head=element('thead'),headRow=element('tr');
  for(const label of ['Node','Server','Check','Status','Detail','Fix'])headRow.append(element('th',label));
  head.append(headRow);const rows=element('tbody');table.append(element('caption','Every check across your fleet.'),head,rows);wrap.append(table);
  panel.append(toolbar,status,wrap);

  const say=text=>{lastStatusMessage=text;status.textContent=text;};

  const buildRow=(nodeCell,serverCell,check)=>{
    const row=element('tr'),nodeTd=element('td'),serverTd=element('td');
    nodeTd.append(nodeCell);serverTd.append(serverCell);
    row.append(nodeTd,serverTd,element('td',check.name));
    const statusCell=element('td');statusCell.append(statusMark(check.state));row.append(statusCell);
    row.append(element('td',check.detail));
    const fixCell=element('td');const control=statusRepairControl(check,say,runCheck);if(control)fixCell.append(control);row.append(fixCell);
    return row;
  };

  const render=()=>{
    rows.replaceChildren();overviewRows.replaceChildren();
    if(!lastStatusReport){rows.append(statusEmptyRow(6,'No check has run yet.'));return;}
    if(!lastStatusReport.nodes.length){rows.append(statusEmptyRow(6,'No enabled nodes to check.'));return;}
    const onlyIssues=filterBox.checked;
    for(const node of lastStatusReport.nodes){
      const allChecks=[...node.checks,...node.servers.flatMap(s=>s.checks)];
      const findings=allChecks.filter(c=>c.state!=='pass').length;
      const overviewRow=element('tr'),nodeCell=element('td');nodeCell.append(link(node.name,'/nodes/'+encodeURIComponent(node.id),'text-link'));
      overviewRow.append(nodeCell);
      const onlineCell=element('td');onlineCell.append(badge(node.online?'Online':'Offline'));overviewRow.append(onlineCell);
      overviewRow.append(element('td',String(node.servers.length)));
      const findingsCell=element('td');findingsCell.append(findings?statusMark('fail'):statusMark('pass'),document.createTextNode(' '+findings));overviewRow.append(findingsCell);
      overviewRows.append(overviewRow);

      for(const check of node.checks){
        if(onlyIssues&&check.state==='pass')continue;
        rows.append(buildRow(link(node.name,'/nodes/'+encodeURIComponent(node.id),'text-link'),'—',check));
      }
      for(const server of node.servers){
        for(const check of server.checks){
          if(onlyIssues&&check.state==='pass')continue;
          rows.append(buildRow(node.name,link(server.server_name+' ('+server.instance_id+')','/servers/'+encodeURIComponent(node.id)+'/'+encodeURIComponent(server.instance_id),'text-link'),check));
        }
      }
    }
    if(!rows.children.length)rows.append(statusEmptyRow(6,onlyIssues?'No open issues — everything checked is passing.':'Nothing to show.'));
  };

  async function runCheck(){
    run.disabled=true;say('Checking every node… this can take up to a minute per node.');
    try{
      const report=await api('readiness',{});
      lastStatusReport=report;render();
      const findings=report.nodes.flatMap(n=>[...n.checks,...n.servers.flatMap(s=>s.checks)]).filter(c=>c.state!=='pass').length;
      say('Checked '+report.nodes.length+' node(s) at '+stamp(report.generated)+(findings?' · '+findings+' finding(s) need attention.':' · everything is ready.'));
    }catch(e){say(e.message);}
    finally{run.disabled=false;}
  }

  run.onclick=runCheck;
  filterBox.onchange=render;
  if(lastStatusReport){render();status.textContent=lastStatusMessage;}
  else say('Click "Check all nodes" to run a check.');
}
