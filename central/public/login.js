'use strict';
(async()=>{
  try {
    const response=await fetch('/api/me',{cache:'no-store'});
    if(!response.ok)return;
    const user=await response.json();
    const button=document.getElementById('signout');
    button.hidden=false;
    button.onclick=async()=>{
      button.disabled=true;
      try {
        const result=await fetch('/api/logout',{method:'POST',headers:{'X-CSRF-Token':user.csrf}});
        if(!result.ok)throw new Error('Unable to sign out. Please retry.');
        location.replace('/');
      } catch(error) {document.getElementById('login-message').textContent=error.message;button.disabled=false;}
    };
  } catch { /* Keep the sign-in screen available when offline. */ }
})();
