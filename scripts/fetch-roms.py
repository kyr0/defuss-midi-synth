#!/usr/bin/env python3
"""Acquire explicitly configured ROM revisions; verify and pack complete sets.

Keep profile-assets/ private. Sources may be HTTPS URLs, local paths, or
{"url" or "path": ..., "member": "exact ZIP member"}. A flat filename map
selects one matching revision, as before. A revision-aware map uses "sets"
(exact manifest set names), optional "shared" filenames, and optional "default".
All configured revisions are fetched by default. Use --set to filter one profile,
and --activate to make that selected revision the compatibility/default pack.
AWE requires an additional original SBK/SF2 bank; only the ROM is fetched here.
"""
import argparse
import hashlib
import io
import json
import os
import re
import shlex
import shutil
import subprocess
import sys
import tempfile
import urllib.request
import zipfile
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
KNOWN = ROOT / 'scripts/roms'
ASSETS = ROOT / 'profile-assets'
SOURCES = ASSETS / 'rom-sources.json'
LIMIT = 64 * 1024 * 1024
# Ignore obsolete entries in existing private configuration files. Explicit requests still fail.
RETIRED = frozenset(('roland-mt32', 'roland-sc55', 'roland-sc55mk2'))
AWE = frozenset(('awe32', 'awe64'))
HASH_LENGTHS = {'sha1': 40, 'sha256': 64}
FILENAME = re.compile(r'[A-Za-z0-9][A-Za-z0-9_.-]*\Z')
PROFILE = re.compile(r'[a-z0-9][a-z0-9-]*\Z')


def unique_object(pairs):
    result = {}
    for k, v in pairs:
        if k in result:
            raise ValueError(f'duplicate JSON key: {k}')
        result[k] = v
    return result


def load_json(path):
    return json.loads(Path(path).read_text(encoding='utf-8'), object_pairs_hook=unique_object)


def slug(name):
    result = re.sub(r'[^a-z0-9]+', '-', name.lower()).strip('-')
    if not result or len(result) > 120:
        raise ValueError(f'invalid set name: {name!r}')
    return result


def check_digest(digest, algorithm):
    if not isinstance(digest, str) or not re.fullmatch(r'[a-fA-F0-9]{%d}' % HASH_LENGTHS[algorithm], digest):
        raise ValueError(f'invalid {algorithm}: {digest!r}')
    return digest.lower()


def known(directory=None):
    out = {}
    for path in sorted((KNOWN if directory is None else Path(directory)).glob('*.json')):
        spec = load_json(path)
        profile = spec['profile']
        if not isinstance(profile, str) or not PROFILE.fullmatch(profile) or profile in out:
            raise ValueError(f'{path}: invalid or duplicate profile')
        names, slugs = set(), set()
        if not spec['sets']:
            raise ValueError(f'{path}: empty sets')
        for s in spec['sets']:
            name = s['name']
            if not isinstance(name, str) or name in names or slug(name) in slugs:
                raise ValueError(f'{path}: duplicate or invalid set name: {name!r}')
            names.add(name)
            slugs.add(slug(name))
            filenames, roles = set(), set()
            if not s['files']:
                raise ValueError(f'{path}: empty ROM set {name}')
            for f in s['files']:
                filename, role, size = f['name'], f['role'], f['size']
                if (not isinstance(filename, str) or not FILENAME.fullmatch(filename)
                        or filename in filenames or filename in ('sets', 'shared', 'default')
                        or type(role) is not int or not 1 <= role <= 63 or role in roles
                        or type(size) is not int or not 0 < size <= LIMIT):
                    raise ValueError(f'{path}: invalid or duplicate ROM file/role/size: {f!r}')
                filenames.add(filename)
                roles.add(role)
                if not any(f.get(h) for h in HASH_LENGTHS):
                    raise ValueError(f'{path}: missing hash for {filename}')
                for h in HASH_LENGTHS:
                    if f.get(h) is not None:
                        f[h] = check_digest(f[h], h)
        out[profile] = spec
    if not out:
        raise ValueError('no known ROM manifests found')
    return out


