import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {test} from 'node:test';
import assert from 'node:assert/strict';

const source=readFileSync(new URL('../public/attention.js',import.meta.url),'utf8');

// attention.js is a classic browser script: run it against a fake window, clock and timer.
function fixture(){
  const listeners:Record<string,(() => void)[]>={},documentListeners:Record<string,(() => void)[]>={};
  const clock={now:1_000_000};let tick:()=>void=()=>{};
  const window:any={};
  const context:any={
    window,document:{hidden:false,addEventListener:(t:string,f:()=>void)=>(documentListeners[t]??=[]).push(f)},
    addEventListener:(t:string,f:()=>void)=>(listeners[t]??=[]).push(f),
    setInterval:(f:()=>void)=>{tick=f;},
    Date:{now:()=>clock.now}
  };
  runInNewContext(source,context);
  return {
    window,context,
    input:(type='mousemove')=>listeners[type].forEach(f=>f()),
    advance:(ms:number)=>{clock.now+=ms;tick();},
    setHidden:(hidden:boolean)=>{context.document.hidden=hidden;documentListeners.visibilitychange.forEach(f=>f());}
  };
}

test('a page with recent input is active',()=>{
  const s=fixture();
  assert.equal(s.window.pageActive(),true);
  s.advance(119_000);
  assert.equal(s.window.pageActive(),true);
});

test('two minutes without input pauses polling, and input resumes it with one wake-up',()=>{
  const s=fixture();let idle=0,woke=0;
  s.window.onPageIdle(()=>{idle++;});s.window.onPageActive(()=>{woke++;});
  s.advance(121_000);
  assert.equal(s.window.pageActive(),false);assert.equal(idle,1);
  s.advance(30_000);
  assert.equal(idle,1,'going idle is announced once');
  s.input('keydown');s.input('mousemove');
  assert.equal(s.window.pageActive(),true);assert.equal(woke,1,'returning is announced once');
});

test('a hidden tab is inactive, and showing it again counts as activity',()=>{
  const s=fixture();let idle=0,woke=0;
  s.window.onPageIdle(()=>{idle++;});s.window.onPageActive(()=>{woke++;});
  s.setHidden(true);
  assert.equal(s.window.pageActive(),false);assert.equal(idle,1);
  s.advance(600_000);
  s.setHidden(false);
  assert.equal(s.window.pageActive(),true);assert.equal(woke,1);
});

test('a callback returning false is dropped and one that throws does not block the others',()=>{
  const s=fixture();let dropped=0,after=0;
  s.window.onPageActive(()=>{dropped++;return false;});
  s.window.onPageActive(()=>{throw new Error('broken page');});
  s.window.onPageActive(()=>{after++;});
  for(let i=0;i<2;i++){s.advance(121_000);s.input();}
  assert.equal(dropped,1);assert.equal(after,2);
});
