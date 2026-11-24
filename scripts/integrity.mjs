import { readFile, writeFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
// The pinned inputs: the native sources, the prebuilt module built from them, the SoundFont and the bundled tool.
const files = [];
const list = async dir => {
  for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name < b.name ? -1 : 1)) {
    if (entry.isDirectory()) await list(`${dir}/${entry.name}`);
    else if (!entry.name.endsWith('.md') && entry.name !== '.DS_Store') files.push(`${dir}/${entry.name}`);
  }
};
for (const dir of ['native', 'vendor/runtime', 'vendor/soundfonts', 'vendor/sources']) await list(dir);
const hashes = {};
for (const file of files) hashes[file] = createHash('sha256').update(await readFile(file)).digest('hex');
if (process.argv.includes('--release')) {
  // Every file of the release folder, except dependencies, scratch, reports, runtime state and this list itself.
  const skip = new Set(['node_modules', 'tmp', 'output', 'var', '.DS_Store', 'RELEASE_SHA256.json']);
  const release = {};
  const walk = async dir => {
    for (const entry of (await readdir(dir || '.', { withFileTypes: true })).sort((a, b) => a.name < b.name ? -1 : 1)) {
      if (skip.has(entry.name)) continue;
      const path = dir ? `${dir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(path);
      else release[path] = createHash('sha256').update(await readFile(path)).digest('hex');
    }
  };
  await walk('');
  await writeFile('RELEASE_SHA256.json', JSON.stringify(release, null, 2) + '\n');
  console.log(`Hashed ${Object.keys(release).length} release files`);
} else if (process.argv.includes('--write')) await writeFile('vendor/SHA256SUMS.json', JSON.stringify(hashes, null, 2) + '\n');
else {
  const expected = JSON.parse(await readFile('vendor/SHA256SUMS.json', 'utf8'));
  if (JSON.stringify(expected) !== JSON.stringify(hashes)) throw new Error('Vendor integrity mismatch; inspect before accepting new artifacts (make wasm rewrites the hashes)');
  console.log(`Verified ${files.length} pinned vendor files`);
}
