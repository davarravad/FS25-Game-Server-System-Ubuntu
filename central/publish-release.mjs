import {execFileSync} from 'node:child_process';
import {createPrivateKey,createPublicKey,createHash,sign,verify} from 'node:crypto';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir,homedir} from 'node:os';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const central=dirname(fileURLToPath(import.meta.url));
const roots=['app','docker','templates','sql','scripts','.env.example','docker-compose.yml','LICENSE'];
const hash=data=>createHash('sha256').update(data).digest('hex');
export function nextVersion(rows){
  const versions=rows.map(r=>r.version.slice(1).split('.').map(Number));
  versions.sort((a,b)=>b[0]-a[0]||b[1]-a[1]||b[2]-a[2]);
  const [major,minor,patch]=versions[0]||[1,0,-1];
  if(patch>=999999)throw new Error('Release patch limit reached');
  return `v${major}.${minor}.${patch+1}`;
}
export function snapshot(root,temp){
  // A separate index includes current changes without staging or committing the user's work.
  const env={...process.env,GIT_INDEX_FILE:join(temp,'index')};
  const git=(...args)=>execFileSync('git',args,{cwd:root,env,maxBuffer:150*1024*1024});
  git('read-tree','--empty');
  git('add','--',...roots);
  // Windows does not expose executable bits; retain them from committed source.
  const staged=new Set(git('ls-files','-z').toString().split('\0'));
  for(const entry of git('ls-tree','-rz','HEAD','--',...roots).toString().split('\0').filter(Boolean)){
    const [metadata,name]=entry.split('\t');
    if(metadata.startsWith('100755 ')&&staged.has(name))git('update-index','--chmod=+x','--',name);
  }
  const tree=git('write-tree').toString().trim();
  const entries=git('ls-tree','-rlz',tree).toString().split('\0').filter(Boolean);
  let total=0;
  for(const entry of entries){
    const [metadata,name]=entry.split('\t'),[mode,, ,size]=metadata.trim().split(/\s+/);
    if(!['100644','100755'].includes(mode))throw new Error(`Unsupported release file: ${name}`);
    if(/(^|\/)(node_modules|secrets|storage|__pycache__)(\/|$)|\.(key|pem|sqlite3|pyc)$|(^|\/)\.env($|\.(?!example$))/.test(name))throw new Error(`Private or generated file in release: ${name}`);
    total+=Number(size);
  }
  if(total>128*1024*1024)throw new Error('Release exceeds 128 MiB expanded limit');
  return {tree,archive:()=>git('archive','--format=tar.gz',tree),commit:git('rev-parse','HEAD').toString().trim()};
}
async function publish(){
  const temp=mkdtempSync(join(tmpdir(),'farmservers-release-'));
  try{
    const keyPath=process.env.FARMSERVERS_RELEASE_KEY||join(homedir(),'Documents','Farmservers-Releases','farmservers-release.key');
    const privateKey=createPrivateKey(readFileSync(keyPath));
    if(privateKey.asymmetricKeyType!=='ed25519')throw new Error('Release key must be Ed25519');
    const publicKey=createPublicKey(privateKey).export({type:'spki',format:'der'}).toString('base64');
    const response=await fetch('https://farmservers.sargentweb.com/api/distribution/key',{redirect:'error',signal:AbortSignal.timeout(20000)});
    if(!response.ok||(await response.json()).key!==publicKey)throw new Error('Signing key does not match the live site. Existing node trust must be preserved.');
    const wrangler=(...args)=>execFileSync(process.execPath,[join(central,'node_modules/wrangler/bin/wrangler.js'),...args],{cwd:central,encoding:'utf8',maxBuffer:8*1024*1024});
    const query=sql=>{
      const result=JSON.parse(wrangler('d1','execute','farmservers','--remote','--command',sql,'--json'));
      if(result.some(r=>!r.success))throw new Error('Release database query failed');
      return result.flatMap(r=>r.results);
    };
    const source=snapshot(resolve(central,'..'),temp);
    const rows=query('SELECT version,manifest,enabled FROM releases ORDER BY created DESC');
    const latest=rows.find(r=>r.enabled);
    if(latest&&JSON.parse(latest.manifest).source_tree===source.tree){
      console.log(`Node source unchanged; ${latest.version} remains available.`);return;
    }
    const version=nextVersion(rows),archive=source.archive();
    if(archive.length>12*1024*1024)throw new Error('Release exceeds 12 MiB compressed limit');
    const sha256=hash(archive),objectKey='sha256/'+sha256;
    const manifest=JSON.stringify({version,commit:source.commit,source_tree:source.tree,sha256,size:archive.length});
    const signature=sign(null,Buffer.from(manifest),privateKey).toString('base64');
    if(!verify(null,Buffer.from(manifest),createPublicKey(privateKey),Buffer.from(signature,'base64')))throw new Error('Release signature verification failed');
    const archivePath=join(temp,'node.tar.gz');writeFileSync(archivePath,archive);
    console.log(`Publishing ${version} (${archive.length} bytes), source ${source.tree}`);
    wrangler('r2','object','put','farmservers-releases/'+objectKey,'--remote','--file',archivePath,'--content-type','application/gzip');
    const downloaded=join(temp,'verified.tar.gz');
    wrangler('r2','object','get','farmservers-releases/'+objectKey,'--remote','--file',downloaded);
    if(hash(readFileSync(downloaded))!==sha256)throw new Error('Published archive checksum mismatch');
    const quote=value=>"'"+value.replaceAll("'","''")+"'";
    const sql=`INSERT INTO releases(version,manifest,signature,object_key,created) VALUES(${[version,manifest,signature,objectKey].map(quote).join(',')},${Math.floor(Date.now()/1000)});`;
    const sqlPath=join(temp,'release.sql');writeFileSync(sqlPath,sql);
    // A plain INSERT preserves immutable versions if another publisher wins a race.
    wrangler('d1','execute','farmservers','--remote','--file',sqlPath,'--yes');
    const saved=query(`SELECT manifest,signature,enabled FROM releases WHERE version=${quote(version)}`)[0];
    if(!saved?.enabled||saved.manifest!==manifest||saved.signature!==signature)throw new Error('Release inventory verification failed');
    console.log(`${version} is available on the website. Choose a node to start its update.`);
  }finally{rmSync(temp,{recursive:true,force:true});}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  publish().catch(error=>{console.error('Node release publication failed:',error.message);process.exitCode=1;});
}
