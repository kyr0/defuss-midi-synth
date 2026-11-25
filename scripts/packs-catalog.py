#!/usr/bin/env python3
"""Writes docs/packs.json, the names the demo page shows for the user's files: every .dspack and .ECW file in
profile-assets/ (or the directories given), by file name, to {"manufacturer", "year", "model", "sha256"}. The page
loads it and shows a dropped file found there as "<manufacturer> <model> (<year>)" when the file's bytes have that
SHA-256, so a default pack that now holds another revision is named by its content instead. It holds file names,
descriptions and hashes only.

An entry already in docs/packs.json is kept while its file still has its SHA-256, so a name edited by hand stays; a
changed or new file gets one from its
profile (the prefix the scripts give its name) and its variant: the ROM set of scripts/roms/<profile>.json whose
slug is in the name (fetch-roms.py), the memory of a fetch-gus pack, the bank of an AWE pack, the name in an ECW
waveset. The year is the device's release year.

    python3 scripts/packs-catalog.py [directory ...] [--fresh]   # --fresh: rebuild every entry
"""
import hashlib, json, re, struct, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'docs/packs.json'
# The device of each profile (manufacturer, model, release year): docs/devices.json, which the page reads too.
DEVICES = {p: (d['manufacturer'], d['model'], d['year']) for p, d in json.loads((ROOT / 'docs/devices.json').read_text()).items()
           if p not in ('sb16-opl3', 'sb16-cqm', 'soundfont')}


def records(pack):
    """A pack's records by role (native/profiles/profile_pack.h), or {} when it is no DSPK pack."""
    if pack[:4] != b'DSPK':
        return {}
    at, roles = 16, {}
    for _ in range(struct.unpack_from('<I', pack, 12)[0]):
        role, n = struct.unpack_from('<II', pack, at)
        roles[role] = pack[at + 8:at + 8 + n]
        at += 8 + n
    return roles


def rom_set(profile, pack):
    """The ROM set of scripts/roms/<profile>.json whose files a Roland pack holds, by role, size and SHA-1."""
    roles = records(pack)
    for s in json.loads((ROOT / f'scripts/roms/{profile}.json').read_text())['sets']:
        if len(s['files']) == len(roles) and all(f['role'] in roles and len(roles[f['role']]) == f['size']
                                                  and hashlib.sha1(roles[f['role']]).hexdigest() == f['sha1'] for f in s['files']):
            return s['name']
    return None


def bank_name(pack):
    """The INAM of an AWE pack's bank (role 32), and whether the pack carries the wave ROM (role 3)."""
    roles = records(pack)
    bank = roles.get(32, b'')
    if bank[:4] != b'RIFF' or bank[8:12] != b'sfbk' or bank[12:16] != b'LIST' or bank[20:24] != b'INFO':
        return None, 3 in roles
    end, at = 20 + struct.unpack_from('<I', bank, 16)[0], 24
    while at + 8 <= end:
        cid, n = bank[at:at + 4], struct.unpack_from('<I', bank, at + 4)[0]
        if cid == b'INAM':
            return bank[at + 8:at + 8 + n].split(b'\0')[0].decode('ascii', 'replace').strip(), 3 in roles
        at += 8 + n + (n & 1)
    return None, 3 in roles


def entry(path):
    name = path.name
    if name.upper().endswith('.ECW'):
        data = path.read_bytes()[:0xb0]
        waveset = data[0x60:0xb0].split(b'\0')[0].decode('ascii', 'replace').strip() if data[:4] == b'ECLW' else ''
        manufacturer, model, year = DEVICES['sb-pci128']
        return {'manufacturer': manufacturer, 'year': year, 'model': f'{model}, {waveset or path.stem}'}
    stem = path.stem
    profile = next((p for p in sorted(DEVICES, key=len, reverse=True) if stem == p or stem.startswith(p + '-')), None)
    if not profile:
        return {'manufacturer': '', 'year': '', 'model': ''}
    manufacturer, model, year = DEVICES[profile]
    variant = stem[len(profile):].lstrip('-')
    if profile.startswith('roland'):
        # The revision its ROMs are, whatever the file is called (fetch-roms.py's alias <profile>.dspack names none).
        chosen = rom_set(profile, path.read_bytes())
        if chosen:
            variant = re.sub(rf'^{re.escape(model)}\s*', '', chosen) or chosen
    elif profile == 'gus-gf1':
        m = re.fullmatch(r'(\d+)k((?:-[a-z0-9]+)*)', variant)
        if m:
            variant = f'{m[1]} KiB' + ''.join(f', {x}' for x in m[2].split('-')[1:]).replace('16bit', '16-bit')
    elif profile in ('awe32', 'awe64'):
        bank, rom = bank_name(path.read_bytes())
        if bank:
            variant = f'{bank} bank' + (' + ROM' if rom else '')
    return {'manufacturer': manufacturer, 'year': year, 'model': f'{model}, {variant}' if variant else model}


def main():
    dirs = [Path(a) for a in sys.argv[1:]] or [ROOT / 'profile-assets']
    catalog = json.loads(OUT.read_text()) if OUT.exists() and '--fresh' not in sys.argv else {}
    dirs = [d for d in dirs if str(d) != '--fresh'] or [ROOT / 'profile-assets']
    for directory in dirs:
        for path in sorted(directory.rglob('*')):
            if not path.is_file() or path.suffix.lower() not in ('.dspack', '.ecw'):
                continue
            digest = hashlib.sha256(path.read_bytes()).hexdigest()
            if catalog.get(path.name, {}).get('sha256') != digest:
                catalog[path.name] = {**entry(path), 'sha256': digest}
    OUT.write_text(json.dumps(dict(sorted(catalog.items(), key=lambda kv: kv[0].lower())), indent=2) + '\n')
    print(f'{OUT}: {len(catalog)} files')


if __name__ == '__main__':
    main()
