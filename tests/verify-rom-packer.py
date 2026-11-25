#!/usr/bin/env python3
"""Verify the AWE ROM manifests and cached bytes with isolated synthetic files."""
from pathlib import Path
import tempfile
import shutil
import json
import hashlib
import subprocess
import sys

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
        for profile, spec in meta.items():
            for file in spec['sets'][-1]['files']:
                cached = root / 'profile-assets/roms' / profile / file['name']
                assert cached.read_bytes() == data_by_set[profile, spec['sets'][-1]['name']][file['role']]
        assert not list((root / 'profile-assets').glob('*.dspack'))
        print(f'PASS: verified ROM bytes for {len(meta)} AWE profiles.')


if __name__ == '__main__':
    main()
