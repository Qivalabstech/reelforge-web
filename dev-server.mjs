// Local test server: serves /public and runs /api/*.js the way Vercel does.
//   node dev-server.mjs   ->  http://localhost:3000
// Reads keys from a local .env file if present.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';

const root = path.dirname(fileURLToPath(import.meta.url));
if (fs.existsSync(path.join(root, '.env'))) {
  for (const line of fs.readFileSync(path.join(root, '.env'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const port = Number(process.env.PORT || 3000);

// Python functions (api/*.py) run under uvicorn on a side port; needs: pip install -r requirements.txt uvicorn
const pyPort = port + 1;
let py = null;
function ensurePython() {
  if (py) return py;
  const exe = process.platform === 'win32' ? 'python' : 'python3';
  const child = spawn(exe, ['-m', 'uvicorn', '--app-dir', path.join(root, 'api'), 'fetch:app', '--port', String(pyPort), '--log-level', 'warning'], { stdio: 'inherit', env: process.env });
  py = new Promise((res) => setTimeout(res, 2500));
  child.on('exit', () => { py = null; });
  return py;
}
function proxyPython(req, res) {
  ensurePython().then(() => {
    const up = http.request({ host: '127.0.0.1', port: pyPort, path: '/', method: req.method, headers: req.headers }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
    up.on('error', (e) => res.status(502).json({ error: 'Python dev server not running: ' + e.message + '. Run: pip install -r requirements.txt uvicorn' }));
    req.pipe(up);
  });
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (o) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(o)); };
  if (url.pathname.startsWith('/api/')) {
    const name = url.pathname.slice(5).replace(/[^\w-]/g, '');
    if (name && !name.startsWith('_') && fs.existsSync(path.join(root, 'api', name + '.py'))) return proxyPython(req, res);
    const file = path.join(root, 'api', name + '.js');
    if (!name || name.startsWith('_') || !fs.existsSync(file)) return res.status(404).json({ error: 'Not found' });
    const chunks = []; for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks).toString('utf8');
    try { req.body = raw ? JSON.parse(raw) : {}; } catch { req.body = raw; }
    const mod = await import(pathToFileURL(file).href);
    return mod.default(req, res);
  }
  let p = path.join(root, 'public', decodeURIComponent(url.pathname));
  if (!p.startsWith(path.join(root, 'public'))) return res.status(403).end();
  if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, 'index.html');
  if (!fs.existsSync(p)) return res.status(404).end('Not found');
  res.setHeader('content-type', TYPES[path.extname(p)] || 'application/octet-stream');
  fs.createReadStream(p).pipe(res);
}).listen(port, () => console.log(`ReelForge Web on http://localhost:${port}`));
