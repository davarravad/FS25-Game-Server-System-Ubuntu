'use strict';
// Users & permissions, modelled on Discord's Members and Roles screens: members hold roles, roles decide
// what a member can see and do, and each role can be limited to chosen game servers.
const rolePresets=['#47d8b0','#74b6ed','#a78bfa','#f472b6','#f5a35c','#e74c3c','#f2d16b','#99aab5'];

function memberAvatar(user,size=40){
  const box=element('span',undefined,'member-avatar'),url=user.avatarUrl||'';
  box.style.setProperty('--size',size+'px');box.textContent=(user.name||'?').trim().slice(0,2).toUpperCase();box.setAttribute('aria-hidden','true');
  if(/^https:\/\/cdn\.discordapp\.com\/(avatars|embed\/avatars)\//.test(url)){
    const img=element('img');img.alt='';img.width=size;img.height=size;img.referrerPolicy='no-referrer';
    img.onload=()=>box.replaceChildren(img);img.src=url;
  }
  return box;
}
function roleChip(role){const chip=element('span',role.name,'role-chip');chip.style.setProperty('--role',role.color);return chip;}
function roleScope(role){return role.all_servers?'All servers':role.servers.length+' server'+(role.servers.length===1?'':'s');}
function roleDetail(role,groups){
  if(role.is_admin)return 'Full access to everything';
  if(!role.permissions.length)return 'No access yet';
  const names=new Map(groups.flatMap(g=>g.items.map(i=>[i.id,i.label])));
  return role.permissions.map(p=>names.get(p)||p).join(' · ')+' — '+roleScope(role);
}
function usersTabs(active){
  const bar=element('div',undefined,'subnav tabs');bar.setAttribute('role','group');bar.setAttribute('aria-label','Users and permissions');
  for(const [id,text,href] of [['members','Members','/users'],['roles','Roles','/users/roles']]){const tab=link(text,href,'button tab');if(id===active)tab.setAttribute('aria-current','page');bar.append(tab);}
  $('page').append(bar);
}
// Re-run fn while the page is still showing; it never overlaps itself and pauses while the tab is hidden.
function pollWhile(host,fn,ms=6000){
  let busy=false;const timer=setInterval(async()=>{
    if(!host.isConnected){clearInterval(timer);return;}
    if(busy||document.hidden)return;busy=true;try{await fn();}catch{ /* The next poll retries. */ }finally{busy=false;}
  },ms);
}
function pickChips(roles,selected,onchange){
  const box=element('div',undefined,'role-picks');
  for(const role of roles){
    const pick=element('button',role.name,'role-pick');pick.type='button';pick.style.setProperty('--role',role.color);
    const sync=()=>pick.setAttribute('aria-pressed',String(selected.has(role.id)));
    pick.onclick=()=>{if(selected.has(role.id))selected.delete(role.id);else selected.add(role.id);sync();onchange?.();};sync();box.append(pick);
  }
  return box;
}
function toggleRow(labelText,detail,checked,onchange){
  const row=element('label',undefined,'toggle-row'),box=element('input');box.type='checkbox';box.checked=checked;box.onchange=()=>onchange(box.checked,box);
  const text=element('span',undefined,'toggle-text');text.append(element('strong',labelText));if(detail)text.append(element('small',detail,'muted'));
  row.append(box,text);return {row,box};
}

async function membersPage(r){
  title('Users & permissions','Choose who can see and do what. Members hold roles, and roles decide access.','users');
  if(me.role!=='admin'){empty($('page'),'Administrator access is required.');return;}
  if(r.tab==='member')return memberProfile(r.id);
  if(r.tab==='roles')return rolesPage();
  if(r.tab==='role')return roleEditor(r.id);
  return membersList();
}

