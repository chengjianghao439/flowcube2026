import hashlib
import importlib.util
import io
import pathlib
import tempfile
import unittest
import zipfile

spec = importlib.util.spec_from_file_location('relay', pathlib.Path(__file__).resolve().parents[1] / 'scripts/local-release-relay.py')
relay = importlib.util.module_from_spec(spec)
spec.loader.exec_module(relay)
SHA = 'a' * 40

class RelayTests(unittest.TestCase):
    def run_fixture(self, **kwargs):
        run = dict(id=123, run_attempt=1, head_sha=SHA, head_branch='main', event='push', path='.github/workflows/deploy-browser.yml', status='in_progress')
        run.update(kwargs)
        return run

    def test_run_identity(self):
        good = self.run_fixture()
        for key, wrong in [('head_sha', 'b'*40), ('head_branch', 'other'), ('event', 'workflow_dispatch'), ('path', '.github/workflows/build-desktop.yml')]:
            self.assertIsNone(relay.select_run([self.run_fixture(**{key: wrong})], SHA, 'image', '1.2.3'))
        self.assertEqual(relay.select_run([good], SHA, 'image', '1.2.3'), good)

    def test_desktop_requires_tag(self):
        main = self.run_fixture(path='.github/workflows/build-desktop.yml')
        self.assertIsNone(relay.select_run([main], SHA, 'desktop', '1.2.3'))
        tag = dict(main, head_branch='v1.2.3')
        self.assertEqual(relay.select_run([main, tag], SHA, 'desktop', '1.2.3'), tag)

    def test_deliver_original_and_cleanup_only_staging(self):
        import json
        instance = relay.Relay(dict(GITHUB_REPOSITORY='fixture/repo', GITHUB_SHA=SHA, RELEASE_TAG='v1.2.3', FLOWCUBE_RELAY_SSH_TARGET='fixture'))
        run=self.run_fixture(); payload=self.zip_fixture([('flowcube-images.tar.gz',b'original')]); calls=[]
        artifact=dict(id=42, expired=False, size_in_bytes=len(payload),digest='sha256:'+hashlib.sha256(payload).hexdigest(),workflow_run=dict(id=123,head_sha=SHA))
        instance.current_run=lambda run,kind:run
        instance.ssh=lambda cmd:calls.append(cmd) or b''
        def command(args, **kwargs):
            if args[0]=='node': return b'https://signed.invalid/private'
            if args[0]=='scp':
                self.assertEqual(pathlib.Path(args[-2]).read_bytes(),b'original')
                calls.append('scp-original')
            return b''
        instance.command=command
        instance.fetch=lambda url,lo,hi,dest:dest.write_bytes(payload[lo:hi+1])
        try:
            self.assertEqual(instance.deliver('image',run,artifact),'relay')
            self.assertEqual(calls[1],'scp-original')
            self.assertIn('.relay.partial',calls[2]); self.assertTrue(calls[2].endswith('.relay'))
            self.assertFalse(any('rm -f' in cmd for cmd in calls))
        finally: instance.close()
        cleanup=[cmd for cmd in calls if 'rm -f' in cmd][0]
        self.assertNotIn('flowcube-images-123-1.tar.gz ',cleanup)
        self.assertFalse(instance.root.exists())

    def test_api_transient_retry(self):
        from unittest.mock import patch
        instance = object.__new__(relay.Relay); instance.repo = 'fixture/repo'
        calls=[]
        def command(args):
            calls.append(args)
            if len(calls)<3: raise RuntimeError('transient')
            return b'{"ok":true}'
        instance.command = command
        with patch.object(relay.time,'sleep',lambda seconds:None):
            self.assertEqual(instance.api('actions/runs'),{'ok':True})
        self.assertEqual(len(calls),3)

    def test_preflight_rejects_unavailable_proxy(self):
        from unittest.mock import patch
        instance = object.__new__(relay.Relay)
        instance.proxy = 'http://127.0.0.1:7897'
        instance.ssh = lambda command: self.fail('SSH must not run after proxy failure')
        with patch.object(relay.socket, 'create_connection', side_effect=OSError('offline')):
            with self.assertRaisesRegex(RuntimeError, 'Local relay proxy unavailable'):
                instance.preflight()

    def test_latest_run(self):
        self.assertEqual(relay.select_run([self.run_fixture(), self.run_fixture(id=124)], SHA, 'image', '1.2.3')['id'], 124)

    def test_attempt_paths(self):
        value = relay.artifact_spec('image', self.run_fixture(run_attempt=2), '1.2.3')
        self.assertEqual(value, ('deploy-images-123-2', 'flowcube-images.tar.gz', '/tmp/flowcube-images-123-2.tar.gz'))
        with self.assertRaises(ValueError): relay.artifact_spec('image', self.run_fixture(id='123;evil'), '1.2.3')
        with self.assertRaises(ValueError): relay.artifact_spec('desktop', self.run_fixture(), '../x')

    def zip_fixture(self, entries):
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, 'w') as archive:
            for name, data in entries: archive.writestr(name, data)
        return buf.getvalue()

    def extract(self, entries, digest=None):
        data = self.zip_fixture(entries)
        with tempfile.TemporaryDirectory() as directory:
            source = pathlib.Path(directory)/'artifact.zip'; source.write_bytes(data)
            result = relay.verify_extract(source, dict(size_in_bytes=len(data), digest=digest or 'sha256:'+hashlib.sha256(data).hexdigest()), 'expected.apk', pathlib.Path(directory))
            return result.read_bytes()

    def test_valid_original_bytes(self):
        self.assertEqual(self.extract([('expected.apk', b'original CI bytes')]), b'original CI bytes')

    def test_wrong_digest(self):
        with self.assertRaises(ValueError): self.extract([('expected.apk', b'x')], 'sha256:'+'0'*64)

    def test_zip_members(self):
        for entries in [[('../expected.apk', b'x')], [('expected.apk', b'x'), ('extra', b'y')], [('expected.apk', b'')]]:
            with self.assertRaises(ValueError): self.extract(entries)

    def test_symlink_member(self):
        with tempfile.TemporaryDirectory() as directory:
            source = pathlib.Path(directory)/'artifact.zip'
            member = zipfile.ZipInfo('expected.apk'); member.create_system=3; member.external_attr = 0o120777 << 16
            with zipfile.ZipFile(source, 'w') as archive: archive.writestr(member, '/secret')
            data = source.read_bytes()
            with self.assertRaises(ValueError): relay.verify_extract(source, dict(size_in_bytes=len(data), digest='sha256:'+hashlib.sha256(data).hexdigest()), 'expected.apk', pathlib.Path(directory))

    def test_ranges_refresh_on_retry_and_round(self):
        calls=[]; urls=[]; payload=b'abcdefghijkl'
        def url(): urls.append(len(urls)); return str(len(urls))
        def fetch(address, lo, hi, dest):
            calls.append((address,lo,hi))
            if address=='1' and lo==0: raise RuntimeError('expired signed URL')
            dest.write_bytes(payload[lo:hi+1])
        with tempfile.TemporaryDirectory() as directory:
            result=relay.download_ranges(len(payload), pathlib.Path(directory), url, fetch, chunk=3, workers=2)
            self.assertEqual(result.read_bytes(),payload)
        self.assertGreaterEqual(len(urls),2)
        self.assertIn(('2',0,2),calls)

    def test_slow_range_does_not_block_next_work(self):
        import threading
        third_started=threading.Event()
        def fetch(address,lo,hi,dest):
            if lo==0 and not third_started.wait(1): raise RuntimeError('batch barrier blocks remaining ranges')
            if lo==6: third_started.set()
            dest.write_bytes(b'x'*(hi-lo+1))
        with tempfile.TemporaryDirectory() as directory:
            result=relay.download_ranges(12,pathlib.Path(directory),lambda:'signed',fetch,chunk=3,workers=2)
            self.assertEqual(result.read_bytes(),b'x'*12)

    def test_short_range_rejected(self):
        def fetch(address,lo,hi,dest): dest.write_bytes(b'x')
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(RuntimeError): relay.download_ranges(10,pathlib.Path(directory),lambda:'signed',fetch,chunk=10,workers=1)

    def test_ready_is_retained_until_workflow_completes(self):
        from unittest.mock import patch
        instance = object.__new__(relay.Relay)
        instance.sha = SHA; instance.version = '1.2.3'
        events = []; polls = {}
        def api(path):
            if '/artifacts?' in path:
                return {'artifacts': [{'name': name} for name in ['deploy-images-123-1', 'flowcube-pda-apk', 'FlowCube-Desktop-Setup']]}
            workflow = path.split('/')[2].split('?')[0]
            return {'workflow_runs': [self.run_fixture(path='.github/workflows/'+workflow, head_branch='v1.2.3' if workflow=='build-desktop.yml' else 'main')]}
        instance.api = api
        instance.deliver = lambda kind, run, artifact: events.append('ready:'+kind) or 'relay'
        def current(run, kind):
            polls[kind] = polls.get(kind,0)+1
            events.append('check:'+kind)
            return run if polls[kind]==1 else None
        instance.current_run = current
        with patch.object(relay.time, 'sleep', lambda seconds: None): instance.watch()
        self.assertEqual(events[:3], ['ready:image','ready:pda','ready:desktop'])
        self.assertEqual(polls, {'image':2,'pda':2,'desktop':2})

    def test_rerun_waits_for_new_attempt_artifact(self):
        from unittest.mock import patch
        instance = object.__new__(relay.Relay)
        instance.sha = SHA; instance.version = '1.2.3'
        desktop = self.run_fixture(path='.github/workflows/build-desktop.yml', head_branch='v1.2.3',
                                   run_attempt=2, run_started_at='2026-09-23T08:34:15Z')
        polls = []; delivered = []
        def api(path):
            if '/artifacts?' in path:
                polls.append(path)
                artifacts = [dict(name='FlowCube-Desktop-Setup', created_at='2026-09-23T07:59:36Z')]
                if len(polls) >= 4:
                    artifacts.append(dict(name='FlowCube-Desktop-Setup', created_at='2026-09-23T08:37:00Z'))
                return {'artifacts': artifacts}
            workflow = path.split('/')[2].split('?')[0]
            if workflow == 'build-desktop.yml': return {'workflow_runs': [desktop]}
            return {'workflow_runs': [self.run_fixture(path='.github/workflows/'+workflow, status='completed', conclusion='success')]}
        instance.api = api
        instance.deliver = lambda kind, run, artifact: delivered.append(artifact['created_at']) or 'relay'
        instance.current_run = lambda run, kind: None
        with patch.object(relay.time, 'sleep', lambda seconds: None): instance.watch()
        self.assertEqual(len(polls), 4)
        self.assertEqual(delivered, ['2026-09-23T08:37:00Z'])

    def test_rerun_without_start_time_rejects_artifact_selection(self):
        from unittest.mock import patch
        instance = object.__new__(relay.Relay)
        instance.sha = SHA; instance.version = '1.2.3'
        desktop = self.run_fixture(path='.github/workflows/build-desktop.yml', head_branch='v1.2.3', run_attempt=2)
        def api(path):
            workflow = path.split('/')[2].split('?')[0]
            if workflow == 'build-desktop.yml': return {'workflow_runs': [desktop]}
            return {'workflow_runs': [self.run_fixture(path='.github/workflows/'+workflow, status='completed', conclusion='success')]}
        instance.api = api
        instance.deliver = lambda kind, run, artifact: self.fail('No artifact may be delivered')
        with patch.object(relay.time, 'sleep', lambda seconds: None):
            with self.assertRaisesRegex(RuntimeError, 'Rerun start time unavailable'):
                instance.watch()

    def test_artifact_identity(self):
        run=self.run_fixture()
        base=dict(id=3, expired=False, size_in_bytes=20, digest='sha256:'+'a'*64, workflow_run=dict(id=123,head_sha=SHA))
        relay.validate_artifact(base,run)
        for change in [dict(expired=True), dict(workflow_run=dict(id=124,head_sha=SHA)), dict(digest=None),dict(size_in_bytes=0)]:
            with self.assertRaises(ValueError): relay.validate_artifact(dict(base,**change),run)

if __name__=='__main__': unittest.main()
