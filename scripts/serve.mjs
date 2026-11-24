import { createServer } from 'node:http';
import { stat, readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
export function serve(root, port = 0) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new RangeError('PORT must be an integer from 0 to 65535');
  root = resolve(root);
  const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.json': 'application/json', '.mid': 'audio/midi', '.txt': 'text/plain', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml' };
  const server = createServer(async (req, res) => {
    try {
      const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      let file = resolve(root, '.' + path);
      if (file !== root && !file.startsWith(root + '/')) { res.writeHead(403); res.end(); return; }
      if ((await stat(file)).isDirectory()) file = resolve(file, 'index.html');
      const data = await readFile(file);
      res.writeHead(200, { 'Content-Type': mime[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' }); res.end(data);
    } catch { res.writeHead(404); res.end('Not found'); }
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => { server.off('error', reject); resolve(server); });
  });
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const server = await serve('docs', Number(process.env.PORT ?? 8080));
  console.log(`${new Date().toISOString()} INFO listening url=http://127.0.0.1:${server.address().port}`);
  process.on('SIGTERM', () => server.close());
}
