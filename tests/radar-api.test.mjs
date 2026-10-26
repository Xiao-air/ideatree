import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir,mkdtemp,readFile,writeFile,readdir,rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { validateRadarCatalog } from '../public/radar-model.mjs';

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const catalog=JSON.parse(await readFile(new URL('./fixtures/radar-reserve.json',import.meta.url),'utf8'));

test('independent Radar API preserves main bytes, prevents duplicate reimport, backs up, survives restart and restricts sources',async()=>{
  const testRoot=process.env.TEMP||process.env.TMP||path.resolve(root,'data');await mkdir(testRoot,{recursive:true});
  const dataDir=await mkdtemp(path.join(testRoot,'radar-api-'));let child;
  const base='http://127.0.0.1:4332';
  const launch=()=>new Promise((resolve,reject)=>{
    const env={...process.env,PORT:'4332',IDEATREE_DATA_DIR:dataDir};delete env.IDEATREE_RADAR_SOURCE_ROOT;
    child=spawn(process.execPath,['server.mjs'],{cwd:root,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
    const timer=setTimeout(()=>reject(new Error('server timeout')),10000);
    child.stdout.on('data',chunk=>{if(chunk.toString().includes('IdeaTree running')){clearTimeout(timer);resolve();}});
    child.once('error',e=>{clearTimeout(timer);reject(e);});child.once('exit',code=>{if(code){clearTimeout(timer);reject(new Error(`exit ${code}`));}});
  });
  const stop=()=>new Promise(resolve=>{if(!child||child.exitCode!==null)return resolve();child.once('exit',resolve);child.kill();});
  const put=(payload,revision,headers={})=>fetch(`${base}/api/radar`,{method:'PUT',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify({...payload,revision})});
  try {
    await writeFile(path.join(dataDir,'radar-source-root.txt'),dataDir,'utf8');
    await launch();assert.equal((await fetch(`${base}/api/radar`)).status,404);
    const before=await readFile(path.join(dataDir,'ideatree.json'),'utf8');
    const imported=await put(catalog,0);assert.equal(imported.status,200);assert.equal((await imported.json()).revision,1);
    assert.equal(await readFile(path.join(dataDir,'ideatree.json'),'utf8'),before);
    const radarBefore=await readFile(path.join(dataDir,'radar-reserve.json'),'utf8');
    assert.deepEqual(validateRadarCatalog(JSON.parse(radarBefore)),validateRadarCatalog(catalog));
    const repeated=await put(catalog,1);assert.equal((await repeated.json()).unchanged,true);
    assert.equal(await readFile(path.join(dataDir,'radar-reserve.json'),'utf8'),radarBefore);
    assert.equal((await put(catalog,0)).status,409);
    assert.equal((await put(catalog,1,{Origin:'https://example.com'})).status,403);
    assert.equal((await put({version:1,ideas:[]},1)).status,400);
    const duplicate=structuredClone(catalog);duplicate.propositions.push(duplicate.propositions[0]);
    assert.equal((await put(duplicate,1)).status,400);
    assert.equal(await readFile(path.join(dataDir,'radar-reserve.json'),'utf8'),radarBefore);
    assert.equal((await fetch(`${base}/api/radar/source?path=../private.md`)).status,404);
    const allowed=catalog.propositions[0].sources[0].path;
    await mkdir(path.dirname(path.join(dataDir,allowed)),{recursive:true});await writeFile(path.join(dataDir,allowed),'source fixture','utf8');
    const source=await fetch(`${base}/api/radar/source?path=${encodeURIComponent(allowed)}`);assert.equal(source.status,200);assert.equal(await source.text(),'source fixture');
    assert.match(source.headers.get('content-type'),/text\/plain/);
    const update=structuredClone(catalog);update.name='更新后的Radar';
    const saved=await put(update,1);assert.equal(saved.status,200);assert.equal((await saved.json()).revision,2);
    assert.equal((await readdir(path.join(dataDir,'radar-backups'))).length,1);
    assert.equal(await readFile(path.join(dataDir,'radar-backups','revision-1.json'),'utf8'),radarBefore);
    await stop();await launch();
    const reopened=await fetch(`${base}/api/radar`).then(r=>r.json());assert.equal(reopened.name,update.name);assert.equal(reopened.propositions.length,catalog.propositions.length);
    assert.equal(await readFile(path.join(dataDir,'ideatree.json'),'utf8'),before);
    await stop();await writeFile(path.join(dataDir,'radar-reserve.json'),'{broken','utf8');await launch();
    assert.equal((await fetch(`${base}/api/data`)).status,200);
    assert.equal((await fetch(`${base}/api/radar`)).status,503);
    assert.equal(await readFile(path.join(dataDir,'radar-reserve.json'),'utf8'),'{broken');
  }finally{await stop();await rm(dataDir,{recursive:true,force:true});}
});
