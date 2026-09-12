import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {test} from 'node:test';
import assert from 'node:assert/strict';

const source=readFileSync(new URL('../public/live.js',import.meta.url),'utf8');
for(const [type,tab] of [['node','settings'],['server','settings'],['node','create'],['node','connection'],['server','logs'],['setup','']])test(`${type} ${tab||'page'} never rebuild automatically after live revisions`,async()=>{
  const state=fixture(type,'?tab='+tab);
  await state.refresh();
  await state.refresh();
  await state.refresh();
  assert.equal(state.renders,0);
  assert.equal(state.banner.hidden,false);
  assert.ok(state.banner.children.some((item:any)=>item.text==='Load latest changes'));
});
test('overview still updates automatically',async()=>{
  const state=fixture('overview','');
  await state.refresh();await state.refresh();
  assert.equal(state.renders,1);
});

function fixture(type:string,search:string){
  const banner={children:[] as any[],hidden:true,replaceChildren(){this.children=[];},append(...items:any[]){this.children.push(...items);}};
  const state={banner,renders:0,refresh:async()=>{}};
  let revision=0;
  runInNewContext(source+'\nexpose(refreshLive);',{
    URLSearchParams,AbortSignal,location:{search},me:{role:'admin'},dirty:false,
    document:{hidden:false,activeElement:null},route:()=>({type}),
    $:(id:string)=>id==='collaboration-status'?banner:id==='page'?{contains:()=>false}:null,
    api:async()=>({revision:++revision,editors:[]}),render:async()=>{state.renders++;},
    element:(_tag:string,text:string)=>({text}),button:(text:string,action:()=>void)=>({text,action}),
    expose:(refresh:()=>Promise<void>)=>{state.refresh=refresh;}
  });
  return state;
}
