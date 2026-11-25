import { createServer } from 'node:http';
import { stat, readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
/** The files of this machine that the page may use but no public copy of the site holds: the AWE cores, which build
 *  only locally (scripts/build-native-profiles.py --local-awe), and the Sound Blaster 128 SoundFont, E-mu's 2GMGSMT
 *  bank (copyright E-mu Systems). Each is served by its name under /local/ from its path here. */
export const LOCAL_FILES = {
  'awe32.wasm': 'profile-assets/local-builds/awe32.wasm',
  'awe64.wasm': 'profile-assets/local-builds/awe64.wasm',
  'pci128.sf2': 'profile-assets/pci128.sf2',
};
/** Serves root on 127.0.0.1. With local, a map of names to files of this machine (LOCAL_FILES or part of it), it also
 *  serves each file that exists under /local/<name>, and /local/index.json lists those names, so the page uses them
 *  without asking for them. They never go into docs/: GitHub Pages serves docs/ as it is tracked, and none of them may
 *  be distributed. */
export function serve(root, port = 0, { local = {} } = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new RangeError('PORT must be an integer from 0 to 65535');
  root = resolve(root);
  const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.json': 'application/json', '.mid': 'audio/midi', '.txt': 'text/plain', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.sf2': 'audio/x-soundfont' };
  const files = new Map(Object.entries(local).map(([name, file]) => [name, resolve(file)]));
  const exists = file => stat(file).then(s => s.isFile(), () => false);
  const localFile = async path => {
    if (path === '/local/index.json') {
      const names = [];
      for (const [name, file] of files) if (await exists(file)) names.push(name);
      return [JSON.stringify(names.sort()), '.json'];
    }
    const file = files.get(path.slice('/local/'.length));
    if (!file) throw new Error('not a local file');
    return [await readFile(file), extname(file)];
  };
  const server = createServer(async (req, res) => {
    try {
      const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      if (files.size && path.startsWith('/local/')) {
        const [data, ext] = await localFile(path);
        res.writeHead(200, { 'Content-Type': mime[ext] ?? 'application/octet-stream', 'Cache-Control': 'no-store' }); res.end(data); return;
      }
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
  const server = await serve('docs', Number(process.env.PORT ?? 8080), { local: LOCAL_FILES });
  console.log(`${new Date().toISOString()} INFO listening url=http://127.0.0.1:${server.address().port}`);
  process.on('SIGTERM', () => server.close());
}