def overlay_hashes(specs, path):
    """Add hashes without replacing upstream source/revision metadata.

    Match exact profile, set, filename, role and size; require one common
    trusted digest, and reject contradictory hashes. The overlay may be partial.
    """
    overlay = load_json(path)
    pending = []
    for profile, entry in overlay.items():
        if profile in RETIRED:
            continue
        if profile not in specs:
            raise ValueError(f'hash overlay: unknown profile {profile}')
        sets = {s['name']: s for s in specs[profile]['sets']}
        seen = set()
        for s in entry['sets']:
            if s['name'] in seen or s['name'] not in sets:
                raise ValueError(f'hash overlay: unknown or duplicate set {profile}/{s["name"]}')
            seen.add(s['name'])
            files = {f['name']: f for f in sets[s['name']]['files']}
            file_seen = set()
            for extra in s['files']:
                name = extra['name']
                if name not in files or name in file_seen:
                    raise ValueError(f'hash overlay: unknown or duplicate ROM {profile}/{name}')
                file_seen.add(name)
                f = files[name]
                if (extra['size'], extra['role']) != (f['size'], f['role']):
                    raise ValueError(f'hash overlay: size/role mismatch {profile}/{name}')
                values = {h: check_digest(extra[h], h) for h in HASH_LENGTHS if extra.get(h) is not None}
                common = [h for h in values if f.get(h)]
                if not common or any(f[h].lower() != values[h] for h in common):
                    raise ValueError(f'hash overlay: no matching identity or hash conflict {profile}/{name}')
                pending.append((f, values))
    for f, values in pending:
        f.update(values)


