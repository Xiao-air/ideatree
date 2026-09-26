import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateDocument, makeDemo } from './public/model.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const publicRoot = path.join(root, 'public');
const dataRoot = process.env.IDEATREE_DATA_DIR || path.join(root, 'data');
const port = Number(process.env.PORT || 4317);
const file = path.join(dataRoot, 'ideatree.json');
await fs.mkdir(dataRoot, { recursive: true });
let state;
try { const stored = JSON.parse(await fs.readFile(file, 'utf8')); state = { ...validateDocument(stored), revision: Number(stored.revision) || 0 }; }
catch (error) {
  if (error.code !== 'ENOENT') { console.error('无法读取已有数据。为保护记录，服务未启动：', error.message); process.exit(1); }
  state = { ...makeDemo(), revision: 0 };
  await fs.writeFile(file, JSON.stringify(state, null, 2), { flag: 'wx' });
}
let queue = Promise.resolve();
const send = (res, code, data) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json' };
const server = http.createServer(async (req, res) => {
  try {
    const expectedHost = `127.0.0.1:${port}`;
    if (![expectedHost, `localhost:${port}`].includes(req.headers.host)) return send(res, 403, { error: '仅允许本机访问。' });
    if (req.headers.origin && ![`http://${expectedHost}`, `http://localhost:${port}`].includes(req.headers.origin)) return send(res, 403, { error: '不接受外部网页的请求。' });
    const url = new URL(req.url, `http://${expectedHost}`);
    if (url.pathname === '/api/health') return send(res, 200, { app: 'ideatree' });
    if (url.pathname === '/api/data') {
      if (req.method === 'GET') return send(res, 200, state);
      if (req.method !== 'PUT' || !req.headers['content-type']?.startsWith('application/json')) return send(res, 405, { error: '不支持此请求。' });
      let body = ''; let size = 0;
      for await (const chunk of req) { size += chunk.length; if (size > 5_000_000) return send(res, 413, { error: '备份文件不能超过 5 MB。' }); body += chunk; }
      let input; let clean;
      try { input = JSON.parse(body); clean = validateDocument(input); } catch (e) { return send(res, 400, { error: e.message }); }
      queue = queue.catch(() => {}).then(async () => {
        if (input.revision !== state.revision) return send(res, 409, { error: '另一个窗口已修改记录。请先导出当前备份，再刷新此窗口。' });
        const updated = { ...clean, revision: state.revision + 1 };
        const backup = path.join(dataRoot, 'backups'); await fs.mkdir(backup, { recursive: true });
        await fs.copyFile(file, path.join(backup, `revision-${state.revision}.json`));
        const temp = `${file}.tmp`;
        await fs.writeFile(temp, JSON.stringify(updated, null, 2), 'utf8');
        await fs.rename(temp, file);
        state = updated;
        const backups = (await fs.readdir(backup)).filter(n => /^revision-\d+\.json$/.test(n)).sort((a,b) => Number(b.match(/\d+/)[0])-Number(a.match(/\d+/)[0]));
        await Promise.all(backups.slice(30).map(n => fs.unlink(path.join(backup,n))));
        send(res, 200, { revision: state.revision });
      });
      await queue; return;
    }
    if (!['GET','HEAD'].includes(req.method)) return send(res,405,{error:'不支持此请求。'});
    const relative = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    const requested = path.resolve(publicRoot, `.${relative}`);
    if (!requested.startsWith(publicRoot + path.sep)) return send(res,403,{error:'禁止访问。'});
    let content;
    try { content = await fs.readFile(requested); } catch (e) { if (e.code === 'ENOENT' || e.code === 'EISDIR') return send(res,404,{error:'文件不存在。'}); throw e; }
    res.writeHead(200, { 'Content-Type': mime[path.extname(requested)] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'X-Content-Type-Options':'nosniff', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'" });
    res.end(req.method === 'HEAD' ? undefined : content);
  } catch (error) { console.error(error); if (!res.headersSent) send(res,500,{error:'保存或读取失败，请保留当前窗口并导出备份。'}); else res.end(); }
});
server.on('error', e => { console.error(e.code === 'EADDRINUSE' ? `端口 ${port} 已被占用。已有 IdeaTree 可直接在浏览器打开。` : e.message); process.exit(1); });
server.listen(port,'127.0.0.1',() => console.log(`IdeaTree running at http://127.0.0.1:${port}\nData: ${file}`));
