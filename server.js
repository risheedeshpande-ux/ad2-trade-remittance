/* Local development server: serves public/ and the API on one port.
     npm start            -> http://localhost:8130
   State is kept in .data/state.json (override with STATE_FILE). */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { nodeHandler } = require('./server/app');

const ROOT = path.join(__dirname, 'public');
const PORT = Number(process.env.PORT || 8130);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.md': 'text/markdown; charset=utf-8',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
const ROUTES = ['health', 'session', 'state', 'command', 'status', 'reset'];
/* Same security headers as the deployment (vercel.json), so CSP problems show up locally. */
const HEADERS = (JSON.parse(fs.readFileSync(path.join(__dirname, 'vercel.json'), 'utf8')).headers || [])
  .filter(h => h.source === '/(.*)').flatMap(h => h.headers);

http.createServer((req, res) => {
  HEADERS.forEach(h => res.setHeader(h.key, h.value));
  const url = new URL(req.url, 'http://local');
  const m = /^\/api\/([a-z]+)\/?$/.exec(url.pathname);
  if (m && ROUTES.includes(m[1])) return nodeHandler(req, res, m[1]);
  let p = decodeURIComponent(url.pathname);
  if (p.endsWith('/')) p += 'index.html';
  const file = path.normalize(path.join(ROOT, p));
  if (!file.startsWith(ROOT)) { res.statusCode = 403; return res.end('Forbidden'); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.statusCode = 404; return res.end('Not found'); }
    res.setHeader('Content-Type', TYPES[path.extname(file)] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.end(buf);
  });
}).listen(PORT, () => console.log(`AD2 Trade Remittance on http://localhost:${PORT}`));
