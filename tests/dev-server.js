// Local test server: serves the app and answers /relay with the real Code.gs running on the Apps Script test double.
// node tests/dev-server.js  ->  http://localhost:8787
const http = require('http'), fs = require('fs'), path = require('path');
const { createRelay } = require('./mock-gas');
const ROOT = path.join(__dirname, '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

function start(port = 8787) {
  const relay = createRelay();
  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/relay')) {
      let body = ''; req.on('data', c => body += c);
      req.on('end', () => {
        let out;
        try { const j = JSON.parse(body); const action = j.action; delete j.action; out = relay.call(action, j); }
        catch (e) { out = { ok: false, error: 'bad_request', message: String(e) }; }
        res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(out));
      });
      return;
    }
    let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
    const f = path.join(ROOT, p);
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' }); res.end(fs.readFileSync(f));
  });
  return new Promise(r => server.listen(port, () => r({ server, relay })));
}
if (require.main === module) start().then(() => console.log('http://localhost:8787'));
module.exports = { start };
