const connectionStages={tunnel:'Creating tunnel',credentials:'Creating Access credentials',access:'Protecting the hostname',route:'Configuring tunnel route',dns:'Publishing DNS',connector:'Preparing connector',installing:'Installing the node connector',verifying:'Checking the protected connection',ready:'Ready'};
function connectionStatus(row){return row.error?'Setup needs attention':!row.enabled?'Node disabled':connectionStages[row.stage]||'Waiting for compatible node updater';}
async function cloudflarePage(){
  title('Cloudflare','Set up automatic, protected connections for your server nodes.','cloudflare');
  if(me.role!=='admin'){empty($('page'),'Administrator access is required.');return;}
  const connection=await api('cloudflare');
  if(connection.settings?.hasToken&&!connection.settings.oauth){
    const active=section('Cloudflare connection');active.append(element('p','Using the saved API token. OAuth scope settings are not used by this connection.'));
    if(new URLSearchParams(location.search).has('oauth'))history.replaceState(null,'','/cloudflare');
  }else await cloudflareLoginPanel();
  const panel=section('Cloudflare account'),form=element('form',undefined,'edit-form cloudflare-form'),message=element('p');message.setAttribute('role','status');panel.append(message);
  let data;try{data=await api('cloudflare');}catch(e){message.textContent=e.message;return;}if(!panel.isConnected)return;
  const saved=data.settings||{};
  panel.append(element('p','Enable automation once. Each compatible node receives its own tunnel, DNS record, Access credentials and gateway token as it checks in. The API token stays on the central service.'));
  const account=field(form,'Cloudflare Account ID','account',saved.account||'',{required:true,pattern:'[a-f0-9]{32}'}),zone=field(form,'Zone ID','zone',saved.zone||'',{required:true,pattern:'[a-f0-9]{32}'});
  const domain=field(form,'Domain','domain',saved.domain||'sargentweb.com',{required:true,readOnly:true});
  const token=field(form,'Cloudflare API token (manual alternative)','token','',{type:'password',autoComplete:'new-password',required:!saved.hasToken&&!saved.oauth,placeholder:saved.oauth?'Connected with OAuth — leave blank':saved.hasToken?'Saved — leave blank to keep':'Paste your scoped API token'});
  const label=element('label','Automatic node connections'),enabled=element('select');enabled.setAttribute('aria-label','Automatic node connections');
  for(const [value,text] of [['false','Paused'],['true','Enabled']]){const o=element('option',text);o.value=value;enabled.append(o);}enabled.value=String(!!saved.enabled);label.append(enabled);form.append(label);
  const save=element('button','Save Cloudflare settings');form.append(save);panel.append(form,element('p','Token permissions: Account → Workers Scripts: Edit (required for game panel and VNC hostnames), Cloudflare Tunnel: Edit, Access: Apps and Policies: Edit, Access: Service Tokens: Edit. Zone → DNS: Edit and Zone: Read. Limit it to this account and zone.','muted'),element('p','Enabling starts setup for all enabled nodes with a compatible updater. Pausing stops setup and renewal; existing connections stay active. Existing conflicting DNS records are not overwritten.','muted'));
  form.onsubmit=async e=>{e.preventDefault();save.disabled=true;message.textContent='Checking Cloudflare settings…';try{await api('cloudflare',{account:account.value.trim(),zone:zone.value.trim(),domain:domain.value,token:token.value.trim(),enabled:enabled.value==='true'});const switchedToToken=!!token.value.trim();token.value='';token.required=false;token.placeholder='Saved — leave blank to keep';if(switchedToToken){history.replaceState(null,'','/cloudflare');await load();$('message').textContent='API token saved. OAuth is not used; retry Game admin or VNC from the server page.';return;}message.textContent=enabled.value==='true'?'Saved. Nodes will set themselves up as they check in.':'Saved. Automation is paused.';}catch(e){message.textContent=e.message;}finally{save.disabled=false;}};
  const fleet=section('Node connection progress'),list=element('div',undefined,'grid'),status=element('p');status.setAttribute('role','status');fleet.append(status,list);
  const draw=rows=>{list.replaceChildren();for(const row of rows){const card=element('article',undefined,'card');card.append(link(row.name,'/nodes/'+encodeURIComponent(row.id),'text-link'),element('p',connectionStatus(row)));if(row.error){card.append(element('p',row.error,'notice'));const retry=button('Retry setup',async()=>{retry.disabled=true;try{await api('cloudflare/retry',{id:row.id});status.textContent='Retry queued for '+row.name;await refresh();}catch(e){status.textContent=e.message;}finally{retry.disabled=false;}});card.append(retry);}if(row.updated)card.append(element('p','Last setup activity: '+stamp(row.updated),'muted'));list.append(card);}if(!rows.length)empty(list,'Create a node on the Server Nodes page to begin.');};
  const refresh=async()=>{if(!fleet.isConnected||document.hidden)return;try{const result=await api('cloudflare');if(fleet.isConnected)draw(result.nodes);}catch(e){status.textContent=e.message;}};
  draw(data.nodes);const timer=setInterval(()=>{if(!fleet.isConnected){clearInterval(timer);return;}void refresh();},5000);
  const setup=section('Existing Ubuntu nodes');setup.append(element('p','Existing nodes need a signed node software release containing connection automation. Install that release from the Node software section on the node’s Overview tab, or from Node updates. New installations using that release configure themselves after enrollment. Setup briefly restarts the web control panel; running game servers remain active.'));
}
async function nodeConnectionPanel(node){
  if(me.role!=='admin')return;
  const panel=section('Node connection progress'),card=element('article',undefined,'card'),status=element('p','Loading connection progress...'),error=element('p',undefined,'notice'),activity=element('p',undefined,'muted'),paused=element('p'),message=element('p');
  status.setAttribute('role','status');message.setAttribute('role','status');
  let busy=false,retrying=false;
  const retry=button('Retry setup',async()=>{if(retrying)return;retrying=true;retry.disabled=true;try{await api('cloudflare/retry',{id:node.id});message.textContent='Retry queued. Progress updates automatically.';}catch(e){message.textContent=e.message;}finally{retrying=false;retry.disabled=false;void refresh();}});
  retry.hidden=true;error.hidden=true;
  card.append(element('h3',node.name),status,error,activity,retry,paused);panel.append(card,message,element('p','Connection progress refreshes every 5 seconds.','muted'),link('Cloudflare settings','/cloudflare'));
  const refresh=async()=>{
    if(busy||retrying||document.hidden||!panel.isConnected)return;busy=true;
    try{const data=await api('cloudflare',undefined,{signal:AbortSignal.timeout(15000)});if(!panel.isConnected)return;
      const row=data.nodes.find(n=>n.id===node.id);status.textContent=row?connectionStatus(row):'Waiting for setup';
      error.textContent=row?.error||'';error.hidden=!row?.error;retry.hidden=!row?.error;retry.disabled=retrying||!row?.enabled;
      activity.textContent=row?.updated?'Last setup activity: '+stamp(row.updated):'No setup activity reported yet.';
      paused.textContent=data.settings?.enabled?'':'Automatic connections are paused. Enable them on the Cloudflare page to continue setup.';
    }catch(e){message.textContent='Unable to refresh connection progress: '+e.message+'. Retrying automatically.';}finally{busy=false;}
  };
  await refresh();const timer=setInterval(()=>{if(!panel.isConnected){clearInterval(timer);return;}void refresh();},5000);
}