/* ---------- Members ---------- */
async function membersList(){
  usersTabs('members');
  let data=await api('members');
  const requestsBox=section('Access requests'),membersBox=section('Members'),addBox=section('Add a member');
  requestsBox.classList.add('requests-box');
  const search=element('input'),filter=element('select'),count=element('p',undefined,'muted'),list=element('div',undefined,'member-list'),toolbar=element('div',undefined,'toolbar member-toolbar');
  search.type='search';search.placeholder='Search by name or Discord ID';search.setAttribute('aria-label','Search members');
  filter.setAttribute('aria-label','Filter by role');count.setAttribute('role','status');
  toolbar.append(search,filter);membersBox.append(toolbar,count,list);
  const drawFilter=()=>{const keep=filter.value;filter.replaceChildren();for(const [value,text] of [['','All roles'],...data.roles.map(x=>[x.id,x.name]),['none','No roles']]){const o=element('option',text);o.value=value;filter.append(o);}filter.value=[...filter.options].some(o=>o.value===keep)?keep:'';};
  const drawMembers=()=>{
    const roles=new Map(data.roles.map(x=>[x.id,x])),needle=search.value.trim().toLowerCase();
    const shown=data.members.filter(m=>(!needle||(m.name+' '+m.id).toLowerCase().includes(needle))&&(!filter.value||(filter.value==='none'?!m.roles.length:m.roles.includes(filter.value))));
    list.replaceChildren(...shown.map(m=>{
      const row=link('','/users/'+m.id,'member-row'),who=element('span',undefined,'member-who'),chips=element('span',undefined,'chips');
      who.append(element('strong',m.name),element('small','Discord ID '+m.id,'muted'));
      for(const id of m.roles)if(roles.has(id))chips.append(roleChip(roles.get(id)));
      if(!m.roles.length)chips.append(element('span',m.request?.status==='open'?'Requested access':m.active?'Legacy access':'No roles yet','muted'));
      const state=element('span',m.blocked?'Blocked':m.initialAdmin?'Initial administrator':m.active?'':'Waiting',m.blocked?'badge bad':'badge quiet');
      if(!state.textContent)state.hidden=true;
      row.append(memberAvatar(m),who,chips,state,element('small',m.lastLogin?'Signed in '+timeAgo(Date.now()-m.lastLogin*1000):'Never signed in','muted member-seen'));
      row.setAttribute('aria-label','Open '+m.name);return row;
    }));
    if(!shown.length)empty(list,data.members.length?'No members match.':'No one has signed in yet.');
    count.textContent=shown.length+' of '+data.members.length+' member'+(data.members.length===1?'':'s');
  };
  const drawRequests=()=>{
    const open=data.members.filter(m=>m.request?.status==='open'&&!m.blocked);
    requestsBox.hidden=!open.length;requestsBox.replaceChildren(element('h2','Access requests'),element('p','These people are signed in and waiting. Pick their roles to let them in.','muted'));
    for(const m of open){
      const row=element('article',undefined,'request-row'),head=element('div',undefined,'request-head'),text=element('div'),selected=new Set(data.roles.some(x=>x.id==='game-server-team')?['game-server-team']:[]);
      text.append(element('strong',m.name),element('small',' asked '+timeAgo(Date.now()-m.request.created*1000),'muted'));if(m.request.message)text.append(element('p','“'+m.request.message+'”','request-message'));
      head.append(memberAvatar(m),text);
      const approve=button('Approve',async()=>{approve.disabled=true;try{await api('access-requests/resolve',{id:m.id,action:'approve',roles:[...selected]});$('message').textContent=m.name+' now has access.';await reload();}catch(e){$('message').textContent=e.message;approve.disabled=false;}});
      const decline=button('Decline',async()=>{decline.disabled=true;try{await api('access-requests/resolve',{id:m.id,action:'deny'});$('message').textContent='Request declined.';await reload();}catch(e){$('message').textContent=e.message;decline.disabled=false;}});
      const refresh=()=>{approve.disabled=!selected.size;};refresh();
      const actions=element('div',undefined,'actions');actions.append(approve,decline);
      row.append(head,element('small','Roles to give them','muted'),pickChips(data.roles,selected,refresh),actions);requestsBox.append(row);
    }
  };
  const reload=async()=>{data=await api('members');drawFilter();drawRequests();drawMembers();};
  search.oninput=drawMembers;filter.onchange=drawMembers;drawFilter();drawRequests();drawMembers();

  const details=element('details',undefined,'add-member');details.append(element('summary','Add by Discord ID'));
  addBox.replaceChildren(element('h2','Add a member'));addBox.append(details);
  const form=element('form',undefined,'edit-form'),chosen=new Set();
  details.append(element('p','Pre-approve someone who has not signed in yet. They still sign in with Discord and land straight in the roles you pick.','muted'));
  field(form,'Discord user ID','id','',{required:true,pattern:'[0-9]{17,20}'});field(form,'Display name','name','',{required:true,maxLength:100});
  const picks=element('div',undefined,'form-roles');picks.append(element('small','Roles','muted'),pickChips(data.roles,chosen));form.append(picks);
  const submit=element('button','Add member');form.append(submit);details.append(form);
  form.onsubmit=async e=>{e.preventDefault();submit.disabled=true;try{const values=Object.fromEntries(new FormData(form));await api('users/create',{id:values.id,name:values.name,roles:[...chosen]});form.reset();chosen.clear();for(const p of picks.querySelectorAll('.role-pick'))p.setAttribute('aria-pressed','false');$('message').textContent='Member added.';await reload();}catch(error){$('message').textContent=error.message;}finally{submit.disabled=false;}};

  // New sign-ins and requests appear on their own. Controls someone is using are left alone.
  pollWhile(membersBox,async()=>{
    const next=await api('members');if(JSON.stringify(next.members)===JSON.stringify(data.members)&&JSON.stringify(next.roles)===JSON.stringify(data.roles))return;
    data=next;drawFilter();if(!requestsBox.contains(document.activeElement))drawRequests();drawMembers();
  });
  await auditLog(()=>data.members);
}

