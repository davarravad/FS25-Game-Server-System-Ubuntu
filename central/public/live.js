// Advisory editing presence. The API still checks authorization on every write.
let liveRevision,liveChanged=false,liveBusy=false,editDirty=false,editActive=false;
function liveResource(){const r=route();return r.type==='server'?'server:'+r.id+':'+r.instance:r.type==='node'?'node:'+r.id:'page:'+r.type;}
function setupLive(){
  const banner=element('div',undefined,'notice');banner.id='collaboration-status';banner.hidden=true;$('page').before(banner);
  document.addEventListener('input',event=>{if(me.role==='admin'&&event.target.closest('#page form, #users')){editDirty=true;editActive=true;void refreshLive();}});
  document.addEventListener('focusin',event=>{if(me.role==='admin'&&event.target.closest('#page form, #users')){editActive=true;void refreshLive();}});
  document.addEventListener('focusout',()=>{setTimeout(()=>{editActive=!!document.activeElement?.closest('#page form, #users');},0);});
  // Presence leases last 20 seconds on the server; refreshing every 10 keeps them alive.
  void refreshLive();setInterval(()=>void refreshLive(),10000);
}
async function refreshLive(){
  if(!['admin','viewer'].includes(me.role)||liveBusy||document.hidden)return;liveBusy=true;
  try{
    const data=await api('live',{resource:liveResource(),editing:editActive||editDirty||dirty},{signal:AbortSignal.timeout(15000)});
    if(liveRevision!==undefined&&data.revision!==liveRevision)liveChanged=true;
    liveRevision=data.revision;
    const banner=$('collaboration-status');banner.replaceChildren();
    if(data.editors.length)banner.append(element('p',data.editors.map(e=>e.name).join(', ')+' is editing this item. Coordinate before saving to avoid overwriting each other.'));
    if(route().type==='game-status')liveChanged=false;
    if(liveChanged&&!$('fleet-switcher')?.open){
      const settingsPage=['node','server'].includes(route().type)&&['settings','create','logs','connection'].includes(new URLSearchParams(location.search).get('tab'));
      // The Node updates and System Status pages refresh their own data every few seconds; the
      // System Status page also holds readiness results and repair controls the administrator is
      // reading (running a check or a repair itself causes a revision bump). Never rebuild either
      // page underneath them.
      const selfRefreshing=['setup','status'].includes(route().type);
      if(route().type!=='game-status'&&!$('charts')&&!settingsPage&&!selfRefreshing&&!editDirty&&!dirty&&!$('page').contains(document.activeElement)){
        liveChanged=false;await render();
      }else{
        banner.append(element('p','Updates are available. This page will stay as it is until you load them.'),button('Load latest changes',async()=>{if((editDirty||dirty)&&!confirm('Discard unsaved edits and load the latest changes?'))return;editDirty=false;dirty=false;editActive=false;liveChanged=false;await load();void refreshLive();}));
      }
    }
    banner.hidden=!banner.children.length;
  }catch(e){const banner=$('collaboration-status');banner.hidden=false;banner.replaceChildren(element('p','Live collaboration is reconnecting. Editing presence may be out of date.'));}
  finally{liveBusy=false;}
}
