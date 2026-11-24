// Fails when a built module imports more than src/voices.ts provides or lacks an export its backend calls.
import { readFile } from 'node:fs/promises';
const voices = await readFile(new URL('../src/voices.ts', import.meta.url), 'utf8');
for (const [file, prefix, iface] of [['midi-synth.wasm', 'synth_', 'SoundFontExports'], ['fm-synth.wasm', 'fm_', 'FmExports']]) {
  const module = new WebAssembly.Module(await readFile(new URL(`../vendor/runtime/${file}`, import.meta.url)));
  const imports = WebAssembly.Module.imports(module).map(i => `${i.module}.${i.name}`);
  const exports = new Set(WebAssembly.Module.exports(module).map(e => e.name));
  const block = voices.slice(voices.indexOf(`export interface ${iface}`), voices.indexOf('}', voices.indexOf(`export interface ${iface}`)));
  const called = [...block.matchAll(new RegExp(`^\\s+(${prefix}\\w+|memory)\\b`, 'gm'))].map(m => m[1]);
  const unknown = imports.filter(name => name !== 'env.emscripten_notify_memory_growth');
  const missing = called.filter(name => !exports.has(name));
  if (unknown.length || missing.length || called.length < 5) throw new Error(`${file}: unknown imports ${unknown}, missing exports ${missing}`);
  console.log(`${file}: ${exports.size} exports, imports ${imports.join(', ')}`);
}