/* ---------- Member profile ---------- */
async function memberProfile(id){
  let data;try{data=await api('members?id='+encodeURIComponent(id));}catch(e){usersTabs('members');empty($('page'),e.message);return;}
  const member=()=>data.member;
  title(member().name,'Profile, roles and recent activity.','users');
  $('breadcrumbs').append(link('Users & permissions','/users','text-link'),element('span',' / '),element('span',member().name));
  const self=member().id===me.id,locked=self||member().initialAdmin;
  const card=section('Profile'),head=element('div',undefined,'profile-head'),facts=element('dl',undefined,'profile-facts'),status=element('span');
  const names=element('div');names.append(element('h3',member().name+(self?' (you)':'')),element('small','Discord ID '+member().id,'muted'));
  const copy=button('Copy ID',async()=>{try{await navigator.clipboard.writeText(member().id);copy.textContent='Copied';}catch{copy.textContent='Copy failed';}setTimeout(()=>{copy.textContent='Copy ID';},1500);});
  head.append(memberAvatar(member(),72),names,copy);card.append(head,facts);
  const drawFacts=()=>{
    status.className='badge '+(member().blocked?'bad':member().active?'good':'quiet');status.textContent=member().blocked?'Blocked':member().active?'Has access':member().request?.status==='open'?'Requested access':'No access yet';
    facts.replaceChildren();for(const [label,value] of [['Joined',stamp(member().created)],['Last sign-in',member().lastLogin?stamp(member().lastLogin)+' ('+timeAgo(Date.now()-member().lastLogin*1000)+')':'Never']]){const item=element('div');item.append(element('dt',label),element('dd',value));facts.append(item);}
    const state=element('div'),dd=element('dd');dd.append(status);state.append(element('dt','Status'),dd);facts.append(state);
  };

  const rolesBox=section('Roles'),note=element('p',undefined,'muted'),saved=element('p');saved.setAttribute('role','status');
  rolesBox.append(note,saved);
  const rows=new Map();let saving=false;
  const request=member().request;
  const drawNote=()=>{note.textContent=member().blocked?'This member is blocked and cannot sign in.':'Tick the roles this member should have. Access is the combination of every role, and changes apply straight away.';};
  const current=()=>new Set(member().roles);
  for(const role of data.roles){
    const lockedAdmin=role.id==='admin'&&(locked);
    const {row,box}=toggleRow(role.name,roleDetail(role,data.permissionGroups||[]),current().has(role.id),async checked=>{
      const next=current();if(checked)next.add(role.id);else next.delete(role.id);
      saving=true;box.disabled=true;saved.textContent='Saving…';
      try{const result=await api('members/roles',{id:member().id,roles:[...next]});member().roles=result.roles;saved.textContent='Saved.';}
      catch(e){box.checked=!checked;saved.textContent=e.message;}
      finally{saving=false;box.disabled=lockedAdmin;void refresh();}
    });
    box.disabled=lockedAdmin;if(lockedAdmin)row.title=self?'You cannot remove your own Admin role.':'The initial administrator always keeps Admin.';
    const dot=element('span',undefined,'role-dot');dot.style.setProperty('--role',role.color);row.prepend(dot);row.insertBefore(box,dot);
    rows.set(role.id,box);rolesBox.append(row);
  }
  if(request?.status==='open'&&!member().roles.length){
    const ask=element('div',undefined,'notice');ask.append(element('strong','Waiting for roles. '),element('span',request.message?'They wrote: “'+request.message+'”':'They asked for access without a message.'));note.before(ask);
  }
  drawFacts();drawNote();

  const danger=section('Access'),blockNote=element('p',undefined,'muted'),blockMessage=element('p');blockMessage.setAttribute('role','status');
  const block=button('',async()=>{
    const blocking=!member().blocked;
    if(!confirm(blocking?'Block '+member().name+'? They will be signed out and unable to sign in.':'Unblock '+member().name+'? They return to the request screen and need roles again.'))return;
    block.disabled=true;try{await api('users/block',{id:member().id,blocked:blocking});await refresh(true);blockMessage.textContent=blocking?'Member blocked and signed out.':'Member unblocked. Give them roles to let them in.';}catch(e){blockMessage.textContent=e.message;}finally{block.disabled=locked;}
  });
  const drawBlock=()=>{block.textContent=member().blocked?'Unblock member':'Block member';block.disabled=locked;blockNote.textContent=locked?(self?'You cannot block yourself.':'The initial administrator cannot be blocked.'):member().blocked?'Unblocking returns them to the request screen; roles must be given again.':'Blocking signs them out and stops them signing in. Their roles are cleared when you unblock them.';};
  danger.append(blockNote,block,blockMessage);drawBlock();

  const activity=section('Recent activity'),list=element('ul',undefined,'activity-list');activity.append(list);
  const drawActivity=()=>{list.replaceChildren(...data.activity.map(a=>{const li=element('li');li.append(element('span',a.action,'activity-action'),element('span',' '+a.target+' · ','muted'),element('small',stamp(a.ts),'muted'));return li;}));if(!data.activity.length)empty(list,'No recorded activity yet.');};
  const changes=section('Changes to this member'),changeList=element('ul',undefined,'activity-list');changes.append(changeList);
  const drawChanges=()=>{changeList.replaceChildren(...data.changes.map(a=>{const li=element('li');li.append(element('span',a.action,'activity-action'),element('span',' '+a.target+' · by '+(a.actor_name||a.actor)+' · ','muted'),element('small',stamp(a.ts),'muted'));return li;}));if(!data.changes.length)empty(changeList,'Nothing has changed yet.');};
  drawActivity();drawChanges();

  async function refresh(force=false){
    if(saving&&!force)return;data=await api('members?id='+encodeURIComponent(id));
    for(const [roleId,box] of rows)if(!box.matches(':focus'))box.checked=member().roles.includes(roleId);
    drawFacts();drawNote();drawBlock();drawActivity();drawChanges();
  }
  pollWhile(card,()=>refresh());
}

