import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {test} from 'node:test';
import assert from 'node:assert/strict';
const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const refresh=source.slice(source.indexOf('async function refresh(){'),source.indexOf("document.addEventListener('visibilitychange'"));
for(const [name,hidden,focused,pending,expected] of [
  ['active page',false,true,false,1],['hidden page',true,true,false,0],['unfocused page',false,false,false,0],['request already running',false,true,true,0]
] as const)test('history polling: '+name,async()=>{
  let historyCalls=0,requests=0;
  const updates:{state:string;message:string;ping:boolean}[]=[];
  const status={textContent:''};
  const context:any={pending,document:{hidden,hasFocus:()=>focused},refreshHistory:async()=>{historyCalls++;},refreshTelemetry:null,redrawFleet:null,me:{role:'admin'},nodes:[],AbortSignal,Date,route:()=>({type:'node',id:'pilot'}),historyStamp:'',historyAt:0,
    setLiveStatus:(state:string,message:string,ping=false)=>updates.push({state,message,ping}),
    api:async(path:string)=>{requests++;return path==='me'?{role:'admin',name:'Preview'}:{nodes:[]};},updateAccountAvatar:()=>{},$:(id:string)=>id==='page'?{querySelector:()=>null}:status};
  runInNewContext(refresh,context);await context.refresh();
  assert.equal(historyCalls,expected);assert.equal(requests,expected*2);
  assert.equal(updates.length,expected);
  if(expected){assert.equal(updates[0].state,'healthy');assert.equal(updates[0].ping,true);assert.match(updates[0].message,/^Live - checked /);}
});
