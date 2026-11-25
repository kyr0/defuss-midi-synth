/** Regression for a verified defect: the overlay decoded the ECW sample tuning as "coarse byte - 128" semitones plus a
 * signed fine byte around key 60, which played the original wavesets about 63 semitones sharp (aliasing noise; see
 * scripts/profile-ecw-test.mjs, which measures EAPCI2M/4M/8M). Bytes 2..3 of a sample header are one little-endian
 * int16 in 1/256 semitone. Synthetic fixture: a 64-frame sine loop. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {dspack, ecwFixture} from './vintage-fixtures.ts';
const module = new WebAssembly.Module(readFileSync(new URL('../vendor/runtime/profiles/sb-pci128.wasm', import.meta.url)));
/** Frequency in Hz at the core's 22,050 Hz rate, from rising zero crossings over frames 4096..22050. */
function frequency(tune: number, key: number): number {
  const e = new WebAssembly.Instance(module).exports as any, pack = dspack(5, [[32, ecwFixture(tune)]]);
  const at = e.profile_buffer(pack.length); new Uint8Array(e.memory.buffer, at, pack.length).set(pack);
  assert.equal(e.profile_init(pack.length), 1);
  try {
    assert.equal(e.profile_message(0x90, key, 100), 1);
    const x: number[] = [];
    for (let i = 0; i < 22050; i += 126) { const p = e.profile_render(126); x.push(...new Float32Array(e.memory.buffer, p, 126)); }
    let first = -1, last = -1, n = 0;
    for (let i = 4097; i < x.length; i++) if (x[i - 1] < 0 && x[i] >= 0) { if (first < 0) first = i; else n++; last = i; }
    return (22050 * n) / (last - first);
  } finally { e.profile_close(); }
}
test('ECW sample tuning word: little-endian int16 in 1/256 semitone, applied on top of the key', () => {
  const base = frequency(-16689, 60); // 0xBECF: its low byte reads as a negative fine tune in the old decode
  assert(Math.abs(base / (22050 / 64) - 1) < 2e-3, `${base} Hz`);
  const shifted = frequency(-16689 + 868, 60); // 0xC233: +868/256 semitone
  assert(Math.abs(shifted / base / 2 ** (868 / 256 / 12) - 1) < 2e-3, `${shifted} Hz`);
  assert(Math.abs(frequency(-16689, 72) / base / 2 - 1) < 2e-3, 'key 72 is one octave above key 60');
});
