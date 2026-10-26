import fs from 'node:fs/promises';
import path from 'node:path';
import { validateSchedule } from './public/schedule-model.mjs';

export async function createScheduleApi({ dataRoot, send }) {
  const file = path.join(dataRoot, 'weekly-schedule.json');
  let state = { version: 1, entries: [], revision: 0 }, loadError = null, queue = Promise.resolve();
  try { const stored = JSON.parse(await fs.readFile(file,'utf8')); state = { ...validateSchedule(stored), revision: Number(stored.revision)||0 }; }
  catch (error) { if (error.code !== 'ENOENT') loadError = '实验安排读取失败，原文件已保留。请恢复有效备份后重启。'; }
  return async (req, res, url) => {
    if (url.pathname !== '/api/schedule') return false;
    if (loadError) { send(res,503,{error:loadError}); return true; }
    if (req.method === 'GET') { send(res,200,state); return true; }
    if (req.method !== 'PUT' || !req.headers['content-type']?.startsWith('application/json')) { send(res,405,{error:'不支持此请求。'}); return true; }
    const chunks = []; let size = 0;
    for await (const chunk of req) { size += chunk.length; if (size > 5_000_000) { send(res,413,{error:'安排备份不能超过 5 MB。'}); return true; } chunks.push(chunk); }
    let input, clean;
    try { input=JSON.parse(Buffer.concat(chunks).toString('utf8')); clean=validateSchedule(input); }
    catch(error) { send(res,400,{error:error.message}); return true; }
    queue = queue.catch(()=>{}).then(async()=>{
      if (input.revision !== state.revision) { send(res,409,{error:'实验安排已在其他窗口更新，请先导出当前安排，再刷新。'}); return; }
      const backup = path.join(dataRoot,'schedule-backups');
      await fs.mkdir(backup,{recursive:true});
      try { await fs.copyFile(file,path.join(backup,`revision-${state.revision}.json`)); } catch(error) { if(error.code!=='ENOENT') throw error; }
      const updated={...clean,revision:state.revision+1};
      await fs.writeFile(`${file}.tmp`,JSON.stringify(updated,null,2),'utf8'); await fs.rename(`${file}.tmp`,file); state=updated;
      const backups=(await fs.readdir(backup)).filter(name=>/^revision-\d+\.json$/.test(name)).sort((a,b)=>Number(b.match(/\d+/)[0])-Number(a.match(/\d+/)[0]));
      await Promise.all(backups.slice(30).map(name=>fs.unlink(path.join(backup,name))));
      send(res,200,{revision:state.revision});
    });
    await queue; return true;
  };
}
