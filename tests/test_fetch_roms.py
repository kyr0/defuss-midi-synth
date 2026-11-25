"""scripts/fetch-roms.py on real subsystems: each test runs a fresh copy of the script, with the real
scripts/profile-assets.py, in a throwaway repository (its paths follow from where it lies), and URLs come from a real
HTTPS server on 127.0.0.1 with a throwaway certificate. No ROM data: every payload is synthetic."""
import collections
import contextlib
import functools
import hashlib
import http.server
import importlib.util
import io
import json
import os
import shutil
import ssl
import subprocess
import sys
import tempfile
import threading
import unittest
import warnings
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def file_spec(name, role, data, *, sha256=True):
    return {'name': name, 'role': role, 'size': len(data),
            'sha1': hashlib.sha1(data).hexdigest(),
            'sha256': hashlib.sha256(data).hexdigest() if sha256 else None}


class Handler(http.server.SimpleHTTPRequestHandler):
    """Serves the server's directory, counts each path's requests, and answers /redirect with a move to plain HTTP."""
    def do_GET(self):
        self.server.hits[self.path] += 1
        if self.path == '/redirect':
            self.send_response(302)
            self.send_header('Location', f'http://127.0.0.1:{self.server.server_address[1]}/a.bin')
            self.end_headers()
            return
        super().do_GET()

    def log_message(self, *args):
        pass


class RomTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.web = tempfile.TemporaryDirectory()
        web = Path(cls.web.name)
        (web / 'files').mkdir()
        cert, key = web / 'cert.pem', web / 'key.pem'
        subprocess.run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', str(key), '-out', str(cert),
                        '-days', '1', '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1'],
                       check=True, capture_output=True)
        server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Handler, directory=str(web / 'files')))
        server.hits = collections.Counter()
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.load_cert_chain(cert, key)
        server.socket = context.wrap_socket(server.socket, server_side=True)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        cls.server, cls.files = server, web / 'files'
        cls.url = f'https://127.0.0.1:{server.server_address[1]}'
        # The script's child process trusts the throwaway certificate, as OpenSSL takes a trust store from the
        # environment; this process's own environment stays as it was.
        cls.env = {**os.environ, 'SSL_CERT_FILE': str(cert)}

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.web.cleanup()

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        (self.root / 'scripts').mkdir()
        shutil.copy(ROOT / 'scripts/fetch-roms.py', self.root / 'scripts/fetch-roms.py')
        shutil.copy(ROOT / 'scripts/profile-assets.py', self.root / 'scripts/profile-assets.py')
        self.assets = self.root / 'profile-assets'
        self.known = self.root / 'scripts/roms'
        self.known.mkdir()
        self.assets.mkdir()
        self.profile = 'gus-gf1'
        self.a, self.b, self.pcm = b'control-v1', b'control-v2', b'pcm-shared'
        self.paths = {}
        for name, data in [('a', self.a), ('b', self.b), ('pcm', self.pcm)]:
            path = self.root / (name + '.bin')
            path.write_bytes(data)
            self.paths[name] = str(path)
        self.spec = {'profile': self.profile, 'sets': [
            {'name': 'Patch set A', 'files': [file_spec('CONTROL.ROM', 32, self.a), file_spec('PCM.ROM', 33, self.pcm)]},
            {'name': 'Patch set B', 'files': [file_spec('CONTROL.ROM', 32, self.b), file_spec('PCM.ROM', 33, self.pcm)]},
        ]}
        self.manifest = self.known / f'{self.profile}.json'
        self.manifest.write_text(json.dumps(self.spec))
        self.sources = self.assets / 'rom-sources.json'
        # The copy in the throwaway repository, loaded under a name of its own: its ROOT is that repository.
        spec = importlib.util.spec_from_file_location(f'fetch_roms_{id(self)}', self.root / 'scripts/fetch-roms.py')
        self.rom = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.rom)
        self.quiet = contextlib.ExitStack()
        self.addCleanup(self.quiet.close)
        self.quiet.enter_context(contextlib.redirect_stdout(io.StringIO()))
        self.quiet.enter_context(contextlib.redirect_stderr(io.StringIO()))

    def config(self):
        return {'default': 'Patch set B', 'shared': {'PCM.ROM': self.paths['pcm']}, 'sets': {
            'Patch set A': {'CONTROL.ROM': self.paths['a']},
            'Patch set B': {'CONTROL.ROM': self.paths['b']}}}

    def write_config(self, config):
        self.sources.write_text(json.dumps(config))

    def version_pack(self, name):
        return self.assets / f'{self.profile}--{self.rom.slug(name)}.dspack'

    def alias(self):
        return self.assets / f'{self.profile}.dspack'

    def serve(self, name, data):
        (self.files / name).write_bytes(data)
        return f'{self.url}/{name}'

    def cli(self, config, *args):
        """Runs the command as a user does, in the throwaway repository, with config as its rom-sources.json."""
        self.write_config({self.profile: config})
        return subprocess.run([sys.executable, str(self.root / 'scripts/fetch-roms.py'), *args], cwd=self.root, env=self.env,
                              capture_output=True, text=True)

    def test_all_sets_shared_read_once_and_default(self):
        # The PCM both sets share comes from the server once: its request count is the evidence.
        pcm = self.serve(f'pcm-{id(self)}.bin', self.pcm)
        config = self.config()
        config['shared'] = {'PCM.ROM': pcm}
        run = self.cli(config)
        self.assertEqual(run.returncode, 0, run.stdout + run.stderr)
        self.assertEqual(self.server.hits[pcm[len(self.url):]], 1)
        self.assertIn(self.a, self.version_pack('Patch set A').read_bytes())
        self.assertIn(self.b, self.version_pack('Patch set B').read_bytes())
        self.assertEqual(self.alias().read_bytes(), self.version_pack('Patch set B').read_bytes())
        self.assertEqual(self.alias().read_bytes()[:4], b'DSPK', 'the real packer wrote it')
        self.assertEqual((self.assets / 'roms' / self.profile / 'CONTROL.ROM').read_bytes(), self.b)
        self.assertEqual((self.assets / 'roms' / self.profile / 'patch-set-a' / 'CONTROL.ROM').read_bytes(), self.a)

    def test_select_and_activate(self):
        self.assertTrue(self.rom.fetch(self.profile, self.spec, self.config(), selected='Patch set A'))
        self.assertFalse(self.alias().exists())
        self.assertFalse(self.version_pack('Patch set B').exists())
        self.assertTrue(self.rom.fetch(self.profile, self.spec, self.config(), selected='Patch set A', activate=True))
        self.assertEqual(self.alias().read_bytes(), self.version_pack('Patch set A').read_bytes())

    def test_flat_config_legacy_paths(self):
        flat = {'CONTROL.ROM': self.paths['a'], 'PCM.ROM': self.paths['pcm']}
        self.assertTrue(self.rom.fetch(self.profile, self.spec, flat))
        self.assertEqual((self.assets / 'roms' / self.profile / 'CONTROL.ROM').read_bytes(), self.a)
        self.assertEqual(self.alias().read_bytes(), self.version_pack('Patch set A').read_bytes())
        self.assertFalse(self.version_pack('Patch set B').exists())

    def test_wrong_revision_rejected_without_overwriting(self):
        config = self.config()
        self.assertTrue(self.rom.fetch(self.profile, self.spec, config))
        old = self.alias().read_bytes()
        config['sets']['Patch set B']['CONTROL.ROM'] = self.paths['a']
        self.assertFalse(self.rom.fetch(self.profile, self.spec, config))
        self.assertEqual(self.alias().read_bytes(), old)
        self.assertEqual((self.assets / 'roms' / self.profile / 'patch-set-b' / 'CONTROL.ROM').read_bytes(), self.b)

    def test_both_hashes_are_required(self):
        file = file_spec('CONTROL.ROM', 32, self.a)
        self.assertTrue(self.rom.matches(self.a, file))
        self.assertFalse(self.rom.matches(self.a, {**file, 'sha256': '0' * 64}))
        self.assertFalse(self.rom.matches(self.a, {**file, 'sha1': '0' * 40}))
        self.assertTrue(self.rom.matches(self.a, {**file, 'sha256': None}))
        self.assertTrue(self.rom.matches(self.a, {**file, 'sha1': None}))
        self.assertFalse(self.rom.matches(self.a, {**file, 'sha1': None, 'sha256': None}))
        self.assertFalse(self.rom.matches(self.a, {**file, 'size': len(self.a) + 1}))

    def test_failed_packer_leaves_existing_alias_intact(self):
        self.assertTrue(self.rom.fetch(self.profile, self.spec, self.config()))
        old = self.alias().read_bytes()
        # The real packer refuses a GF1 set whose bank is not role 32.
        self.spec['sets'][0]['files'][0]['role'] = 3
        self.assertFalse(self.rom.fetch(self.profile, self.spec, self.config(), selected='Patch set A', activate=True))
        self.assertEqual(self.alias().read_bytes(), old)
        self.assertEqual((self.assets / 'roms' / self.profile / 'CONTROL.ROM').read_bytes(), self.b)
        self.assertEqual(list(self.assets.glob('.rom-stage-*')), [])

    def test_missing_file_does_not_publish(self):
        config = self.config()
        config['shared'] = {}
        self.assertFalse(self.rom.fetch(self.profile, self.spec, config))
        self.assertFalse(self.alias().exists())
        self.assertFalse((self.assets / 'roms').exists())

    def test_skip_blank_and_empty_profile(self):
        config = self.config()
        config['default'] = None
        for s in config['sets'].values():
            s['CONTROL.ROM'] = ''
        self.assertTrue(self.rom.fetch(self.profile, self.spec, config))
        self.assertFalse(self.alias().exists())
        self.write_config({self.profile: {}, 'future-profile': {}})
        self.assertEqual(self.rom.main([]), 0)

    def test_unknown_profile_set_and_filename(self):
        with self.assertRaisesRegex(ValueError, 'unknown set'):
            self.rom.plan(self.profile, self.spec, self.config(), 'not a set')
        config = self.config()
        config['sets']['Patch set B']['../bad.rom'] = self.paths['b']
        with self.assertRaisesRegex(ValueError, 'unknown filenames'):
            self.rom.plan(self.profile, self.spec, config)
        self.write_config({'wrong-profile': {'x': self.paths['a']}})
        self.assertEqual(self.rom.main([]), 1)

    def test_shared_override_and_blank(self):
        config = self.config()
        config['sets']['Patch set A']['PCM.ROM'] = ''
        self.assertTrue(self.rom.fetch(self.profile, self.spec, config))
        config['sets']['Patch set A']['PCM.ROM'] = self.paths['a']
        self.assertFalse(self.rom.fetch(self.profile, self.spec, config))

    def test_zip_member_local_and_size_cap(self):
        path = self.root / 'roms.zip'
        with zipfile.ZipFile(path, 'w', compression=zipfile.ZIP_DEFLATED) as z:
            z.writestr('some/control.rom', self.a)
            z.writestr('some/pcm.rom', self.pcm)
        self.assertEqual(self.rom.read({'path': str(path), 'member': 'some/control.rom'}), self.a)
        with self.assertRaisesRegex(ValueError, 'missing'):
            self.rom.read({'path': str(path), 'member': 'absent'})
        # The script's own limit: a file one byte over it (sparse, so it costs no disk), and a small archive whose
        # member expands one byte over it.
        big = self.root / 'big.bin'
        with big.open('wb') as f:
            f.truncate(self.rom.LIMIT + 1)
        with self.assertRaisesRegex(ValueError, 'size limit'):
            self.rom.read(str(big))
        path2 = self.root / 'compressed.zip'
        with zipfile.ZipFile(path2, 'w', compression=zipfile.ZIP_DEFLATED) as z:
            z.writestr('large', bytes(self.rom.LIMIT + 1))
        self.assertLess(path2.stat().st_size, 1 << 20)
        with self.assertRaisesRegex(ValueError, 'ZIP member exceeds'):
            self.rom.read({'path': str(path2), 'member': 'large'})

    def test_duplicate_zip_member(self):
        path = self.root / 'duplicate.zip'
        with warnings.catch_warnings():
            warnings.simplefilter('ignore', UserWarning)
            with zipfile.ZipFile(path, 'w') as z:
                z.writestr('x', b'a')
                z.writestr('x', b'b')
        with self.assertRaisesRegex(ValueError, 'duplicated'):
            self.rom.read({'path': str(path), 'member': 'x'})

    def test_https_only_and_url_zip(self):
        with self.assertRaisesRegex(ValueError, 'https'):
            self.rom.read('http://example.test/a')
        with self.assertRaisesRegex(ValueError, 'exactly one'):
            self.rom.read({'path': self.paths['a'], 'url': 'https://example.test/a'})
        # A real server's move to plain HTTP is refused, and a ZIP member comes out of a real download.
        refused = self.cli({'CONTROL.ROM': f'{self.url}/redirect', 'PCM.ROM': self.paths['pcm']})
        self.assertNotEqual(refused.returncode, 0)
        self.assertIn('redirect', refused.stdout + refused.stderr)
        self.assertFalse(self.alias().exists())
        archive = io.BytesIO()
        with zipfile.ZipFile(archive, 'w') as z:
            z.writestr('rom.bin', self.a)
        url = self.serve(f'rom-{id(self)}.zip', archive.getvalue())
        run = self.cli({'CONTROL.ROM': {'url': url, 'member': 'rom.bin'}, 'PCM.ROM': self.paths['pcm']})
        self.assertEqual(run.returncode, 0, run.stdout + run.stderr)
        self.assertEqual((self.assets / 'roms' / self.profile / 'CONTROL.ROM').read_bytes(), self.a)

    def test_init_template_deduplicates_pcm(self):
        self.rom.init({self.profile: self.spec})
        cfg = json.loads(self.sources.read_text())[self.profile]
        self.assertEqual(cfg['shared'], {'PCM.ROM': ''})
        self.assertEqual(cfg['sets']['Patch set A'], {'CONTROL.ROM': ''})
        with self.assertRaisesRegex(ValueError, 'exists'):
            self.rom.init({self.profile: self.spec})

    def test_hash_overlay_preserves_metadata_and_rejects_conflict(self):
        overlay = {self.profile: {'sets': self.spec['sets']}}
        path = self.assets / 'rom-hashes.json'
        path.write_text(json.dumps(overlay))
        specs = self.rom.known()
        f = specs[self.profile]['sets'][0]['files'][0]
        f['sha256'] = None
        f['source'] = 'upstream provenance'
        self.rom.overlay_hashes(specs, path)
        self.assertEqual(f['sha256'], hashlib.sha256(self.a).hexdigest())
        self.assertEqual(f['source'], 'upstream provenance')
        overlay[self.profile]['sets'][0]['files'][0]['sha1'] = '0' * 40
        path.write_text(json.dumps(overlay))
        with self.assertRaisesRegex(ValueError, 'hash conflict'):
            self.rom.overlay_hashes(specs, path)

    def test_reject_unsafe_manifest_and_duplicate_json_keys(self):
        self.spec['sets'][0]['files'][0]['name'] = '../escape'
        self.manifest.write_text(json.dumps(self.spec))
        with self.assertRaisesRegex(ValueError, 'invalid'):
            self.rom.known()
        self.sources.write_text('{"x":1,"x":2}')
        with self.assertRaisesRegex(ValueError, 'duplicate JSON key'):
            self.rom.load_json(self.sources)

    def test_awe_rom_only_no_fake_pack(self):
        cache = self.rom.RomCache()
        for profile in ('awe32', 'awe64'):
            spec = {'sets': [{'name': 'EMU8000 GM ROM', 'files': [file_spec('awe32.raw', 3, self.a)]}]}
            self.assertTrue(self.rom.fetch(profile, spec, {'awe32.raw': self.paths['a']}, cache=cache))
            self.assertEqual((self.assets / 'roms' / profile / 'awe32.raw').read_bytes(), self.a)
            self.assertFalse((self.assets / f'{profile}.dspack').exists())
        self.assertEqual(len(cache.blobs), 1)

    def test_cli_fetch_set_and_activate(self):
        self.write_config({self.profile: self.config()})
        self.assertEqual(self.rom.main([]), 0)
        self.assertEqual(self.rom.main([self.profile, '--set', 'Patch set A', '--activate']), 0)
        self.assertIn(self.a, self.alias().read_bytes())
        self.assertEqual(self.rom.main([self.profile, '--set', 'Patch set B']), 0)
        self.assertIn(self.b, self.alias().read_bytes())

    def test_cli_as_a_process(self):
        # The command as a user runs it, in the throwaway repository: sources from the HTTPS server, both sets packed.
        control = self.serve(f'control-{id(self)}.bin', self.b)
        run = self.cli({'shared': {'PCM.ROM': self.paths['pcm']}, 'default': 'Patch set B',
                        'sets': {'Patch set A': {'CONTROL.ROM': self.paths['a']}, 'Patch set B': {'CONTROL.ROM': control}}})
        self.assertEqual(run.returncode, 0, run.stdout + run.stderr)
        self.assertIn(self.b, self.alias().read_bytes())


if __name__ == '__main__':
    unittest.main()
