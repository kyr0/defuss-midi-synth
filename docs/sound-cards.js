import loudness from './card-loudness.json' with { type: 'json' };
import { cardFile, coreHashes } from './card-cache.js';
import { PROFILE_DESCRIPTORS } from './synth/index.js';
import { byYear, dspack } from './profile-files.js';

const base = new URL('./soundcards/', import.meta.url);
function baseTrimDb(id) {
  const value = loudness.baseTrimDb?.[id];
  if (!Number.isFinite(value)) throw new Error(`card-loudness.json: baseTrimDb.${id} must be a number`);
  return value;
}
export const pciSoundFontLabel = '2 MB SF';
const ecwVariant = size => ({ label: `${size} MB ECW`, kind: 'sb-pci128', file: `sb128_EAPCI${size}M.ECW` });
// Gain trims in dB, measured against SB16 OPL3 with scripts/measure-card-levels.mjs.
export const cards = [
  { id: 'sb128', name: 'SoundBlaster 128', variants: [
    ecwVariant(2),
    { label: pciSoundFontLabel, kind: 'soundfont', file: 'pci128.sf2', hidden: true },
    ecwVariant(4),
    ecwVariant(8),
  ] },
  { id: 'sb16', name: 'SoundBlaster 16', variants: [
    { label: 'Yamaha OPL3', kind: 'sb16-opl3' }, { label: 'Creative CQM', kind: 'sb16-cqm' },
  ] },
  ...[64, 32].map(model => ({ id: `awe${model}`, name: `SoundBlaster AWE ${model}`,
    variants: [{ kind: `awe${model}`, wasm: `awe${model}.wasm`, file: `awe${model}--emu8000-gm-rom-synthgs.dspack` }] })),
  { id: 'ultrasound', name: 'Gravis Ultrasound', variants: [{ kind: 'gus-gf1', file: 'gus-gf1-1024k.dspack' }] },
].map(card => ({
  ...card,
  variants: card.variants.map(variant => ({
    ...variant, trimDb: baseTrimDb(variant.file ?? variant.kind),
  })),
}));

async function json(file) {
  const response = await fetch(new URL(file, import.meta.url));
  if (!response.ok) throw new Error(`${file}: HTTP ${response.status}`);
  return response.json();
}
const galleryPriority = { sb128: 0, sb16: 1 };
export async function soundCards() {
  const [packs, devices] = await Promise.all([json('packs.json'), json('devices.json')]);
  return cards.map(card => {
    const variants = card.variants.filter(v => !v.hidden).map(v => {
      const entry = v.file ? packs[v.file.replace(/^sb128_/, '')] : devices[v.kind];
      return { ...v, year: Number(entry.year), hash: entry.sha256 };
    });
    return { ...card, cover: new URL(`${card.id}.webp`, base), variants, year: variants[0].year };
  }).sort((a, b) => (galleryPriority[a.id] ?? 2) - (galleryPriority[b.id] ?? 2) || byYear(a, b));
}
export function coreReader(progress, warn) {
  return url => cardFile(url, coreHashes[url.pathname.split('/').pop()], progress, warn);
}
export async function cardSources(variant, progress, warn) {
  const { file, hash } = variant;
  if (!file) return;
  const bytes = await cardFile(new URL(file, base), hash, progress, warn);
  return variantSources(variant, bytes);
}
export function variantSources({ kind, wasm }, bytes) {
  if (kind === 'soundfont') return { soundfont: bytes };
  const assets = kind === 'sb-pci128' ? dspack(PROFILE_DESCRIPTORS[kind].id, [[32, bytes]]) : bytes;
  return wasm ? { assets, wasm: new URL(wasm, base) } : { assets };
}
