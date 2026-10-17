"use strict";
let loginBusy=false,loginUser,wasSignedIn=false;
async function checkMembership(){
  if(loginBusy||document.hidden)return;loginBusy=true;
  const message=document.getElementById('login-message'),button=document.getElementById('signout');
  try{
    const response=await fetch('/api/me',{cache:'no-store',signal:AbortSignal.timeout(10000)});
    if(response.status===401){if(wasSignedIn)location.replace('/');return;}
    if(!response.ok)throw new Error();
    loginUser=await response.json();wasSignedIn=true;button.hidden=false;
    if(loginUser.role!=='pending'){location.replace(loginUser.role==='operator'?'/servers':'/');return;}
    showRequest(loginUser.request?.status||'none');
    message.textContent='Checking for approval automatically every 5 seconds.';
    button.onclick=async()=>{button.disabled=true;try{const result=await fetch('/api/logout',{method:'POST',headers:{'X-CSRF-Token':loginUser.csrf}});if(!result.ok)throw new Error();location.replace('/');}catch{message.textContent='Unable to sign out. Please retry.';button.disabled=false;}};
  }catch{message.textContent='Connection interrupted. Approval checks will retry automatically.';}
  finally{loginBusy=false;}
}
function showRequest(status){
  const form=document.getElementById('access-form'),state=document.getElementById('access-state');
  if(!form||!state)return;
  form.hidden=status==='open';
  state.textContent=status==='open'?'Request sent. An administrator will review it and you will be let in as soon as you have a role.':status==='denied'?'Your last request was declined. You can send another if something has changed.':'';
  if(!form.dataset.ready){
    form.dataset.ready='1';
    form.onsubmit=async event=>{
      event.preventDefault();const submit=form.querySelector('button');submit.disabled=true;
      try{
        const result=await fetch('/api/access-request',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':loginUser.csrf},body:JSON.stringify({message:document.getElementById('access-message').value})});
        if(!result.ok)throw new Error((await result.json().catch(()=>({}))).error||'Request failed');
        showRequest('open');
      }catch(error){state.textContent='Could not send the request: '+error.message;}
      finally{submit.disabled=false;}
    };
  }
}
void checkMembership();setInterval(checkMembership,5000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)void checkMembership();});
