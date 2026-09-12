// Keep dynamically provisioned game domains when Wrangler replaces domain bindings.
import {execFileSync} from 'node:child_process';
import {readFile,writeFile,unlink} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
const cli='node_modules/wrangler/bin/wrangler.js';
// wrangler.jsonc may carry comments; strip them outside of string literals before parsing.
function parseJsonc(text){
  let out='',inString=false,i=0;
  while(i<text.length){
    const c=text[i],next=text[i+1];
    if(inString){out+=c;if(c==='\\'){out+=next??'';i+=2;continue;}if(c==='"')inString=false;i++;continue;}
    if(c==='"'){inString=true;out+=c;i++;continue;}
    if(c==='/'&&next==='/'){while(i<text.length&&text[i]!=='\n')i++;continue;}
    if(c==='/'&&next==='*'){i+=2;while(i<text.length&&!(text[i]==='*'&&text[i+1]==='/'))i++;i+=2;continue;}
    out+=c;i++;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g,'$1'));
}
const config=parseJsonc(await readFile('wrangler.jsonc','utf8'));
// Every registered hostname is kept, including ones still waiting for DNS: detaching those would
// restart Cloudflare's DNS publication lag on the next launch.
const output=execFileSync(process.execPath,[cli,'d1','execute','farmservers','--remote','--command','SELECT host FROM game_endpoints','--json'],{encoding:'utf8',maxBuffer:4*1024*1024});
const results=JSON.parse(output);
if(!Array.isArray(results)||results.some(r=>r.success===false||!Array.isArray(r.results)))throw new Error('Could not read game domains. Deployment stopped to preserve existing links.');
for(const row of results.flatMap(r=>r.results)){
  if(typeof row.host!=='string'||!/^(game|console)-[a-z0-9-]+\.sargentweb\.com$/.test(row.host))throw new Error('Invalid stored game domain');
  config.routes.push({pattern:row.host,custom_domain:true});
}
const path='.deploy-'+randomUUID()+'.json';
try{
  await writeFile(path,JSON.stringify(config,null,2));
  execFileSync(process.execPath,[cli,'deploy','--config',path],{stdio:'inherit'});
}finally{await unlink(path).catch(()=>{});}
