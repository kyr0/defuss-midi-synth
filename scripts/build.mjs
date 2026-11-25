import { build } from 'esbuild';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
// The package build runs pkgroll between these phases so cleaning cannot delete its output.
if (process.argv.includes('--prepare')) {
  execFileSync(process.execPath, ['scripts/integrity.mjs'], { stdio: 'inherit' });
  await rm('dist', { recursive: true, force: true });
  await mkdir('dist/assets', { recursive: true });
  await cp('vendor/runtime/midi-synth.wasm', 'dist/assets/midi-synth.wasm');
  // The SoundFont ships Brotli-compressed (scripts/compress-banks.mjs); defuss-brotli's decoder unpacks it at load.
  await cp('vendor/soundfonts/TimGM6mb.sf2.br', 'dist/assets/TimGM6mb.sf2.br');
  await cp('node_modules/defuss-brotli/dist/decompressor.wasm', 'dist/assets/brotli-decompressor.wasm');
  await writeFile('dist/assets/brotli-decompressor.LICENSE.txt', `brotli-decompressor.wasm is the decoder of defuss-brotli 0.4.0.\n\n${(await readFile('node_modules/defuss-brotli/LICENSE', 'utf8')).trim()}\n\n${await readFile('node_modules/defuss-brotli/THIRD_PARTY_NOTICES.txt', 'utf8')}`);
  await cp('vendor/runtime/fm-synth.wasm', 'dist/assets/fm-synth.wasm');
  // Only public WASM/notice artifacts are installed. ROM packs are separately user-provided.
  const { readdir } = await import('node:fs/promises');
  const profileDir = 'vendor/runtime/profiles';
  const profiles = await readdir(profileDir).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
  if (profiles.length) await mkdir('dist/assets/profiles', { recursive: true });
  for (const file of profiles) if (/^(sb16-cqm|sb-pci128|gus-gf1|roland-sc55|roland-sc55mk2|roland-mt32)\.(wasm|LICENSE\.txt)$/.test(file)) await cp(`${profileDir}/${file}`, `dist/assets/profiles/${file}`);
  // Each served asset keeps its licence beside it, so copying dist/ to a static host carries the notices along.
  const tsf = await readFile('native/tsf.h', 'utf8');
  const notice = tsf.slice(tsf.indexOf('LICENSE (MIT)'), tsf.indexOf('*/'));
  await writeFile('dist/assets/midi-synth.LICENSE.txt', `midi-synth.wasm is built from native/synth.c and TinySoundFont (native/tsf.h).\n\n${notice.trim()}\n`);
  const adlmidi = path => readFile(`native/adlmidi/${path}`, 'utf8');
  await writeFile('dist/assets/fm-synth.LICENSE.txt', [
    'fm-synth.wasm is built from native/fm.cpp and libADLMIDI 1.6.2 (native/adlmidi), Copyright (c) 2010-2014 Joel Yliluoma',
    'and (c) 2015-2026 Vitaly Novichkov: the synthesizer under the GNU General Public License 3.0 or later; its OPL3 chip',
    'emulator Nuked OPL3 fast (Copyright (C) 2013-2020 Nuke.YKT, (C) 2026 Tony Gies) and the chip interface under the GNU',
    'Lesser General Public License 2.1 or later; the volume models, the bank database reader and the WOPL reader under the',
    'MIT license. defuss-midi-synth changed the copies (native/ARCH.md). The licence texts follow.',
    '', '== MIT (volume models) ==', (await adlmidi('src/models/LICENSE.txt')).trim(),
    '', '== MIT (file reader, databank) ==', (await adlmidi('src/midiseq/LICENSE.txt')).trim(),
    '', '== GNU Lesser General Public License 2.1 ==', (await adlmidi('LICENSE.LGPL-2.1.txt')).trim(),
    '', '== GNU General Public License 3.0 ==', (await adlmidi('LICENSE.GPL-3.txt')).trim(), ''].join('\n'));
  await writeFile('dist/assets/TimGM6mb.LICENSE.txt', `${(await readFile('vendor/soundfonts/TimGM6mb.copyright', 'utf8')).trim()}\n\n${await readFile('vendor/soundfonts/LICENSE.GPL-2.0.txt', 'utf8')}`);
} else if (process.argv.includes('--finish')) {
  await build({ entryPoints: ['src/worklet.ts'], outfile: 'dist/worklet.js', format: 'esm', bundle: true, target: 'es2022', sourcemap: true });
  await rm('docs/synth', { recursive: true, force: true });
  await cp('dist', 'docs/synth', { recursive: true });
  await cp('README.md', 'docs/llms.txt');
  await cp('LICENSE', 'docs/LICENSE.txt');
  // The demo page's components: defuss-shadcn's runtime and the stylesheets of the components it uses, without their
  // source map comments (the maps stay in node_modules), and its licence and notice beside them.
  const shadcn = 'node_modules/defuss-shadcn/dist/components';
  await rm('docs/shadcn', { recursive: true, force: true });
  await mkdir('docs/shadcn', { recursive: true });
  for (const file of ['core.min.css', 'core.min.js', 'shaders.min.css', 'shaders.min.js', 'button/button.min.css', 'slider/slider.min.css',
    'slider/slider.min.js', 'select/select.min.css', 'toggle/toggle.min.css', 'toggle-group/toggle-group.min.css', 'audio/audio.min.css', 'playlist-item/playlist-item.min.css', 'progress/progress.min.css',
    'site-header/site-header.min.css', 'site-footer/site-footer.min.css', 'navigation-menu/navigation-menu.min.css']) {
    const text = (await readFile(`${shadcn}/${file}`, 'utf8')).replace(/\n?\/[*/]# sourceMappingURL=\S+( \*\/)?\s*$/, '\n');
    await writeFile(`docs/shadcn/${file.split('/').pop()}`, text);
  }
  // The visualizer: bergium (vendor/bergium) behind demo/visualizer.ts, its GLSL imported as text, the page's Milkdrop
  // presets, and the licences of all three sources.
  await rm('docs/visualizer', { recursive: true, force: true });
  await build({
    entryPoints: ['demo/visualizer.ts'], outdir: 'docs/visualizer', format: 'esm', bundle: true, splitting: true, minify: true,
    target: 'es2022', legalComments: 'none', chunkNames: '[name]-[hash]',
    plugins: [{ name: 'glsl-raw', setup(b) {
      b.onResolve({ filter: /\.glsl\?raw$/ }, args => ({ path: resolve(args.resolveDir, args.path.slice(0, -4)), namespace: 'glsl' }));
      b.onLoad({ filter: /.*/, namespace: 'glsl' }, async args => ({ contents: await readFile(args.path, 'utf8'), loader: 'text' }));
    } }],
  });
  // The Milkdrop presets the page rotates through (demo/bergium-presets.json, chosen by the human on 2026-11-24), taken
  // from butterchurn-presets' base pack into one small file instead of the whole 646 KB pack.
  const pack = createRequire(import.meta.url)('butterchurn-presets/lib/butterchurnPresets.min.js');
  const presets = (pack.default ?? pack).getPresets();
  const chosen = JSON.parse(await readFile('demo/bergium-presets.json', 'utf8')).map(name => {
    if (!presets[name]) throw new Error(`butterchurn-presets has no preset ${name}`);
    return { name, preset: presets[name] };
  });
  await writeFile('docs/visualizer/presets.json', JSON.stringify(chosen));
  // bergium's LICENSE names the MIT licence without its text; the text is the one of Butterchurn's MIT licence.
  const butterchurn = await readFile('vendor/bergium/LICENSE.butterchurn.txt', 'utf8');
  const mit = butterchurn.slice(butterchurn.indexOf('Permission is hereby granted')).trim();
  await writeFile('docs/visualizer/LICENSES.txt', [
    'visualizer.js bundles bergium (https://github.com/kyr0/bergium, commit a8c646f8, vendor/bergium); presets.json holds presets of',
    'butterchurn-presets 2.4.7. bergium is MIT; its Milkdrop pipeline derives from Butterchurn (MIT), its Geiss pipeline from Geiss',
    '(BSD-3-Clause). No endorsement by Ryan Geiss or Jordan Berg is implied.', '',
    '== bergium ==', (await readFile('vendor/bergium/LICENSE', 'utf8')).trim(), '', mit, '',
    '== Butterchurn ==', (await readFile('vendor/bergium/LICENSE.butterchurn.txt', 'utf8')).trim(), '',
    '== Geiss ==', (await readFile('vendor/bergium/LICENSE.geiss.txt', 'utf8')).trim(), '',
    '== butterchurn-presets ==', (await readFile('node_modules/butterchurn-presets/LICENSE', 'utf8')).trim(), ''].join('\n'));
  await writeFile('docs/shadcn/LICENSE.txt', `${(await readFile('node_modules/defuss-shadcn/LICENSE', 'utf8')).trim()}\n\n${await readFile(`${shadcn}/NOTICE.txt`, 'utf8')}`);
  console.log('Built library, worklet, declarations and self-contained browser assets');
} else throw new Error('Use --prepare or --finish; bun run build runs both phases');
