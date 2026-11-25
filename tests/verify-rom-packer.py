#!/usr/bin/env python3
"""Exercise the installed real DSPK packer with all known revision sizes.

Every set of the public tables (scripts/roms/*.json) gets synthetic payloads of its sizes; the expected packs, counts
and default sets follow from those tables, so a revision added there is checked without editing this file. The run
uses an isolated temporary repository and no network.
"""
from pathlib import Path
import tempfile
import shutil
import json
import hashlib
import subprocess
import sys
import struct
import re

SRC = Path(__file__).resolve().parents[1]


def main():
    meta = {}
    for table in sorted((SRC / 'scripts/roms').glob('*.json')):
        spec = json.loads(table.read_text())
        meta[spec['profile']] = {'sets': spec['sets']}
    packer = SRC / 'scripts/profile-assets.py'
    if not packer.is_file():
        raise SystemExit('Run in the target repository with scripts/profile-assets.py present.')
    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        (root / 'scripts/roms').mkdir(parents=True)
        (root / 'profile-assets').mkdir()
        (root / 'fixtures').mkdir()
        shutil.copy2(SRC / 'scripts/fetch-roms.py', root / 'scripts/fetch-roms.py')
        shutil.copy2(packer, root / 'scripts/profile-assets.py')
        sources, blobs, data_by_set = {}, {}, {}
        for p, v in meta.items():
            config = {'sets': {}, 'default': v['sets'][-1]['name']}
            for s in v['sets']:
                files, expected = {}, {}
                for f in s['files']:
                    original = f['sha1']
                    if original not in blobs:
                        data = hashlib.shake_256(original.encode()).digest(f['size'])
                        path = root / 'fixtures' / original
                        path.write_bytes(data)
                        blobs[original] = (data, path)
                    data, path = blobs[original]
                    expected[f['role']] = data
                    files[f['name']] = str(path)
                    f['sha1'] = hashlib.sha1(data).hexdigest()
                    f['sha256'] = hashlib.sha256(data).hexdigest()
                config['sets'][s['name']] = files
                data_by_set[p, s['name']] = expected
            sources[p] = config
            # Test hash augmentation of a SHA-1-only manifest.
            plain = json.loads(json.dumps(v))
            for s in plain['sets']:
                for f in s['files']:
                    f['sha256'] = None
            (root / 'scripts/roms' / f'{p}.json').write_text(json.dumps({'profile': p, **plain}))
        (root / 'profile-assets/rom-hashes.json').write_text(json.dumps(meta))
        (root / 'profile-assets/rom-sources.json').write_text(json.dumps(sources))
        result = subprocess.run([sys.executable, str(root / 'scripts/fetch-roms.py')], cwd=root, capture_output=True, text=True)
        if result.returncode:
            raise RuntimeError(result.stdout + '\n' + result.stderr)
        expected_ids = {'roland-mt32': 9, 'roland-sc55': 7, 'roland-sc55mk2': 8}
        for (p, n), records in data_by_set.items():
            slug = re.sub(r'[^a-z0-9]+', '-', n.lower()).strip('-')
            pack = root / 'profile-assets' / f'{p}--{slug}.dspack'
            if p.startswith('awe'):
                assert not pack.exists()
                continue
            data = pack.read_bytes()
            assert struct.unpack_from('<4sIII', data) == (b'DSPK', 1, expected_ids[p], len(records))
            at = 16
            for role, b in sorted(records.items()):
                assert struct.unpack_from('<II', data, at) == (role, len(b))
                at += 8
                assert data[at:at + len(b)] == b
                at += len(b)
            assert at == len(data)
            if n == sources[p]['default']:
                assert (root / 'profile-assets' / f'{p}.dspack').read_bytes() == data
        roland = [p for p in meta if not p.startswith('awe')]
        packs = sum(len(meta[p]['sets']) for p in roland)
        assert len(list((root / 'profile-assets').glob('*.dspack'))) == packs + len(roland)
        awe = sum(len(meta[p]['sets']) for p in meta if p.startswith('awe'))
        print(f'PASS: {packs} Roland revision packs + {len(roland)} default aliases byte-exact; {awe} AWE ROM-only sets; {len(blobs)} unique synthetic ROMs.')


if __name__ == '__main__':
    main()
