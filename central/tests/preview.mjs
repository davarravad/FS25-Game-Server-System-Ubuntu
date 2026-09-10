// Local-only visual fixture. Synthetic data; never deployed with public assets.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
const jobs=[];
createServer(async(req,res)=>{
  const path=new URL(req.url,'http://localhost').pathname;
  if(path.startsWith('/api/')){
    const data={
      '/api/me':{id:'preview',name:'Local preview administrator',role:'admin',csrf:'fixture'},
      '/api/users':[],
      '/api/nodes':{nodes:[{id:'pilot',name:'Ubuntu pilot',enabled:1,online:true,snapshot:{samples:[],servers:[]}}]},
      '/api/history':{points:[]},
      '/api/distribution/releases':[{version:'v1.0.0'}],
      '/api/distribution/updates':jobs
    };
    if(req.method==='POST'){
      if(path==='/api/distribution/updates')jobs.push({id:'fixture',node_id:'pilot',version:'v1.0.0',status:'queued',updated:Math.floor(Date.now()/1000)});
      if(path==='/api/distribution/cancel')jobs.length=0;
      res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({ok:true}));return;
    }
    res.writeHead(path in data?200:404,{'Content-Type':'application/json'}).end(JSON.stringify(data[path]||{error:'Fixture endpoint unavailable'}));return;
  }
  const name=path==='/'?'index.html':path.slice(1);
  if(!['index.html','app.js','style.css','setup.html','node-distribution.txt','central-setup.txt'].includes(name)){res.writeHead(404).end();return;}
  const type=name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':name.endsWith('.html')?'text/html':'text/plain';
  res.writeHead(200,{'Content-Type':type+'; charset=utf-8'}).end(await readFile(new URL('../public/'+name,import.meta.url)));
}).listen(8766,'127.0.0.1',()=>console.log('Synthetic dashboard: http://127.0.0.1:8766'));