def atomic_write(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp = tempfile.mkstemp(dir=path.parent, prefix='.rom-')
    try:
        with os.fdopen(fd, 'wb') as output:
            output.write(data)
        os.replace(temp, path)
    finally:
        Path(temp).unlink(missing_ok=True)


def init(specs, path=None):
    path = SOURCES if path is None else Path(path)
    if path.exists():
        raise ValueError(f'{path} exists; edit it instead')
    template = {}
    for profile, spec in specs.items():
        sets = spec['sets']
        if len(sets) == 1:
            template[profile] = {f['name']: '' for f in sets[0]['files']}
            continue
        by_set = [{f['name']: f for f in s['files']} for s in sets]
        common = set.intersection(*(set(m) for m in by_set))
        def identity(f):
            return (f['size'], *(f.get(h) for h in HASH_LENGTHS))
        shared = sorted(n for n in common if len({identity(m[n]) for m in by_set}) == 1)
        template[profile] = {
            'default': None, 'shared': dict.fromkeys(shared, ''),
            'sets': {s['name']: {f['name']: '' for f in s['files'] if f['name'] not in shared} for s in sets},
        }
    path.parent.mkdir(parents=True, exist_ok=True)
    # Exclusive creation: never overwrite a user's private configuration.
    with path.open('x', encoding='utf-8') as output:
        json.dump(template, output, indent=2)
        output.write('\n')
    print(f'Wrote {path}; fill in desired revisions, then run without init.')


class HTTPSOnly(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if not newurl.startswith('https://'):
            raise ValueError('non-HTTPS redirect refused')
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def normalize_source(source):
    if isinstance(source, str):
        source = {'url' if '://' in source else 'path': source}
    if not isinstance(source, dict) or set(source) - {'url', 'path', 'member'}:
        raise ValueError('source must be a path, HTTPS URL, or ZIP source object')
    keys = set(source) & {'path', 'url'}
    if len(keys) != 1:
        raise ValueError('source needs exactly one of path or url')
    key = next(iter(keys))
    if not isinstance(source[key], str) or not source[key]:
        raise ValueError('empty source')
    if key == 'url' and not source[key].startswith('https://'):
        raise ValueError('only https:// URLs')
    if key == 'path':
        source = {**source, 'path': str(Path(source[key]).expanduser().resolve())}
    if 'member' in source and (not isinstance(source['member'], str) or not source['member']):
        raise ValueError('ZIP member must be a nonempty exact filename')
    return source


def read(source):
    spec = normalize_source(source)
    if 'url' in spec:
        request = urllib.request.Request(spec['url'], headers={'User-Agent': 'fetch-roms'})
        with urllib.request.build_opener(HTTPSOnly()).open(request, timeout=60) as response:
            if not response.geturl().startswith('https://'):
                raise ValueError('non-HTTPS response refused')
            data = response.read(LIMIT + 1)
    else:
        with Path(spec['path']).open('rb') as source_file:
            data = source_file.read(LIMIT + 1)
    if len(data) > LIMIT:
        raise ValueError('source exceeds size limit')
    if 'member' in spec:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            hits = [i for i in archive.infolist() if i.filename == spec['member']]
            if len(hits) != 1 or hits[0].is_dir():
                raise ValueError('ZIP member missing, duplicated or a directory')
            if hits[0].file_size > LIMIT:
                raise ValueError('ZIP member exceeds size limit')
            with archive.open(hits[0]) as member:
                data = member.read(LIMIT + 1)
            if len(data) > LIMIT:
                raise ValueError('expanded ZIP member exceeds size limit')
    return data


@dataclass(frozen=True)
class Blob:
    data: bytes
    sha1: str
    sha256: str

    @classmethod
    def from_bytes(cls, data):
        return cls(data, hashlib.sha1(data).hexdigest(), hashlib.sha256(data).hexdigest())

    def matches(self, file):
        required = [h for h in HASH_LENGTHS if file.get(h)]
        return (len(self.data) == file['size'] and bool(required)
                and all(getattr(self, h) == file[h].lower() for h in required))


def matches(data, file):
    """Every supplied hash must match, never SHA-1 OR SHA-256."""
    return Blob.from_bytes(data).matches(file)


class RomCache:
    """Per-run cache of verified payloads by normalized source, not filename.

    Each use still checks the required revision; one cached PCM cannot validate
    a different control ROM. Failed/unverified data are never cached.
    """
    def __init__(self):
        self.blobs = {}

    def get(self, source, candidates):
        normalized = normalize_source(source)
        key = json.dumps(normalized, sort_keys=True, separators=(',', ':'))
        blob = self.blobs.get(key)
        if blob is None:
            blob = Blob.from_bytes(read(normalized))
        hit = next((f for f in candidates if blob.matches(f)), None)
        if hit is None:
            raise ValueError(f'no matching revision: {len(blob.data)} bytes; sha1 {blob.sha1}; sha256 {blob.sha256}')
        self.blobs[key] = blob
        return blob, hit


def configured(source):
    return source is not None and source != ''


def check_mapping(mapping, allowed, label):
    if not isinstance(mapping, dict):
        raise ValueError(f'{label}: expected filename-to-source object')
    extra = set(mapping) - set(allowed)
    if extra:
        raise ValueError(f'{label}: unknown filenames: {", ".join(sorted(extra))}')
    for source in mapping.values():
        if configured(source):
            normalize_source(source)
    return {k: v for k, v in mapping.items() if configured(v)}


def plan(profile, spec, sources, selected=None, activate=False):
    """Return (mode, jobs, active set name). Jobs contain exact manifest sets.

    In flat mode the set is resolved after hashing all configured files.
    In revision-aware mode explicit set identity is checked before publishing.
    """
    if not isinstance(sources, dict):
        raise ValueError(f'{profile}: expected sources object')
    all_sets = {s['name']: s for s in spec['sets']}
    if selected is not None and selected not in all_sets:
        raise ValueError(f'{profile}: unknown set {selected!r}; choose from {", ".join(all_sets)}')
    allowed = {f['name'] for s in all_sets.values() for f in s['files']}
    if 'sets' not in sources:
        mapping = check_mapping(sources, allowed, profile)
        return 'flat', [(list(all_sets.values()) if selected is None else [all_sets[selected]], mapping)] if mapping or selected else [], None
    extra = set(sources) - {'sets', 'shared', 'default'}
    if extra or not isinstance(sources['sets'], dict):
        raise ValueError(f'{profile}: revision-aware config accepts only sets, shared, default')
    unknown = set(sources['sets']) - set(all_sets)
    if unknown:
        raise ValueError(f'{profile}: unknown sets: {", ".join(sorted(unknown))}')
    common = set.intersection(*({f['name'] for f in s['files']} for s in all_sets.values()))
    shared = check_mapping(sources.get('shared', {}), common, f'{profile}/shared')
    jobs = []
    for name, s in all_sets.items():
        filenames = {f['name'] for f in s['files']}
        specific = check_mapping(sources['sets'].get(name, {}), filenames, f'{profile}/{name}')
        mapping = {**shared, **specific}
        enabled = bool(specific) or (name in sources['sets'] and filenames <= set(mapping))
        if enabled or selected == name:
            jobs.append((s, mapping))
    default = sources.get('default')
    if default is not None and (not isinstance(default, str) or default not in all_sets):
        raise ValueError(f'{profile}: unknown default set {default!r}')
    if default is None and jobs:
        default = jobs[0][0]['name']
    if jobs and default not in {s['name'] for s, _ in jobs} and not activate:
        raise ValueError(f'{profile}: default set is not configured')
    if selected is not None:
        jobs = [(s, m) for s, m in jobs if s['name'] == selected]
    if activate:
        default = selected
    return 'sets', jobs, default


def verify_set(s, mapping, cache):
    verified = {}
    for file in s['files']:
        name = file['name']
        if name not in mapping:
            raise ValueError(f'missing source for {name}')
        blob, _ = cache.get(mapping[name], [file])
        verified[name] = blob
        print(f'    {name}: OK, sha256 {blob.sha256}')
    return verified


def verify_flat(candidates, mapping, cache):
    verified = {}
    for name, source in mapping.items():
        files = [f for s in candidates for f in s['files'] if f['name'] == name]
        if not files:
            raise ValueError(f'{name}: not part of selected revision')
        blob, _ = cache.get(source, files)
        verified[name] = blob
        print(f'    {name}: OK, sha256 {blob.sha256}')
    complete = next((s for s in candidates if all(f['name'] in verified and verified[f['name']].matches(f) for f in s['files'])), None)
    if complete is None:
        raise ValueError('no complete matching set; needed: ' + ' | '.join(', '.join(f['name'] for f in s['files']) for s in candidates))
    return complete, {f['name']: verified[f['name']] for f in complete['files']}


def publish(profile, s, verified, activate=False):
    """Stage a complete verified set and successful pack before publication.

    Files are replaced atomically individually; failed verification or packer
    failure does not modify existing ROMs or packs. The old alias is replaced
    only after the new versioned pack is ready.
    """
    key = slug(s['name'])
    dest = ASSETS / 'roms' / profile / key
    pack = ASSETS / f'{profile}--{key}.dspack'
    ASSETS.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=ASSETS, prefix='.rom-stage-') as folder:
        stage = Path(folder)
        for name, blob in verified.items():
            (stage / name).write_bytes(blob.data)
        staged_pack = stage / 'pack.dspack'
        if profile not in AWE:
            records = [f'{f["role"]}={stage / f["name"]}' for f in s['files']]
            subprocess.run([sys.executable, str(ROOT / 'scripts/profile-assets.py'), 'pack', profile, str(staged_pack), *records], check=True)
            if not staged_pack.is_file():
                raise ValueError('packer returned success without a pack')
        for name, blob in verified.items():
            atomic_write(dest / name, blob.data)
        if profile not in AWE:
            os.replace(staged_pack, pack)
        if activate:
            for name, blob in verified.items():
                atomic_write(ASSETS / 'roms' / profile / name, blob.data)
            if profile not in AWE:
                # Stage the compatibility alias on the same filesystem.
                alias = stage / 'alias.dspack'
                shutil.copyfile(pack, alias)
                os.replace(alias, ASSETS / f'{profile}.dspack')
    if profile in AWE:
        rom = dest / s['files'][0]['name']
        print('    ROM verified; an original Creative bank is still required:')
        target = ASSETS / f'{profile}.dspack' if activate else pack
        print('    ' + shlex.join([sys.executable, str(ROOT / 'scripts/profile-assets.py'), 'pack-awe', profile, 'SYNTHGM.SBK', str(target), '--rom', str(rom)]))
    else:
        print(f'    packed {pack}' + (' (default alias updated)' if activate else ''))


def execute_plan(profile, planned, cache):
    mode, jobs, default = planned
    if not jobs:
        print(f'{profile}: skipped (no sources)')
        return True
    print(profile + ':')
    ok = True
    for target, mapping in jobs:
        try:
            if mode == 'flat':
                s, verified = verify_flat(target, mapping, cache)
            else:
                s = target
                print(f'  {s["name"]}:')
                verified = verify_set(s, mapping, cache)
            publish(profile, s, verified, activate=(mode == 'flat' or s['name'] == default))
        except (OSError, ValueError, KeyError, TypeError, RuntimeError, zipfile.BadZipFile, subprocess.CalledProcessError) as error:
            label = 'flat source map' if mode == 'flat' else target['name']
            print(f'  {label}: FAILED ({error})', file=sys.stderr)
            ok = False
    return ok


def fetch(profile, spec, sources, *, selected=None, activate=False, cache=None):
    """Compatibility entry point; also used by tests and other Python callers."""
    return execute_plan(profile, plan(profile, spec, sources, selected, activate), cache if cache is not None else RomCache())


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('profiles', nargs='*', help='init, or profiles to fetch; default: all configured profiles')
    parser.add_argument('--sources', type=Path, default=SOURCES, help='private source JSON')
    parser.add_argument('--hash-manifest', type=Path, help='optional aggregate hash overlay; defaults to profile-assets/rom-hashes.json when present')
    parser.add_argument('--set', dest='selected', help='exact set name; requires one named profile')
    parser.add_argument('--activate', action='store_true', help='update default pack to the set selected with --set')
    args = parser.parse_args(argv)
    if args.selected and len(args.profiles) != 1 or args.activate and not args.selected:
        parser.error('--set requires one profile; --activate requires --set')
    try:
        specs = known()
        hashes = args.hash_manifest or ASSETS / 'rom-hashes.json'
        if args.hash_manifest is not None or hashes.exists():
            overlay_hashes(specs, hashes)
        if args.profiles == ['init']:
            if args.selected or args.activate:
                parser.error('init does not accept --set or --activate')
            init(specs, args.sources)
            return 0
        if not args.sources.exists():
            raise ValueError(f'no {args.sources}; run init or supply --sources')
        sources = load_json(args.sources)
        if not isinstance(sources, dict):
            raise ValueError('sources JSON must be an object')
        # Unconfigured, unknown empty profile entries may be skipped. A typo
        # in an active profile must not be silently ignored.
        unknown = {p for p, v in sources.items() if v and p not in specs and p not in RETIRED} | (set(args.profiles) - set(specs))
        if unknown:
            raise ValueError('unknown profiles: ' + ', '.join(sorted(unknown)))
        wanted = list(dict.fromkeys(args.profiles)) if args.profiles else list(specs)
        plans = [(p, plan(p, specs[p], sources.get(p, {}), args.selected, args.activate)) for p in wanted]
        if not any(planned[1] for _, planned in plans):
            print(f'{args.sources} names no configured ROM sets; skipped')
            return 0
        cache, ok = RomCache(), True
        for p, planned in plans:
            ok = execute_plan(p, planned, cache) and ok
        return 0 if ok else 1
    except (OSError, ValueError, KeyError, TypeError) as error:
        print(f'fetch-roms: {error}', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
