/* A store of a user's profile files on a defuss-storage adapter: the DSPK pack of their ROMs, wavesets or patches, and
 * a profile's module where it builds only locally (AWE). In a browser openProfileStore keeps them in the origin private
 * file system (OPFS), so a page plays them again in a later session without asking for the files, and nothing leaves
 * the device. VERIFIED: the human asked for OPFS through defuss-storage (2026-11-25). The store takes any defuss-storage
 * adapter rather than OPFS alone, so the same code runs on memory, Node files and OPFS, and its tests run on real files
 * in Node (tests/profile-store.test.ts). Each profile has up to two files, <profile>.dspack and <profile>.wasm. */
import { isNativeProfile, type NativeProfile } from './profiles.ts';
import { MAX_PROFILE_ASSET_BYTES } from './profile-voices.ts';

/** The parts of a defuss-storage file handle the store uses; any adapter's StorageFile has them. */
export interface ProfileStorageFile {
  readonly maxReadBytes: number;
  size(): Promise<number>;
  readInto(offset: number, target: Uint8Array): Promise<number>;
  write(offset: number, data: Uint8Array): Promise<void>;
  truncate(size: number): Promise<void>;
  flush(): Promise<void>;
  close(): Promise<void>;
}
/** The parts of a defuss-storage adapter the store uses: MemoryStorage, createFileStorage (Node), createOPFSStorage
 *  (a dedicated worker) and createDirectoryStorage each fit. */
export interface ProfileStorage {
  open(name: string, options?: { create?: boolean; readOnly?: boolean }): Promise<ProfileStorageFile>;
  list(): Promise<string[]>;
  remove(name: string): Promise<boolean>;
}
/** A profile's stored files: its pack (assets) and its module (wasm), as profileSources takes them. */
export interface StoredProfileSources { assets?: Uint8Array; wasm?: Uint8Array }
export interface ProfileStore {
  /** Stores profile's pack, module or both; a part not given keeps what was stored. Rejects with the adapter's error
   *  (QUOTA_EXCEEDED, UNSUPPORTED where a browser cannot write OPFS files from this thread). */
  save(profile: NativeProfile, sources: { assets?: Uint8Array | ArrayBuffer; wasm?: Uint8Array | ArrayBuffer }): Promise<void>;
  /** profile's stored files, or undefined when none is stored. A pack whose records do not add up to its size, or a
   *  module WebAssembly.validate refuses, the trace of a save that stopped partway, counts as not stored. */
  load(profile: NativeProfile): Promise<StoredProfileSources | undefined>;
  /** The profiles with a stored file. */
  profiles(): Promise<NativeProfile[]>;
  /** Removes profile's files; resolves whether there were any. */
  remove(profile: NativeProfile): Promise<boolean>;
}

const PARTS = [['assets', 'dspack'], ['wasm', 'wasm']] as const;
/** The largest write sent at once: defuss-storage's default maxWriteBytes, one at a time. The directory adapter commits
 *  a copy of the whole file per write, so fewer writes save faster. VERIFIED (review probe, Chromium, 2026-11-25): with
 *  8 MiB writes, the size used then, a 120 MiB pack saved in 1,567 ms; UNKNOWN: the time with 64 MiB writes. An adapter
 *  with a lower limit refuses a write with RangeError before it changes anything, and the store halves the write and
 *  tries again, down to 64 KiB. */
const WRITE_CHUNK = 64 * 1024 * 1024, MIN_WRITE = 64 * 1024;
const fileName = (profile: NativeProfile, ext: string) => `${profile}.${ext}`;
const notFound = (error: unknown) => (error as { code?: unknown } | null)?.code === 'NOT_FOUND';
const bytes = (data: Uint8Array | ArrayBuffer) => data instanceof Uint8Array ? data : new Uint8Array(data);
function checkProfile(profile: unknown): asserts profile is NativeProfile {
  if (!isNativeProfile(profile)) throw new RangeError(`The profile store holds native profiles' files, not ${String(profile)}`);
}
/** Whether data is a whole DSPK pack (native/profiles/profile_pack.h): its header and records cover it exactly. */
function wholePack(data: Uint8Array): boolean {
  if (data.length < 16 || data[0] !== 0x44 || data[1] !== 0x53 || data[2] !== 0x50 || data[3] !== 0x4b) return false;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let at = 16;
  for (let i = view.getUint32(12, true); i > 0; i--) {
    if (at + 8 > data.length) return false;
    at += 8 + view.getUint32(at + 4, true);
  }
  return at === data.length;
}

