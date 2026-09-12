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
    if(['admin','operator','viewer'].includes(loginUser.role)){location.replace(loginUser.role==='operator'?'/servers':'/');return;}
    message.textContent='Checking for approval automatically every 5 seconds.';
    button.onclick=async()=>{button.disabled=true;try{const result=await fetch('/api/logout',{method:'POST',headers:{'X-CSRF-Token':loginUser.csrf}});if(!result.ok)throw new Error();location.replace('/');}catch{message.textContent='Unable to sign out. Please retry.';button.disabled=false;}};
  }catch{message.textContent='Connection interrupted. Approval checks will retry automatically.';}
  finally{loginBusy=false;}
}
void checkMembership();setInterval(checkMembership,5000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)void checkMembership();});
