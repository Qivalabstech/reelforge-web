// Local test server: serves /public and runs /api/*.js the way Vercel does.
//   node dev-server.mjs   ->  http://localhost:3000
// Reads keys from a local .env file if present.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
if (fs.existsSync(path.join(root, '.env'))) {
  for (const line of fs.readFileSync(path.join(root, '.env'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const port = Number(process.env.PORT || 3000);

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (o) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(o)); };
  if (url.pathname.startsWith('/api/')) {
    const name = url.pathname.slice(5).replace(/[^\w-]/g, '');
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