async function withFile<T>(storage: ProfileStorage, name: string, options: { create?: boolean; readOnly?: boolean }, fn: (file: ProfileStorageFile) => Promise<T>): Promise<T> {
  const file = await storage.open(name, options);
  try { return await fn(file); } finally { await file.close(); }
}
async function readAll(file: ProfileStorageFile, name: string): Promise<Uint8Array> {
  const size = await file.size();
  if (size > MAX_PROFILE_ASSET_BYTES) throw new RangeError(`${name} is larger than any pack a core takes (${size} bytes)`);
  const data = new Uint8Array(size);
  for (let at = 0; at < size;) {
    const n = await file.readInto(at, data.subarray(at, Math.min(size, at + file.maxReadBytes)));
    if (n <= 0) throw new Error(`${name} ended at ${at} of ${size} bytes`);
    at += n;
  }
  return data;
}

/** A profile store on storage, a defuss-storage adapter (or anything with its open, list and remove). */
export function createProfileStore(storage: ProfileStorage): ProfileStore {
  return {
    async save(profile, sources) {
      checkProfile(profile);
      for (const [part, ext] of PARTS) {
        const given = sources[part];
        if (given === undefined) continue;
        const data = bytes(given);
        if (data.length > MAX_PROFILE_ASSET_BYTES) throw new RangeError(`The ${part} of ${profile} is larger than any core takes (${data.length} bytes)`);
        // The first write goes over the old bytes and the file is then cut to it, so a write the adapter refuses
        // outright leaves the stored copy as it was, and from then on the file is a prefix of the new one: a save that
        // stops partway leaves a pack whose records outrun it, which load counts as not stored.
        await withFile(storage, fileName(profile, ext), { create: true }, async file => {
          let chunk = WRITE_CHUNK;
          for (let at = 0; at < data.length;) {
            try { await file.write(at, data.subarray(at, at + chunk)); }
            catch (error) { if (!(error instanceof RangeError) || chunk <= MIN_WRITE) throw error; chunk /= 2; continue; }
            if (at === 0) await file.truncate(Math.min(chunk, data.length));
            at += chunk;
          }
          if (!data.length) await file.truncate(0);
          await file.flush();
        });
      }
    },
    async load(profile) {
      checkProfile(profile);
      const found: StoredProfileSources = {};
      for (const [part, ext] of PARTS) {
        const name = fileName(profile, ext);
        try {
          const data = await withFile(storage, name, { readOnly: true }, file => readAll(file, name));
          if (part === 'wasm' ? WebAssembly.validate(data as Uint8Array<ArrayBuffer>) : wholePack(data)) found[part] = data;
        } catch (error) { if (!notFound(error)) throw error; }
      }
      return found.assets || found.wasm ? found : undefined;
    },
    async profiles() {
      const kinds = new Set<NativeProfile>();
      for (const name of await storage.list()) {
        const match = /^(.+)\.(dspack|wasm)$/.exec(name);
        if (match && isNativeProfile(match[1])) kinds.add(match[1]);
      }
      return [...kinds].sort();
    },
    async remove(profile) {
      checkProfile(profile);
      let removed = false;
      for (const [, ext] of PARTS) removed = (await storage.remove(fileName(profile, ext))) || removed;
      return removed;
    },
  };
}

/** The profile store of this origin's private file system, in its directory defuss-storage/<name>: the directory that
 *  defuss-storage's createOPFSStorage({ name }) uses, so a dedicated worker with that adapter sees the same files. It
 *  goes through the directory adapter because the OPFS adapter needs a dedicated worker's sync access handles, and a
 *  page calls this on its main thread. The two adapters lock files under different names, so they do not exclude each
 *  other: use one of them for a store at a time. VERIFIED (review probe, Chromium 141, 2026-11-25): a page's load read
 *  a file a worker's OPFS adapter held open. Rejects outside a browser with OPFS. */
export async function openProfileStore(name = 'defuss-midi-synth'): Promise<ProfileStore> {
  const storage = (globalThis.navigator as { storage?: { getDirectory?: () => Promise<FileSystemDirectoryHandle> } } | undefined)?.storage;
  if (!storage?.getDirectory) throw new Error('openProfileStore needs a browser with the origin private file system; elsewhere use createProfileStore with a defuss-storage adapter');
  const { createDirectoryStorage } = await import('defuss-storage/directory');
  const root = await (await (await storage.getDirectory()).getDirectoryHandle('defuss-storage', { create: true })).getDirectoryHandle(name, { create: true });
  return createProfileStore(await createDirectoryStorage(root));
}