async function gatewayCredentialsPanel(node){
  if(me.role!=='admin')return;
  const panel=section('Gateway credentials'),message=element('p');message.setAttribute('role','status');
  let status;try{status=await api('nodes/gateway?id='+encodeURIComponent(node.id));}catch(e){panel.append(element('p',e.message));return;}
  if(!panel.isConnected)return;
  panel.append(element('p','Authorizes central to reach this node’s protected tunnel. Automatic Cloudflare setup fills these in; rotate the token here if it is ever exposed (for example, pasted somewhere unsafe).','muted'));
  const form=element('form',undefined,'edit-form');
  const origin=field(form,'Tunnel origin','origin',status.origin,{required:true,placeholder:'https://your-node.sargentweb.com'});
  const clientId=field(form,'Access Client ID','accessClientId',status.accessClientId,{required:true});
  const token=field(form,'Gateway token','token','',{placeholder:status.hasToken?'Saved — leave blank to keep':'64-character lowercase hex token'});
  const secret=field(form,'Access Client Secret','accessClientSecret','',{type:'password',autoComplete:'new-password',placeholder:status.hasAccessSecret?'Saved — leave blank to keep':'Access service token secret'});
  const generate=button('Generate a new token',()=>{token.value=Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');});
  form.append(generate);
  const save=element('button','Save gateway credentials');form.append(save);
  panel.append(form,element('p','After saving, update CENTRAL_GATEWAY_TOKEN in the node’s .env to match (copy it from the field above before saving — it is not shown again), then recreate its panel services so the change takes effect.','muted'),message);
  form.onsubmit=async e=>{
    e.preventDefault();save.disabled=true;
    try{
      await api('nodes/gateway',{id:node.id,origin:origin.value.trim(),accessClientId:clientId.value.trim(),token:token.value.trim(),accessClientSecret:secret.value.trim()});
      token.value='';secret.value='';token.placeholder='Saved — leave blank to keep';secret.placeholder='Saved — leave blank to keep';
      message.textContent='Gateway credentials saved.';
    }catch(err){message.textContent=err.message;}
    finally{save.disabled=false;}
  };
}
async function cloudflareLoginPanel(){
  const panel=section('Connect with Cloudflare'),message=element('div');message.tabIndex=-1;message.hidden=true;message.setAttribute('aria-live','assertive');panel.append(message);
  const notify=(text,kind='error')=>{message.hidden=false;message.className='connection-feedback '+kind;message.setAttribute('role',kind==='error'?'alert':'status');message.replaceChildren(element('strong',kind==='error'?'Cloudflare connection failed':kind==='success'?'Cloudflare connected':'Connecting to Cloudflare'),element('p',text));message.focus({preventScroll:true});};
  const results={connected:'Cloudflare connected. Your account and zone were detected, and automatic node setup is enabled.',cancelled:'Cloudflare authorization was cancelled. Your existing settings were kept.',invalid:'This authorization link expired or was already used. Connect again.',failed:'Cloudflare authorization failed. Check the registered client settings and try again.','offline-required':'Cloudflare did not grant offline access. Add offline_access to the registered scopes and authorize again.','zone-unavailable':'The authorized account cannot access the active sargentweb.com zone.','account-mismatch':'This account differs from the one used by existing automated nodes. Your existing settings were kept.',permissions:'Authorization is missing access to tunnels, DNS or Access. Check the registered scopes.'};
  Object.assign(results,{
    'access-denied':'Cloudflare denied authorization. This can mean consent was declined or your Cloudflare account blocks this OAuth app. Check account membership and OAuth app access settings.',
    'invalid-scope':'Cloudflare rejected a requested scope. Match the scope IDs to the registered client and enable the Refresh Token grant so offline_access is allowed.',
    'invalid-client':'Cloudflare did not recognize this OAuth client. Check the saved Client ID against your Cloudflare app.',
    'unauthorized-client':'Cloudflare does not allow this client to use the requested flow. Enable Authorization Code and Refresh Token grants, and check private-client account membership.',
    'invalid-request':'Cloudflare rejected the authorization request. Check the exact callback URL, code response type and registered OAuth settings.',
    'invalid-response-type':'Cloudflare rejected the response type. Set the OAuth client response type to code and enable Authorization Code.',
    'provider-unavailable':'Cloudflare could not process authorization right now. Try connecting again shortly.',
    'login-required':'Cloudflare requires a fresh sign-in. Sign in to the correct Cloudflare account, then connect again.',
    'consent-required':'Cloudflare requires consent for this app. Connect again and approve the registered scopes.',
    'provider-error':'Cloudflare returned an authorization error. Check the client registration, account access and requested scopes. Your existing settings were kept.'
  });
  const result=new URLSearchParams(location.search).get('oauth');if(result)notify(results[result]||'Connect with Cloudflare to continue.',result==='connected'?'success':'error');
  let status;try{status=await api('cloudflare/oauth/status');}catch(e){notify(e.message);return;}if(!panel.isConnected)return;
  panel.append(element('p',status.connected?'Cloudflare OAuth is connected. Authorization renews automatically.':'Authorize this site in Cloudflare to detect your account and zone and enable automatic node connections.'));
  const connectLabel=status.connected?'Reconnect with Cloudflare':'Connect with Cloudflare';
  const connect=button(connectLabel,async()=>{
    connect.disabled=true;connect.textContent='Connecting…';notify('Preparing authorization. You will be redirected to Cloudflare to approve access.','pending');
    try{
      const data=await api('cloudflare/oauth/start',{}, {signal:AbortSignal.timeout(20000)});
      let target;try{if(typeof data.url!=='string')throw new Error();target=new URL(data.url);}catch{throw new Error('The service did not return a valid Cloudflare authorization link. Try again or check the service configuration.');}if(target.origin!=='https://dash.cloudflare.com'||target.pathname!=='/oauth2/auth')throw new Error('The service did not return a valid Cloudflare authorization link.');
      notify('Opening Cloudflare authorization…','pending');location.assign(target.href);
    }catch(e){notify(e.name==='TimeoutError'||e.name==='AbortError'?'The connection request timed out. Try again.':e.message);connect.disabled=false;connect.textContent=connectLabel;}
  });connect.disabled=!status.configured;panel.append(connect);
  if(result==='invalid-scope'){
    panel.append(element('p','Cloudflare returned invalid_scope. These are the exact scopes the website requested:'),element('pre',status.scopes,'oauth-scope-list'),element('p','The website includes offline_access for automatic renewal. In Cloudflare, edit this OAuth client and enable the Refresh Token grant, then save it. If it is already enabled, compare every scope above with the scopes registered in Cloudflare.','notice'));
  }
  if(status.connected)panel.append(button('Disconnect Cloudflare',async()=>{try{const data=await api('cloudflare/oauth/disconnect',{});await load();$('message').textContent=data.revoked?'Cloudflare disconnected. Automatic setup is paused; existing node connections remain active.':'Disconnected locally and paused automation. Cloudflare could not confirm revocation; remove this app authorization in your Cloudflare account.';}catch(e){notify(e.message);}}));
  const details=element('details');details.open=!status.configured||['invalid-scope','invalid-client','unauthorized-client','invalid-request','invalid-response-type','offline-required'].includes(result);details.append(element('summary','One-time OAuth app registration'));
  details.append(element('p','In Cloudflare, open Manage Account → OAuth clients and create a private client. Enable both Authorization Code and Refresh Token grants, choose the code response type and client_secret_basic authentication. Register the callback URL below.'),element('pre',status.callback),element('p','Select the scopes for Workers Scripts Write (required for game panel and VNC hostnames), Zone Read, DNS Edit, Cloudflare Tunnel Edit, Access Apps and Policies Edit, Access Service Tokens Edit, plus offline_access. Enter the exact scope IDs from the client registration below.'));
  details.append(link('Cloudflare OAuth registration instructions','https://developers.cloudflare.com/fundamentals/oauth/create-an-oauth-client/','text-link'));
  const form=element('form',undefined,'edit-form cloudflare-form');
  const id=field(form,'OAuth Client ID','clientId',status.clientId,{required:true,maxLength:256}),secret=field(form,'OAuth Client Secret','clientSecret','',{required:!status.configured,type:'password',autoComplete:'new-password',placeholder:status.configured?'Saved — leave blank to keep':'Client secret'});
  const scopeLabel=element('label','Registered OAuth scope IDs (space-separated)'),scopes=element('textarea');scopes.name='scopes';scopes.value=status.scopes;scopes.required=true;scopes.maxLength=2048;scopes.rows=4;scopeLabel.append(scopes);form.append(scopeLabel);
  const save=element('button','Save OAuth registration');form.append(save);details.append(form,element('p','Saving registration clears the previous authorization. Connect again afterward. Client secrets and tokens are encrypted and never displayed.','muted'));panel.append(details);
  form.onsubmit=async e=>{e.preventDefault();save.disabled=true;try{await api('cloudflare/oauth/client',{clientId:id.value.trim(),clientSecret:secret.value.trim(),scopes:scopes.value.trim()});history.replaceState(null,'','/cloudflare');await load();$('message').textContent='OAuth registration saved. Select Connect with Cloudflare to authorize.';}catch(e){notify(e.message);}finally{save.disabled=false;}};
}
