#!/usr/bin/env python3
"""Fetches the ROMs of the Roland and AWE profiles from sources you name, checks them against the known revisions in
scripts/roms/<profile>.json, and packs each complete set into profile-assets/<profile>.dspack.

This script names no ROM source: the dumps are copyrighted firmware, so you supply them, from your own hardware or a
source you are licensed to use. Write the sources into profile-assets/rom-sources.json (gitignored):

    python3 scripts/fetch-roms.py init          # writes the template with every file each profile needs
    # edit profile-assets/rom-sources.json: per file a URL (https://...), a local path, or
    #   {"url" or "path": ..., "member": "path inside a .zip"}
    python3 scripts/fetch-roms.py               # every profile with sources; or name profiles: roland-mt32 awe32

A file is accepted only when its size and SHA-256 (or SHA-1) match a known revision. Verified files land in
profile-assets/roms/<profile>/; nothing leaves profile-assets/, which git ignores and the package never ships.
"""
import argparse, hashlib, io, json, shutil, subprocess, sys, urllib.request, zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
KNOWN = ROOT / 'scripts/roms'
ASSETS = ROOT / 'profile-assets'
SOURCES = ASSETS / 'rom-sources.json'
LIMIT = 64 * 1024 * 1024  # the largest ROM set is a few MB; a larger answer is not a ROM


def known():
    out = {}
    for file in sorted(KNOWN.glob('*.json')):
        spec = json.loads(file.read_text())
        for s in spec['sets']:
            for f in s['files']:
                if not (f.get('sha256') or f.get('sha1')) or not isinstance(f.get('role'), int) or not f.get('size'):
                    raise SystemExit(f'{file}: {f.get("name")} needs role, size and a hash')
        out[spec['profile']] = spec
    if not out: raise SystemExit(f'No known ROM revisions in {KNOWN} yet: each profile adds its <profile>.json there.')
    return out


def init(specs):
    if SOURCES.exists(): raise SystemExit(f'{SOURCES} exists; edit it instead')
    template = {p: {f['name']: '' for s in spec['sets'] for f in s['files']} for p, spec in specs.items()}
    ASSETS.mkdir(exist_ok=True)
    SOURCES.write_text(json.dumps(template, indent=2) + '\n')
    for p, spec in specs.items():
        print(p + ':')
        for s in spec['sets']: print(f'  set "{s["name"]}": ' + ', '.join(f['name'] for f in s['files']))
    print(f'Wrote {SOURCES}: fill in a URL or path for the files of one set per profile, then run without "init".')


def read(source):
    spec = source if isinstance(source, dict) else ({'url': source} if '://' in source else {'path': source})
    if 'url' in spec:
        if not spec['url'].startswith('https://'): raise ValueError('only https:// URLs')
        request = urllib.request.Request(spec['url'], headers={'User-Agent': 'fetch-roms'})
        with urllib.request.urlopen(request, timeout=60) as response:
            data = response.read(LIMIT + 1)
    else:
        path = Path(spec['path']).expanduser()
        if path.stat().st_size > LIMIT: raise ValueError('larger than any ROM set')
        data = path.read_bytes()
    if len(data) > LIMIT: raise ValueError('larger than any ROM set')
    if spec.get('member'):
        with zipfile.ZipFile(io.BytesIO(data)) as z: data = z.read(spec['member'])
    return data


def matches(data, file):
    return len(data) == file['size'] and (
        (file.get('sha256') and hashlib.sha256(data).hexdigest() == file['sha256'].lower()) or
        (file.get('sha1') and hashlib.sha1(data).hexdigest() == file['sha1'].lower()))


def fetch(profile, spec, sources):
    dest = ASSETS / 'roms' / profile
    verified = {}
    for name, source in sources.items():
        if not source: continue
        try: data = read(source)
        except Exception as error:
            print(f'  {name}: FAILED to read ({error})'); continue
        candidates = [f for s in spec['sets'] for f in s['files'] if f['name'] == name]
        hit = next((f for f in candidates if matches(data, f)), None)
        if not hit:
            print(f'  {name}: REJECTED, {len(data)} bytes, sha256 {hashlib.sha256(data).hexdigest()} matches no known revision'); continue
        dest.mkdir(parents=True, exist_ok=True)
        (dest / name).write_bytes(data)
        verified[name] = hit
        print(f'  {name}: OK, revision {hit.get("revision", "?")}')
    complete = next((s for s in spec['sets'] if all(f['name'] in verified and matches((dest / f['name']).read_bytes(), f) for f in s['files'])), None)
    if not complete:
        print(f'  no complete set yet; needed: ' + ' | '.join(', '.join(f['name'] for f in s['files']) for s in spec['sets']))
        return False
    pack = ASSETS / f'{profile}.dspack'
    if profile in ('awe32', 'awe64'):
        # An AWE pack also needs the SBK or SF2 bank of your Creative drivers, which pack-awe checks and adds.
        rom = dest / complete['files'][0]['name']
        print(f'  ROM verified; pack it with your bank: python3 scripts/profile-assets.py pack-awe {profile} <your SYNTHGM.SBK> {pack} --rom {rom}')
        return True
    records = [f'{f["role"]}={dest / f["name"]}' for f in complete['files']]
    subprocess.run([sys.executable, str(ROOT / 'scripts/profile-assets.py'), 'pack', profile, str(pack), *records], check=True)
    print(f'  packed set "{complete["name"]}" into {pack}')
    return True


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('profiles', nargs='*', help='"init", or the profiles to fetch (default: every profile with sources)')
    args = parser.parse_args()
    specs = known()
    if args.profiles == ['init']: return init(specs)
    if not SOURCES.exists(): raise SystemExit(f'No {SOURCES}; run "python3 scripts/fetch-roms.py init" first')
    sources = json.loads(SOURCES.read_text())
    wanted = args.profiles or [p for p in specs if any(sources.get(p, {}).values())]
    if not wanted: raise SystemExit(f'{SOURCES} names no sources yet')
    ok = True
    for profile in wanted:
        if profile not in specs: raise SystemExit(f'Unknown profile {profile}; known: {", ".join(specs)}')
        print(profile + ':')
        ok = fetch(profile, specs[profile], sources.get(profile, {})) and ok
    sys.exit(0 if ok else 1)


if __name__ == '__main__': main()
