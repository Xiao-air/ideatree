import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,writeFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
test('weekly plans persist independently, reject stale saves and keep backups without replacing corrupt files',async()=>{
  const dataDir=await mkdtemp(path.join(tmpdir(),'ideatree-planner-'));let child;
  const launch=()=>new Promise((resolve,reject)=>{
    child=spawn(process.execPath,['server.mjs'],{cwd:root,env:{...process.env,PORT:'4346',IDEATREE_DATA_DIR:dataDir},windowsHide:true,stdio:['ignore','pipe','pipe']});
    const timer=setTimeout(()=>reject(new Error('Server timeout')),10000);
    child.stdout.on('data',chunk=>{if(chunk.toString().includes('IdeaTree running')){clearTimeout(timer);resolve();}});
    child.once('error',error=>{clearTimeout(timer);reject(error);});
    child.once('exit',code=>{if(code){clearTimeout(timer);reject(new Error('Server exited: '+code));}});
  });
  const stop=()=>new Promise(resolve=>{if(!child||child.exitCode!==null)return resolve();child.once('exit',resolve);child.kill();});
  const base='http://127.0.0.1:4346',put=(doc,headers={})=>fetch(base+'/api/schedule',{method:'PUT',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(doc)});
  try{
    await launch();const mainBefore=await readFile(path.join(dataDir,'ideatree.json'),'utf8');
    assert.deepEqual(await fetch(base+'/api/schedule').then(r=>r.json()),{version:1,entries:[],revision:0});
    const plan={version:1,revision:0,entries:[{id:'a',title:'细胞接种',date:'2030-01-01',start:540,end:600,note:'准备材料',color:'#277d72'}]};
    assert.equal((await put(plan)).status,200);assert.equal((await put(plan)).status,409);
    assert.equal((await put({...plan,revision:1,entries:[{...plan.entries[0],end:0}]})).status,400);
    assert.equal((await put({...plan,revision:1},{Origin:'https://example.com'})).status,403);
    assert.equal((await put({...plan,revision:1,entries:[]})).status,200);
    const backup=JSON.parse(await readFile(path.join(dataDir,'schedule-backups','revision-1.json'),'utf8'));assert.equal(backup.entries.length,1);
    assert.equal((await readdir(path.join(dataDir,'schedule-backups'))).length,1);
    await stop();await launch();assert.equal((await fetch(base+'/api/schedule').then(r=>r.json())).revision,2);
    assert.equal(await readFile(path.join(dataDir,'ideatree.json'),'utf8'),mainBefore);
    assert.equal((await fetch(base+'/schedule.html')).status,200);
    const work={id:'weekly-work',title:'预约设备后测试',week:'2030-01-07',note:'时间待定，先准备样品。',color:'#5b73ae'};
    assert.equal((await put({version:1,revision:2,entries:[work]})).status,200);
    await stop();await launch();const pending=await fetch(base+'/api/schedule').then(r=>r.json());assert.deepEqual(pending.entries,[work]);assert.equal(pending.revision,3);
    const scheduled={id:work.id,title:work.title,note:work.note,color:work.color,date:'2030-01-09',start:540,end:660};
    assert.equal((await put({...pending,entries:[scheduled]})).status,200);
    const workBackup=JSON.parse(await readFile(path.join(dataDir,'schedule-backups','revision-3.json'),'utf8'));assert.deepEqual(workBackup.entries,[work]);
    await stop();await launch();const moved=await fetch(base+'/api/schedule').then(r=>r.json());assert.deepEqual(moved.entries,[scheduled]);assert.equal(moved.revision,4);
    assert.equal(await readFile(path.join(dataDir,'ideatree.json'),'utf8'),mainBefore);
    await stop();await writeFile(path.join(dataDir,'weekly-schedule.json'),'{broken');await launch();
    assert.equal((await fetch(base+'/api/schedule')).status,503);assert.equal((await put(plan)).status,503);
    assert.equal(await readFile(path.join(dataDir,'weekly-schedule.json'),'utf8'),'{broken');
  }finally{await stop();await rm(dataDir,{recursive:true,force:true});}
});
