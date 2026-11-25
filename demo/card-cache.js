// The gallery stores the exact source bytes, including ECW files before DSPK wrapping.
import { createDirectoryStorage } from 'defuss-storage/directory';
import { readBytes } from '../src/assets.ts';

let directory;
async function openCache() {
  const root = await navigator.storage.getDirectory();
  const parent = await root.getDirectoryHandle('defuss-storage', { create: true });
  return createDirectoryStorage(await parent.getDirectoryHandle('midi-sound-cards', { create: true }));
}
async function matches(data, hash) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  return Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('') === hash;
}
async function withFile(store, name, options, action) {
  const file = await store.open(name, options);
  try { return await action(file); } finally { await file.close(); }
}
export async function cardFile(url, hash, progress, warn) {
  if (!hash) throw new Error(`Missing catalog hash for ${url.pathname}`);
  const name = url.pathname.split('/').pop();
  const key = name.toLowerCase();
  const load = async () => {
    directory ??= openCache().catch(() => undefined);
    const store = await directory;
    if (store) {
      try {
        const saved = await withFile(store, key, { readOnly: true }, async file => file.readExactly(0, await file.size()));
        if (await matches(saved, hash)) return saved;
      } catch (error) { if (error.code !== 'NOT_FOUND') warn(error.message); }
    }
    const report = event => progress({ ...event, card: true });
    report({ phase: 'download', url: url.href, loaded: 0, total: 0 });
    try {
      const bytes = await readBytes(url, 120000, report);
      if (!await matches(bytes, hash)) throw new Error(`${name} differs from its catalog checksum.`);
      if (store) {
        try {
          await withFile(store, key, { create: true }, async file => {
            await file.write(0, bytes);
            await file.truncate(bytes.length);
            await file.flush();
          });
        } catch (error) { warn(error.message); }
      } else warn('Browser storage is unavailable.');
      return bytes;
    } finally { progress({ phase: 'finish', url: url.href }); }
  };
  return navigator.locks ? navigator.locks.request(`midi-sound-card:${key}`, load) : load();
}

export const coreHashes = CARD_CORE_HASHES;
