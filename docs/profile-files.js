// Decode the player cards’ instrument packs and ECW wavesets.
const AWE = ['awe32', 'awe64'];
/** The largest file the page reads: src/profile-voices.ts MAX_PROFILE_ASSET_BYTES, the largest pack a core takes. */
export const MAX_FILE_BYTES = 128 * 1024 * 1024;
const ascii = (bytes, at, text) => [...text].every((c, i) => bytes[at + i] === c.charCodeAt(0));
const hex = buffer => [...new Uint8Array(buffer)].map(b => b.toString(16).padStart(2, '0')).join('');
/** A DSPK v1 pack (native/profiles/profile_pack.h): magic, version 1, model, record count, then role, length and bytes
 *  of each record in role order, as scripts/profile-assets.py writes it. */
export function dspack(model, records) {
  const sorted = [...records].sort((a, b) => a[0] - b[0]);
  const out = new Uint8Array(16 + sorted.reduce((n, [, data]) => n + 8 + data.length, 0)), view = new DataView(out.buffer);
  out.set([0x44, 0x53, 0x50, 0x4b]); view.setUint32(4, 1, true); view.setUint32(8, model, true); view.setUint32(12, sorted.length, true);
  let at = 16;
  for (const [role, data] of sorted) { view.setUint32(at, role, true); view.setUint32(at + 4, data.length, true); out.set(data, at + 8); at += 8 + data.length; }
  return out;
}

/** The picked files ({ name, bytes }) of a FileList; a file over MAX_FILE_BYTES is an Error before anything is read. */
export async function readFiles(list) {
  const big = [...list].find(f => f.size > MAX_FILE_BYTES);
  if (big) throw new Error(`${big.name} is larger than any pack a core takes (${MAX_FILE_BYTES / 1048576} MiB)`);
  return Promise.all([...list].map(async f => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) })));
}

const hexDigest = async (algorithm, bytes) => hex(await crypto.subtle.digest(algorithm, bytes));
/** A pack's records by role, or undefined when its header and records do not cover it. */
function records(pack) {
  const view = new DataView(pack.buffer, pack.byteOffset, pack.byteLength), out = new Map();
  let at = 16;
  for (let i = view.getUint32(12, true); i > 0; i--) {
    if (at + 8 > pack.length) return undefined;
    const role = view.getUint32(at, true), n = view.getUint32(at + 4, true);
    if (at + 8 + n > pack.length) return undefined;
    out.set(role, pack.subarray(at + 8, at + 8 + n)); at += 8 + n;
  }
  return at === pack.length ? out : undefined;
}
/** The name an SBK or SF2 bank gives itself (its INFO list's INAM), or undefined. */
function bankName(bank) {
  if (!bank || bank.length < 24 || !ascii(bank, 0, 'RIFF') || !ascii(bank, 8, 'sfbk') || !ascii(bank, 12, 'LIST') || !ascii(bank, 20, 'INFO')) return undefined;
  const view = new DataView(bank.buffer, bank.byteOffset, bank.byteLength), end = Math.min(bank.length, 20 + view.getUint32(16, true));
  for (let at = 24; at + 8 <= end; at += 8 + view.getUint32(at + 4, true) + (view.getUint32(at + 4, true) & 1)) {
    if (!ascii(bank, at, 'INAM')) continue;
    const name = String.fromCharCode(...bank.subarray(at + 8, Math.min(end, at + 8 + view.getUint32(at + 4, true)))).split('\0')[0].trim();
    return /^[\x20-\x7e]+$/.test(name) ? name : undefined;
  }
  return undefined;
}
/** A device's name and year from an entry of packs.json or devices.json ({ manufacturer, model, year }):
 *  "<manufacturer> <model>[, <variant>] (<year>)", the variant without the model's name in front; without an entry, "<label> · <variant>". */
export function deviceName(entry, variant, label) {
  if (!entry?.model) return { name: variant ? `${label} · ${variant}` : label, year: 0 };
  const rest = variant?.startsWith(`${entry.model} `) ? variant.slice(entry.model.length + 1) : variant;
  return { name: `${`${entry.manufacturer ?? ''} ${entry.model}`.trim()}${rest ? `, ${rest}` : ''}${entry.year ? ` (${entry.year})` : ''}`, year: Number(entry.year) || 0 };
}
/** The order of the devices list: the newest release first, then by name; a device without a year last. */
export const byYear = (a, b) => (b.year || 0) - (a.year || 0) || a.name.localeCompare(b.name, 'en', { numeric: true });
/** A file's name without its extension, and without the profile's name in front (fetch-roms.py names its packs
 *  <profile>--<set>.dspack, fetch-gus gus-gf1-<memory>k.dspack). */
const variantOf = (kind, name) => name.replace(/\.[^.]*$/, '').replace(new RegExp(`^${kind}-+`, 'i'), '') || name;

export async function devicesIn(files, descriptors, catalog = {}, profiles = {}) {
  const kinds = Object.fromEntries(Object.entries(descriptors).map(([kind, d]) => [d.id, kind]));
  const devices = new Map(), ignored = [], modules = {};
  const entries = new Map(Object.entries(catalog).map(([file, entry]) => [file.toLowerCase(), entry]));
  const add = async (kind, variant, assets, file) => {
    const hash = await hexDigest('SHA-256', assets), key = `${kind}:${hash}`, had = devices.get(key), entry = file && entries.get(file.name.toLowerCase());
    const fileHash = entry?.sha256 && (file.bytes === assets ? hash : await hexDigest('SHA-256', file.bytes));
    const named = Boolean(entry?.model) && (!entry.sha256 || entry.sha256.toLowerCase() === fileHash);
    const { name, year } = named ? deviceName(entry) : deviceName(profiles[kind], variant, descriptors[kind].label);
    if (!had || (named && !had.named) || (named === had.named && name.length < had.name.length)) devices.set(key, { kind, variant, key, assets, name, named, year });
  };
  for (const file of files) {
    const { bytes } = file;
    if (ascii(bytes, 0, '\0asm')) {
      const kind = AWE.find(k => file.name.toLowerCase().includes(k));
      if (kind) modules[kind] = bytes; else ignored.push(file.name);
    } else if (bytes.length >= 16 && ascii(bytes, 0, 'DSPK')) {
      const kind = kinds[new DataView(bytes.buffer, bytes.byteOffset, 16).getUint32(8, true)];
      if (!kind || !records(bytes)) { ignored.push(file.name); continue; }
      // An AWE pack by its bank's own name, and whether it carries the wave ROM.
      const recs = AWE.includes(kind) ? records(bytes) : undefined, bank = bankName(recs?.get(32));
      await add(kind, bank ? `${bank}${recs.has(3) ? ' + ROM' : ''}` : variantOf(kind, file.name), bytes, file);
    } else if (ascii(bytes, 0, 'ECLW') && bytes.length > 0xb0) {
      const name = String.fromCharCode(...bytes.subarray(0x60, 0xb0)).split('\0')[0].trim();
      await add('sb-pci128', /^[\x20-\x7e]+$/.test(name) ? name : variantOf('sb-pci128', file.name), dspack(descriptors['sb-pci128'].id, [[32, bytes]]), file);
    } else ignored.push(file.name);
  }
  const list = [...devices.values()].map(({ kind, variant, key, assets, name, year }) => {
    const device = { kind, variant, key, name, year, sources: { assets } };
    if (AWE.includes(kind)) { if (modules[kind]) device.sources.wasm = modules[kind]; else device.needs = `${kind}.wasm`; }
    return device;
  });
  return { devices: list.sort(byYear), ignored, modules };
}
