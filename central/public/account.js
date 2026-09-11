function updateAccountAvatar(){
  const box=$('user-avatar'),url=me.avatarUrl||'';
  if(box.dataset.avatar===url)return;box.dataset.avatar=url;box.textContent=me.name.trim().slice(0,2).toUpperCase();
  if(!/^https:\/\/cdn\.discordapp\.com\/(avatars|embed\/avatars)\//.test(url))return;
  const img=element('img');img.alt='';img.width=34;img.height=34;img.referrerPolicy='no-referrer';
  img.onload=()=>{if(box.dataset.avatar===url)box.replaceChildren(img);};img.src=url;
}
const roleNames={pending:'Pending',viewer:'Viewer',operator:'Staff',admin:'Administrator'};
function setupHeader(){
  for(const item of document.querySelectorAll('[data-admin-only]'))item.hidden=me.role!=='admin';
  $('cloudflare-nav').hidden=me.role!=='admin';
  $('user-name').textContent=me.name;updateAccountAvatar();$('users-nav').hidden=me.role!=='admin';
  if(me.role==='admin')$('identity').prepend(link('Users & permissions','/users'));
  const menus=[$('account-menu'),$('notifications-menu')];
  for(const menu of menus)menu.addEventListener('toggle',()=>{if(menu.open)for(const other of menus)if(other!==menu)other.open=false;});
  document.addEventListener('click',e=>{for(const menu of menus)if(!menu.contains(e.target))menu.open=false;});
  document.addEventListener('keydown',e=>{if(e.key==='Escape')for(const menu of menus)if(menu.open){menu.open=false;menu.querySelector('summary').focus();}});
  let notices=[],busy=false,signature='';
  const read=async ids=>{try{for(let offset=0;offset<ids.length;offset+=200)await api('notifications/read',{ids:ids.slice(offset,offset+200)});signature='';await refreshNotices();}catch(e){$('notification-status').textContent=e.message;}};
  $('notifications-read').onclick=()=>read(notices.filter(n=>!n.read).map(n=>n.id));
  async function refreshNotices(){
    if(busy||document.hidden)return;busy=true;
    try{const data=await api('notifications');const next=JSON.stringify(data);if(next===signature)return;signature=next;notices=data;
      const count=data.filter(n=>!n.read).length;$('notification-count').textContent=count;$('notification-count').hidden=!count;$('notifications-read').disabled=!count;$('notifications-read').hidden=!count;
      $('notification-status').textContent=count?`${count} unread`:'All caught up';$('notifications-list').replaceChildren();
      for(const notice of data){const row=element('article',undefined,'notification '+(notice.read?'read':'unread'));const titleLink=link(notice.title,notice.href,'text-link');if(!notice.read)titleLink.onclick=e=>{e.preventDefault();read([notice.id]).finally(()=>{location.href=notice.href;});};row.append(titleLink,element('p',notice.detail));if(!notice.read){const mark=button('Mark read',()=>read([notice.id]));mark.setAttribute('aria-label','Mark as read: '+notice.title);row.append(mark);}$('notifications-list').append(row);}
      if(!data.length)$('notifications-list').append(element('p','No current issues or recent updates.'));
    }catch(e){$('notification-status').textContent='Notifications unavailable: '+e.message;}finally{busy=false;}
  }
  if(me.role==='operator'){for(const item of document.querySelectorAll('[data-nav],.nav-group'))item.hidden=item.dataset.nav!=='servers';$('notifications-menu').hidden=true;document.querySelector('.brand').href='/servers';return;}
  void refreshNotices();setInterval(refreshNotices,5000);
}
async function userManagement(){
  title('Users & permissions','Approve Discord users and control what they can access.','users');
  if(me.role!=='admin'){empty($('page'),'Administrator access is required.');return;}
  const permissions=section('Role permissions');
  const table=element('table',undefined,'permissions-table'),head=element('tr');for(const text of ['Role','Permissions'])head.append(element('th',text));table.append(head);
  for(const [role,text] of [['Pending','Sign in only; no fleet access.'],['Viewer','View nodes, servers, history, software status and notifications.'],['Staff','View game servers and their status; start, stop and restart game servers only.'],['Administrator','Everything: node and game server management, files, credentials, Cloudflare, the game library, users, signed releases and updates.']]){const row=element('tr');row.append(element('td',role),element('td',text));table.append(row);}permissions.append(table);
  const usersSection=section('Users'),search=element('input'),list=element('div');search.type='search';search.placeholder='Search name or Discord ID';search.setAttribute('aria-label','Search users');list.id='users';usersSection.append(search,list);
  let users=await api('users');
  const renderUsers=()=>{list.replaceChildren();for(const user of users.filter(u=>(u.name+' '+u.id).toLowerCase().includes(search.value.toLowerCase()))){
    const row=element('div'),identity=element('div');identity.append(element('strong',user.name),element('p','Discord ID: '+user.id,'muted'),badge(user.blocked?'Blocked':user.role==='pending'?'Pending approval':'Active'));row.append(identity);
    const select=element('select');select.setAttribute('aria-label','Role for '+user.name);for(const [value,label] of Object.entries(roleNames)){const option=element('option',label);option.value=value;select.append(option);}select.value=user.role;select.disabled=user.id===me.id;
    const save=button('Save role',async()=>{save.disabled=true;try{await api('users',{id:user.id,role:select.value});user.role=select.value;renderUsers();$('message').textContent='Role saved. Permissions update automatically within five seconds.';}catch(e){select.value=user.role;$('message').textContent=e.message;}finally{save.disabled=false;}});save.disabled=user.id===me.id||!!user.blocked;select.disabled=user.id===me.id||!!user.blocked;row.append(select,save);
    const block=button(user.blocked?'Unblock user':'Block user',async()=>{if(!confirm(user.blocked?'Unblock '+user.name+'? They will return to pending approval.':'Block '+user.name+'? They will be signed out and unable to log in.'))return;block.disabled=true;try{await api('users/block',{id:user.id,blocked:!user.blocked});users=await api('users');renderUsers();$('message').textContent=user.blocked?'User unblocked and pending approval.':'User blocked. Existing sessions revoked.';}catch(e){$('message').textContent=e.message;}finally{block.disabled=false;}});block.disabled=user.id===me.id;row.append(block);list.append(row);
  }if(!list.children.length)empty(list,'No matching users.');};search.oninput=renderUsers;renderUsers();
  const create=section('Add a Discord user'),form=element('form',undefined,'edit-form');create.append(element('p','Pre-approve a Discord account by ID. The user still signs in through Discord. Choose Pending to revoke fleet access later.'));
  field(form,'Discord user ID','id','',{required:true,pattern:'[0-9]{17,20}'});field(form,'Display name','name','',{required:true,maxLength:100});
  const label=element('label','Role'),role=element('select');role.name='role';for(const [value,text] of Object.entries(roleNames)){const option=element('option',text);option.value=value;role.append(option);}label.append(role);form.append(label);const submit=element('button','Add user');form.append(submit);create.append(form);
  form.onsubmit=async e=>{e.preventDefault();submit.disabled=true;try{await api('users/create',Object.fromEntries(new FormData(form)));users=await api('users');form.reset();renderUsers();$('message').textContent='User added.';}catch(error){$('message').textContent=error.message;}finally{submit.disabled=false;}};
  await auditLog(()=>users);
}
async function auditLog(users){
  const panel=section('Audit log'),status=element('p',undefined,'muted'),wrap=element('div',undefined,'update-table-wrap'),table=element('table',undefined,'update-table'),head=element('thead'),heading=element('tr'),rows=element('tbody');
  status.setAttribute('role','status');
  for(const label of ['When','Who','Action','Target']){const cell=element('th',label);cell.scope='col';heading.append(cell);}head.append(heading);table.append(element('caption','Most recent 100 events'),head,rows);wrap.append(table);
  const refresh=async()=>{status.textContent='Loading…';try{const events=await api('audit');rows.replaceChildren(...events.map(event=>{const row=element('tr'),who=users().find(u=>u.id===event.actor);row.append(element('td',stamp(event.ts)),element('td',who?who.name+' · '+event.actor:event.actor),element('td',event.action),element('td',event.target));return row;}));status.textContent=events.length?'Showing the '+events.length+' most recent events.':'No events recorded yet.';}catch(e){status.textContent=e.message;}};
  panel.append(element('p','Sign-ins, role changes, node and release changes, server commands and management operations recorded by the site. Events are kept for 90 days.'),button('Refresh audit log',refresh),status,wrap);
  await refresh();
}
