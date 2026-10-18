"use strict";
// One definition of "someone is looking at this page": the tab is visible and there has been
// input within the last two minutes. Polling code asks pageActive() instead of document.hidden, so
// a dashboard left open on a second monitor stops generating requests, and onPageActive callbacks
// refresh once the moment the visitor comes back instead of waiting for the next timer tick.
(()=>{
  const IDLE_MS=120000,wake=[],sleep=[];
  let last=Date.now(),state=true;
  const active=()=>!document.hidden&&Date.now()-last<IDLE_MS;
  // A callback that returns false is dropped; pages use that when they have been replaced.
  const run=list=>{for(const fn of list.slice()){try{if(fn()===false)list.splice(list.indexOf(fn),1);}catch{ /* One failing page hook must not block the rest. */ }}};
  const sync=()=>{const now=active();if(now===state)return;state=now;run(now?wake:sleep);};
  const touch=()=>{last=Date.now();if(!state)sync();};
  for(const type of ['mousemove','mousedown','keydown','wheel','touchstart','scroll','focus'])addEventListener(type,touch,{passive:true,capture:true});
  // Coming back to the tab counts as activity; going away or sitting idle is picked up by the check below.
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)last=Date.now();sync();});
  setInterval(sync,10000);
  window.pageActive=active;
  window.onPageActive=fn=>{wake.push(fn);};
  window.onPageIdle=fn=>{sleep.push(fn);};
})();
