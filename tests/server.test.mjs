import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,readdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
test('local API persists data, rejects conflicts and malformed imports, and keeps backups',async()=>{
  const dataDir=await mkdtemp(path.join(tmpdir(),'ideatree-test-'));let child;
  const launch=()=>new Promise((resolve,reject)=>{
    child=spawn(process.execPath,['server.mjs'],{cwd:root,env:{...process.env,PORT:'4328',IDEATREE_DATA_DIR:dataDir},windowsHide:true,stdio:['ignore','pipe','pipe']});
    const timer=setTimeout(()=>reject(new Error('Server startup timed out')),10000);
    child.stdout.on('data',chunk=>{if(chunk.toString().includes('IdeaTree running')){clearTimeout(timer);resolve();}});
    child.once('error',e=>{clearTimeout(timer);reject(e);});child.once('exit',code=>{if(code){clearTimeout(timer);reject(new Error(`server exited ${code}`));}});
  });
  const stop=()=>new Promise(resolve=>{if(!child||child.exitCode!==null)return resolve();child.once('exit',resolve);child.kill();});
  const base='http://127.0.0.1:4328';
  try {
    await launch();
    const initial=await fetch(`${base}/api/data`).then(r=>r.json());assert.equal(initial.ideas.length,6);
    const put=(d,headers={})=>fetch(`${base}/api/data`,{method:'PUT',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(d)});
    const changed={...initial,name:'测试空间'};const saved=await put(changed);assert.equal(saved.status,200);assert.equal((await saved.json()).revision,1);
    assert.equal((await put(changed)).status,409);
    assert.equal((await put({...changed,revision:1,ideas:'bad'})).status,400);
    assert.equal((await put({...changed,revision:1},{Origin:'https://example.com'})).status,403);
    const fetched=await fetch(`${base}/api/data`).then(r=>r.json());assert.equal(fetched.name,'测试空间');assert.equal(fetched.revision,1);
    assert.equal((await fetch(`${base}/data/ideatree.json`)).status,404);
    assert.equal((await readdir(path.join(dataDir,'backups'))).length,1);
    const backup=JSON.parse(await readFile(path.join(dataDir,'backups','revision-0.json'),'utf8'));assert.equal(backup.name,initial.name);
    const splitDoc=structuredClone(fetched);splitDoc.ideas.find(i=>i.id==='notes').events.at(-1).status='split';
    const splitSave=await put(splitDoc);assert.equal(splitSave.status,200);assert.equal((await splitSave.json()).revision,2);
    const invalidSplit=structuredClone(splitDoc);invalidSplit.revision=2;invalidSplit.ideas.find(i=>i.id==='weekly').events.at(-1).status='split';
    assert.equal((await put(invalidSplit)).status,400);
    await stop();await launch();const reopened=await fetch(`${base}/api/data`).then(r=>r.json());
    assert.equal(reopened.name,'测试空间');assert.equal(reopened.ideas.find(i=>i.id==='notes').events.at(-1).status,'split');
    assert.equal(reopened.ideas.find(i=>i.id==='failures').initialStatus,'pending');
    await stop();await writeFile(path.join(dataDir,'ideatree.json'),'{broken');
    await assert.rejects(launch());assert.equal(await readFile(path.join(dataDir,'ideatree.json'),'utf8'),'{broken');
  } finally {await stop();await rm(dataDir,{recursive:true,force:true});}
});
