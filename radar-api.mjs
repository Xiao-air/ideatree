import fs from 'node:fs/promises';
import path from 'node:path';
import { validateRadarCatalog, radarCounts } from './public/radar-model.mjs';

export async function createRadarApi({ dataRoot, sourceRoot, send }) {
  const file = path.join(dataRoot, 'radar-reserve.json');
  let state = null, loadError = null, queue = Promise.resolve();
  try {
    const stored = JSON.parse(await fs.readFile(file, 'utf8'));
    state = { ...validateRadarCatalog(stored), revision: Number(stored.revision) || 0 };
  } catch (e) { if (e.code !== 'ENOENT') loadError = 'Radar文件读取失败；原件保留，请恢复有效备份。'; }
  return async (req, res, url) => {
    if (!['/api/radar','/api/radar/source'].includes(url.pathname)) return false;
    if (loadError) { send(res, 503, { error: loadError }); return true; }
    if (url.pathname === '/api/radar/source') {
      if (req.method !== 'GET') { send(res, 405, { error: '只支持读取来源。' }); return true; }
      const relative = url.searchParams.get('path');
      const allowed = new Set(state ? [...state.propositions.flatMap(p => p.sources),...state.pending.map(p => p.source),...state.metadata.reports].map(s => s.path) : []);
      if (!allowed.has(relative)) { send(res, 404, { error: '该文件不在已导入的来源清单中。' }); return true; }
      try {
        const realRoot = await fs.realpath(sourceRoot);
        const realFile = await fs.realpath(path.join(realRoot, relative));
        if (!realFile.toLowerCase().startsWith((realRoot + path.sep).toLowerCase())) { send(res, 403, { error: '来源不能越过项目目录。' }); return true; }
        const body = await fs.readFile(realFile, 'utf8');
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'" });
        res.end(body);
      } catch (e) {
        if (['ENOENT','ENOTDIR'].includes(e.code)) send(res, 404, { error: '原件目前不在记录位置；仍保留来源说明。' });
        else throw e;
      }
      return true;
    }
    if (req.method === 'GET') { send(res, state ? 200 : 404, state || { error: '尚未导入Radar备选库。' }); return true; }
    if (req.method !== 'PUT' || !req.headers['content-type']?.startsWith('application/json')) { send(res, 405, { error: '请选择Radar JSON文件导入。' }); return true; }
    const chunks = []; let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 5_000_000) { send(res, 413, { error: 'Radar导入文件不能超过5 MB。' }); return true; }
      chunks.push(chunk);
    }
    let input, clean;
    try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')); clean = validateRadarCatalog(input); }
    catch (e) { send(res, 400, { error: e.message }); return true; }
    queue = queue.catch(() => {}).then(async () => {
      const currentRevision = state?.revision || 0;
      if (input.revision !== currentRevision) { send(res, 409, { error: 'Radar库已在另一窗口更新，请刷新后重新导入。' }); return; }
      const existing = state && validateRadarCatalog(state);
      if (existing && JSON.stringify(existing) === JSON.stringify(clean)) { send(res, 200, { revision: currentRevision, unchanged: true, counts: radarCounts(clean) }); return; }
      if (state) {
        const backups = path.join(dataRoot, 'radar-backups');
        await fs.mkdir(backups, { recursive: true });
        await fs.copyFile(file, path.join(backups, `revision-${currentRevision}.json`));
      }
      const updated = { ...clean, revision: currentRevision + 1 };
      await fs.writeFile(`${file}.tmp`, JSON.stringify(updated, null, 2), 'utf8');
      await fs.rename(`${file}.tmp`, file);
      state = updated;
      send(res, 200, { revision: state.revision, unchanged: false, counts: radarCounts(clean) });
    });
    await queue;
    return true;
  };
}
