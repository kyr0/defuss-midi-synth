// Brotli-compresses every soundbank the package and the demo load: the bundled TimGM6mb SoundFont
// (vendor/soundfonts) and each SoundFont and WOPL bank under docs/ (not docs/synth, the build's copy). Each FILE gets
// FILE.br beside it at quality 11; a .br newer than its source is kept. The library decompresses them with
// defuss-brotli (src/assets.ts), so pages and the package ship the smaller files.
// Usage: node scripts/compress-banks.mjs [--force]
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { compressParallel, init } from 'defuss-brotli/compressor';

const force = process.argv.includes('--force');
const banks = /\.(sf2|sf3|wopl|woplx)$/i;
async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) { if (path !== 'docs/synth') yield* walk(path); }
    else if (banks.test(entry.name)) yield path;
  }
}
await init();
let before = 0, after = 0, written = 0;
for (const dir of ['vendor/soundfonts', 'docs']) {
  for await (const file of walk(dir)) {
    const source = await stat(file);
    const target = await stat(`${file}.br`).catch(() => null);
    before += source.size;
    if (!force && target && target.mtimeMs >= source.mtimeMs) { after += target.size; continue; }
    const start = performance.now();
    const packed = await compressParallel(await readFile(file), { quality: 11 });
    await writeFile(`${file}.br`, packed);
    after += packed.length; written++;
    if (source.size > 1e6) console.log(`${file}: ${source.size} -> ${packed.length} bytes (${(packed.length / source.size * 100).toFixed(1)}%) in ${((performance.now() - start) / 1000).toFixed(1)} s`);
  }
}
console.log(`${written} written; all banks ${before} -> ${after} bytes (${(after / before * 100).toFixed(1)}%)`);
