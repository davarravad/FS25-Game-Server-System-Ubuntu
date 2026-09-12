import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
// @ts-expect-error Local deployment CLI is JavaScript.
import {snapshot,nextVersion} from '../publish-release.mjs';

test('release snapshot includes saved changes, excludes secrets and preserves the real index',()=>{
  const temp=mkdtempSync(join(tmpdir(),'release-test-')),root=join(temp,'repo');mkdirSync(root);
  const git=(...args:string[])=>execFileSync('git',args,{cwd:root,encoding:'utf8'});
  try{
    git('init','--quiet');git('config','user.email','test@example.com');git('config','user.name','Test');
    for(const dir of ['app','docker','templates','sql','scripts']){mkdirSync(join(root,dir));writeFileSync(join(root,dir,'source.txt'),'original');}
    for(const file of ['.env.example','docker-compose.yml','LICENSE'])writeFileSync(join(root,file),'example');
    writeFileSync(join(root,'.gitignore'),'.env\n*.key\n');git('add','.');git('commit','-qm','fixture');
    writeFileSync(join(root,'app/source.txt'),'updated');writeFileSync(join(root,'scripts/new.py'),'new');
    writeFileSync(join(root,'app/.env'),'SECRET');writeFileSync(join(root,'scripts/private.key'),'SECRET');
    const index=readFileSync(join(root,'.git/index'));
    const first=snapshot(root,temp);
    assert.equal(git('show',first.tree+':app/source.txt'),'updated');
    assert.equal(git('show',first.tree+':scripts/new.py'),'new');
    assert.doesNotMatch(git('ls-tree','-r',first.tree),/private.key|app\/\.env/);
    assert.deepEqual(readFileSync(join(root,'.git/index')),index);
    assert.equal(snapshot(root,temp).tree,first.tree);
    writeFileSync(join(root,'scripts/new.py'),'changed');assert.notEqual(snapshot(root,temp).tree,first.tree);
    writeFileSync(join(root,'app/secret.pem'),'SECRET');assert.throws(()=>snapshot(root,temp),/Private or generated/);
  }finally{rmSync(temp,{recursive:true,force:true});}
});
test('version allocation includes withdrawn versions and uses numeric ordering',()=>{
  assert.equal(nextVersion([]),'v1.0.0');
  assert.equal(nextVersion([{version:'v1.0.9',enabled:1},{version:'v1.0.10',enabled:0}]),'v1.0.11');
});