/* ---------- Roles ---------- */
async function rolesPage(){
  usersTabs('roles');
  let data=await api('roles');
  const box=section('Roles');box.append(element('p','A role is a set of permissions and the game servers it applies to. Members can hold several roles.','muted'));
  const actions=element('div',undefined,'actions');actions.append(link('Create role','/users/roles/new'));box.append(actions);
  const grid=element('div',undefined,'role-grid');box.append(grid);
  const draw=()=>{
    grid.replaceChildren(...data.roles.map(role=>{
      const card=link('','/users/roles/'+role.id,'role-card'),head=element('span',undefined,'role-card-head');
      card.style.setProperty('--role',role.color);
      head.append(element('span',undefined,'role-dot'),element('strong',role.name),element('small',role.members+' member'+(role.members===1?'':'s'),'muted'));
      card.append(head,element('span',roleDetail(role,data.permissionGroups),'role-card-detail muted'));card.setAttribute('aria-label','Edit role '+role.name);return card;
    }));
  };
  draw();
  pollWhile(box,async()=>{const next=await api('roles');if(JSON.stringify(next.roles)!==JSON.stringify(data.roles)){data=next;draw();}});
}

async function roleEditor(id){
  const creating=id==='new';
  const [roleData,memberData]=await Promise.all([api('roles'),creating?Promise.resolve({members:[]}):api('members')]);
  let role=creating?{id:'',name:'',color:rolePresets[0],is_admin:false,permissions:['servers.view'],all_servers:true,servers:[],members:0}:roleData.roles.find(x=>x.id===id);
  usersTabs('roles');
  if(!role){empty($('page'),'That role no longer exists.');$('page').append(link('Back to roles','/users/roles'));return;}
  $('breadcrumbs').append(link('Users & permissions','/users','text-link'),element('span',' / '),link('Roles','/users/roles','text-link'),element('span',' / '),element('span',creating?'New role':role.name));
  title(creating?'Create role':role.name,creating?'Name it, choose what it allows, and pick which servers it covers.':'Change what this role allows and which servers it covers.','users');
  const draft={name:role.name,color:role.color,is_admin:role.is_admin,permissions:new Set(role.permissions),all_servers:role.all_servers,servers:new Set(role.servers)};
  const builtIn=role.id==='admin';
  const touch=()=>{dirty=true;saveBar.hidden=false;};
  const message=element('p');message.setAttribute('role','status');

  const basics=section('Role');
  const nameField=field(basics.appendChild(element('div',undefined,'edit-form')),'Role name','name',draft.name,{required:true,maxLength:40,placeholder:'For example: Game Server Team'});
  nameField.oninput=()=>{draft.name=nameField.value;touch();};
  const colors=element('div',undefined,'color-row'),colorInput=element('input');colorInput.type='color';colorInput.value=draft.color;colorInput.setAttribute('aria-label','Role colour');
  const swatches=element('div',undefined,'swatches');
  const setColor=value=>{draft.color=value;colorInput.value=value;for(const s of swatches.children)s.setAttribute('aria-pressed',String(s.dataset.color===value));touch();};
  for(const preset of rolePresets){const s=element('button',undefined,'swatch');s.type='button';s.dataset.color=preset;s.style.setProperty('--role',preset);s.setAttribute('aria-label','Use colour '+preset);s.onclick=()=>setColor(preset);swatches.append(s);}
  colorInput.oninput=()=>setColor(colorInput.value);for(const s of swatches.children)s.setAttribute('aria-pressed',String(s.dataset.color===draft.color));
  colors.append(element('small','Colour','muted'),swatches,colorInput);basics.append(colors);

  const access=element('div');$('page').append(access);
  const drawAccess=()=>{
    access.replaceChildren();
    if(builtIn){const s=section('Access',access);s.append(element('p','Admin always has full access to everything and cannot be limited. You can still rename it or change its colour.','notice'));return;}
    const top=section('Administrator',access);
    const admin=toggleRow('Administrator','Full access to everything: members and roles, nodes, files, ports, passwords, Cloudflare and updates. Use sparingly.',draft.is_admin,checked=>{draft.is_admin=checked;touch();drawAccess();});
    top.append(admin.row);
    if(draft.is_admin){top.append(element('p','Members with this role can do everything, so permissions and server limits do not apply.','muted'));return;}
    const perms=section('Permissions',access);perms.append(element('p','What members with this role can do on the servers below.','muted'));
    for(const group of roleData.permissionGroups){
      const groupBox=element('div',undefined,'perm-group');groupBox.append(element('h3',group.label));
      for(const item of group.items){
        const forced=item.id==='servers.view'&&[...draft.permissions].some(p=>p!=='servers.view');
        const {row,box}=toggleRow(item.label,item.detail,draft.permissions.has(item.id),checked=>{if(checked)draft.permissions.add(item.id);else draft.permissions.delete(item.id);if(draft.permissions.size>1)draft.permissions.add('servers.view');touch();drawAccess();});
        box.disabled=forced;if(forced)row.title='Viewing is included whenever another permission is on.';groupBox.append(row);
      }
      perms.append(groupBox);
    }
    const scope=section('Server access',access);
    const all=element('label',undefined,'toggle-row'),allBox=element('input');allBox.type='radio';allBox.name='scope';allBox.checked=draft.all_servers;
    const some=element('label',undefined,'toggle-row'),someBox=element('input');someBox.type='radio';someBox.name='scope';someBox.checked=!draft.all_servers;
    all.append(allBox,element('span','All servers, including ones added later'));some.append(someBox,element('span','Only the servers I choose'));
    allBox.onchange=()=>{draft.all_servers=true;touch();drawAccess();};someBox.onchange=()=>{draft.all_servers=false;touch();drawAccess();};
    scope.append(all,some);
    if(!draft.all_servers){
      const picker=element('div',undefined,'server-picker'),known=new Set();
      for(const node of roleData.catalog){
        const keys=node.servers.map(s=>node.id+'/'+s.instance);keys.forEach(k=>known.add(k));
        const group=element('fieldset',undefined,'server-group'),legend=element('legend');
        const allIn=element('input');allIn.type='checkbox';allIn.checked=keys.length>0&&keys.every(k=>draft.servers.has(k));allIn.setAttribute('aria-label','Select every server on '+node.name);
        allIn.onchange=()=>{for(const k of keys)allIn.checked?draft.servers.add(k):draft.servers.delete(k);touch();drawAccess();};
        legend.append(allIn,element('span',node.name));group.append(legend);
        for(const server of node.servers){const key=node.id+'/'+server.instance,{row}=toggleRow(server.name,server.instance,draft.servers.has(key),checked=>{checked?draft.servers.add(key):draft.servers.delete(key);touch();drawAccess();});group.append(row);}
        if(!node.servers.length)group.append(element('p','No game servers reported yet.','muted'));picker.append(group);
      }
      const stale=[...draft.servers].filter(k=>!known.has(k));
      if(stale.length){const group=element('fieldset',undefined,'server-group'),legend=element('legend','Not reporting right now');group.append(legend);for(const key of stale){const {row}=toggleRow(key,'Not in the latest report',true,checked=>{if(!checked)draft.servers.delete(key);touch();drawAccess();});group.append(row);}picker.append(group);}
      scope.append(picker,element('p',draft.servers.size?draft.servers.size+' server'+(draft.servers.size===1?'':'s')+' selected.':'No servers selected yet: members with this role will not see any game server.','muted'));
    }
  };
  drawAccess();

  if(!creating){
    const members=section('Members with this role'),list=element('div',undefined,'role-members'),adder=element('div',undefined,'actions'),pickMember=element('select');
    let people=memberData.members;
    pickMember.setAttribute('aria-label','Add a member to this role');
    const drawMembers=()=>{
      const has=people.filter(m=>m.roles.includes(role.id));
      list.replaceChildren(...has.map(m=>{
        const row=element('div',undefined,'role-member'),remove=button('Remove',async()=>{if(m.initialAdmin&&role.id==='admin')return;remove.disabled=true;try{await api('members/roles',{id:m.id,roles:m.roles.filter(r=>r!==role.id)});people=(await api('members')).members;drawMembers();}catch(e){message.textContent=e.message;remove.disabled=false;}});
        remove.disabled=m.initialAdmin&&role.id==='admin';remove.setAttribute('aria-label','Remove '+m.name+' from '+role.name);
        row.append(memberAvatar(m,28),link(m.name,'/users/'+m.id,'text-link'),remove);return row;
      }));
      if(!has.length)empty(list,'No one has this role yet.');
      pickMember.replaceChildren(Object.assign(element('option','Add a member…'),{value:''}),...people.filter(m=>!m.roles.includes(role.id)&&!m.blocked).map(m=>Object.assign(element('option',m.name),{value:m.id})));
    };
    const add=button('Add',async()=>{if(!pickMember.value)return;const m=people.find(x=>x.id===pickMember.value);add.disabled=true;try{await api('members/roles',{id:m.id,roles:[...m.roles,role.id]});people=(await api('members')).members;drawMembers();}catch(e){message.textContent=e.message;}finally{add.disabled=false;}});
    adder.append(pickMember,add);members.append(list,adder);drawMembers();
    pollWhile(members,async()=>{if(document.activeElement===pickMember)return;people=(await api('members')).members;drawMembers();});
  }

  const saveBar=element('div',undefined,'save-bar');saveBar.hidden=!creating;
  const save=element('button',creating?'Create role':'Save changes');
  save.type='button';save.onclick=async()=>{
    if(!draft.name.trim()){message.textContent='Give the role a name first.';nameField.focus();return;}
    save.disabled=true;message.textContent='Saving…';
    try{
      const body={...(creating?{}:{id:role.id}),name:draft.name.trim(),color:draft.color,is_admin:draft.is_admin,permissions:[...draft.permissions],all_servers:draft.all_servers,servers:[...draft.servers]};
      const result=await api('roles',body);dirty=false;
      if(creating){location.href='/users/roles/'+result.id;return;}
      message.textContent='Saved. Members with this role get the change straight away.';saveBar.hidden=true;
      draft.permissions=new Set(draft.permissions.size>1?[...draft.permissions,'servers.view']:[...draft.permissions]);
    }catch(e){message.textContent=e.message;}finally{save.disabled=false;}
  };
  saveBar.append(save,link('Cancel','/users/roles'));
  if(!creating&&!builtIn){const remove=button('Delete role',async()=>{if(!confirm('Delete the '+role.name+' role? Members who only have this role lose access and return to the request screen.'))return;remove.disabled=true;try{await api('roles/delete',{id:role.id});dirty=false;location.href='/users/roles';}catch(e){message.textContent=e.message;remove.disabled=false;}});remove.className='danger';saveBar.append(remove);}
  $('page').append(message,saveBar);
}
