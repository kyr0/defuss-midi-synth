// VGM waits count 44.1 kHz samples. Render the OPL at its native clock and let the browser resample the WAV.
export function renderOpl(bytes, core, onProgress) {
  const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const word = offset => header.getUint32(offset, true);
  if (word(0) !== 0x206d6756) throw new Error('Invalid VGM header');
  const start = word(0x34) ? 0x34 + word(0x34) : 0x40;
  const opl3 = start >= 0x60 && word(0x5c);
  const clock = opl3 || word(0x50) || word(0x54);
  const dual = Boolean(clock & 0x40000000);
  const rate = Math.round((clock & 0x3fffffff) / (opl3 ? 288 : 72));
  const frames = Math.round(word(24) * rate / 44100);
  if (!rate || !frames) throw new Error('Missing OPL clock or recording length');
  const buffer = new ArrayBuffer(44 + frames * 4);
  const wav = new DataView(buffer);
  const tag = (offset, value) => [...value].forEach((c, i) => wav.setUint8(offset + i, c.charCodeAt(0)));
  tag(0, 'RIFF'); wav.setUint32(4, buffer.byteLength - 8, true); tag(8, 'WAVE'); tag(12, 'fmt ');
  wav.setUint32(16, 16, true); wav.setUint16(20, 1, true); wav.setUint16(22, 2, true);
  wav.setUint32(24, rate, true); wav.setUint32(28, rate * 4, true);
  wav.setUint16(32, 4, true); wav.setUint16(34, 16, true); tag(36, 'data'); wav.setUint32(40, frames * 4, true);
  const pcm = new Int16Array(buffer, 44), memory = new Int16Array(core.memory.buffer);
  core.vgm_reset(dual);
  let ticks = 0, written = 0, nextReport = 0;
  for (let i = start; i < bytes.length;) {
    const op = bytes[i++];
    if (op === 0x66) {
      // A short silent tail is included in the header length of some recordings.
      return buffer;
    }
    if ([0x5a, 0x5b, 0x5e, 0x5f, 0xaa].includes(op)) {
      const reg = bytes[i++] + (op === 0x5f ? 256 : 0);
      core.vgm_write(Number(op === 0xaa), reg, bytes[i++]);
      continue;
    }
    if (op === 0x61) { ticks += header.getUint16(i, true); i += 2; }
    else if (op === 0x62) ticks += 735;
    else if (op === 0x63) ticks += 882;
    else if (op >= 0x70 && op <= 0x7f) ticks += op - 0x6f;
    else throw new Error(`Unsupported VGM command 0x${op.toString(16)}`);
    const end = Math.min(frames, Math.round(ticks * rate / 44100));
    while (written < end) {
      const n = Math.min(1024, end - written), offset = core.vgm_render(n, dual) / 2;
      pcm.set(memory.subarray(offset, offset + n * 2), written * 2);
      written += n;
    }
    if (written >= nextReport) { onProgress(written, frames); nextReport = written + rate * 4; }
  }
  throw new Error('Missing VGM end command');
}
