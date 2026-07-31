// NetMap3D server — run it on the Ubuntu box, open it from anywhere.
//
//   ssh homelab
//   cd /srv/netmap3d && docker compose up -d
//   → http://homelab:8080
//
// It serves the app itself and exposes the NOS manager over HTTP, so the real
// FRRouting instances run on the server (native Docker, native namespaces)
// while the browser only draws. Node standard library only — the project rule
// is no install-step dependencies, and that applies here too.
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const nos = require('../nos/manager.js');

const ROOT = path.resolve(__dirname, '..');
const PORT = +(process.env.PORT || 8080);
const HOST = process.env.HOST || '0.0.0.0';
// Off by default. Spawning containers is root-equivalent on the host, so it is
// not something to leave open on a network by accident.
const NOS_ENABLED = /^(1|true|yes|on)$/i.test(process.env.NETMAP3D_NOS || '');

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.map': 'application/json; charset=utf-8',
};

// Only ever serve files that really sit under ROOT — the classic path-traversal
// hole is a URL like /../../etc/passwd, and resolving first is what closes it.
function safePath(urlPath) {
  const clean = decodeURIComponent(urlPath.split('?')[0]);
  const abs = path.resolve(ROOT, '.' + (clean === '/' ? '/index.html' : clean));
  if (abs !== ROOT && !abs.startsWith(ROOT + path.sep)) return null;
  return abs;
}

function send(res, code, body, type = 'application/json; charset=utf-8') {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
  res.writeHead(code, { 'content-type': type, 'content-length': buf.length,
    'cache-control': 'no-store' });
  res.end(buf);
}

function readBody(req, limit = 32 << 20) {
  return new Promise((resolve, reject) => {
    let n = 0; const chunks = [];
    req.on('data', c => {
      n += c.length;
      if (n > limit) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      const s = Buffer.concat(chunks).toString('utf8');
      if (!s) return resolve({});
      try { resolve(JSON.parse(s)); } catch (e) { reject(new Error('body is not JSON')); }
    });
    req.on('error', reject);
  });
}

const routes = {
  'GET /api/health': async () => ({
    ok: true, version: require('../package.json').version,
    nos: NOS_ENABLED, image: nos.IMAGE, imageBuilt: await nos.imagePresent(),
    node: process.version, uptimeSec: Math.round(process.uptime()),
  }),
  'GET /api/nos/status': async () => ({ ok: true, devices: await nos.status() }),
  'POST /api/nos/build': async (body) => {
    const t = body && body.topology;
    if (!t || !Array.isArray(t.devices)) throw new Error('expected { topology: { devices: [], links: [] } }');
    return { ok: true, ...(await nos.buildLab(t)) };
  },
  'POST /api/nos/destroy': async () => ({ ok: true, ...(await nos.destroyLab()) }),
  'POST /api/nos/config': async (body) => {
    if (typeof body.idx !== 'number' || typeof body.config !== 'string') throw new Error('expected { idx, config }');
    const r = await nos.applyConfig(body.idx, body.config);
    return { ok: true, out: r.stdout };
  },
  'POST /api/nos/vtysh': async (body) => {
    if (typeof body.idx !== 'number' || typeof body.command !== 'string') throw new Error('expected { idx, command }');
    return { ok: true, out: await nos.vtysh(body.idx, body.command) };
  },
  'POST /api/nos/sh': async (body) => {
    if (typeof body.idx !== 'number' || typeof body.command !== 'string') throw new Error('expected { idx, command }');
    return { ok: true, out: await nos.sh(body.idx, body.command) };
  },
};

const server = http.createServer(async (req, res) => {
  const url = req.url || '/';
  const key = `${req.method} ${url.split('?')[0]}`;

  if (key.startsWith('GET /api/') || key.startsWith('POST /api/')) {
    const handler = routes[key];
    if (!handler) return send(res, 404, { ok: false, error: 'no such endpoint' });
    const needsNos = key.includes('/nos/') && key !== 'GET /api/nos/status';
    if (needsNos && !NOS_ENABLED) {
      return send(res, 403, { ok: false, error:
        'real-NOS control is disabled — start the server with NETMAP3D_NOS=1 (it spawns containers, which is root-equivalent on the host)' });
    }
    try {
      const body = req.method === 'POST' ? await readBody(req) : null;
      return send(res, 200, await handler(body));
    } catch (e) {
      return send(res, 500, { ok: false, error: e.message, detail: (e.stderr || '').slice(0, 4000) });
    }
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { ok: false, error: 'method not allowed' });
  const file = safePath(url);
  if (!file) return send(res, 403, { ok: false, error: 'forbidden' });
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, 'Not found', 'text/plain; charset=utf-8');
    res.writeHead(200, { 'content-type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'content-length': st.size, 'cache-control': 'no-store' });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`NetMap3D serving ${ROOT}`);
  console.log(`  http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  console.log(`  real NOS control: ${NOS_ENABLED ? 'ENABLED' : 'disabled (set NETMAP3D_NOS=1)'}`);
});
