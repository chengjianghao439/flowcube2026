"""Offline behavioral tests: synthetic bytes/keys, never SSH, network or production."""
import copy
import base64
import concurrent.futures
import os
import struct
import subprocess
import importlib.util
import io
import json
from pathlib import Path
import sys
import tarfile
import tempfile
import unittest

TOOLS = Path(__file__).resolve().parents[1] / 'scripts/manual-release'
sys.path.insert(0, str(TOOLS))


class BundleContract(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Missing implementation is an explicit red, not an accidental import error.
        if not (TOOLS / 'protocol.py').exists():
            raise AssertionError('manual release protocol is not implemented')
        import protocol
        cls.p = protocol

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.sha = 'a' * 40
        self.meta = dict(schema=1, kind='pda', sha=self.sha, version='2.3.4', versionCode=987,
                         runId='123', runAttempt='1', actorId='456', workflowSha='b' * 40, approval=dict(operatorId='789',commentId='7',backupCommentId='6',backupReceiptSha256='e'*64,approvalTime='2026-01-01T00:00:01.000Z',backupTime='2026-01-01T00:00:00.000Z'))
        self.files = {'checks.json': json.dumps([dict(workflow=w, sha=self.sha, conclusion='success', event='push', branch='main', runId=12, allJobsPassed=True, **({'auditTargets': ['backend', 'desktop', 'frontend', 'scripts/browser-smoke']} if w == 'security-scan.yml' else {})) for w in ('test.yml', 'security-scan.yml')]).encode(), 'source-locks.json': json.dumps(dict(sha=self.sha, locks={n: 'c'*64 for n in ('backend', 'frontend', 'desktop', 'scripts/browser-smoke')})).encode(), 'app.apk': b'synthetic signed apk', 'version.json': b'{"version":"2.3.4","versionCode":987}'}

    def archive(self, files=None, meta=None, extra=None):
        files = self.files if files is None else files
        manifest = dict(self.meta if meta is None else meta)
        manifest['files'] = {n: dict(size=len(b), sha256=self.p.digest_bytes(b)) for n, b in files.items()}
        data = io.BytesIO()
        with tarfile.open(fileobj=data, mode='w') as tar:
            for name, content in {'manifest.json': json.dumps(manifest).encode(), **files}.items():
                item = tarfile.TarInfo(name); item.size = len(content); tar.addfile(item, io.BytesIO(content))
            if extra:
                tar.addfile(extra, io.BytesIO(b'x') if extra.isfile() else None)
        archive = self.root / 'bundle.tar'
        archive.write_bytes(data.getvalue())
        return archive

    def test_normal_exact_bundle(self):
        result = self.p.verify_bundle(self.archive(), self.root / 'out')
        self.assertEqual(result['sha'], self.sha)
        self.assertEqual((self.root / 'out/app.apk').read_bytes(), self.files['app.apk'])

    def test_sha_mismatch_and_short_sha(self):
        for sha in ('abcd1234', 'main', 'a' * 39, 'a' * 40 + ';id'):
            bad = dict(self.meta, sha=sha)
            with self.assertRaises(ValueError): self.p.verify_bundle(self.archive(meta=bad), self.root / 'out')

    def test_file_tamper(self):
        archive = self.archive()
        raw = archive.read_bytes().replace(b'synthetic signed apk', b'tampered! signed apk')
        archive.write_bytes(raw)
        with self.assertRaises(ValueError): self.p.verify_bundle(archive, self.root / 'out')

    def test_all_archive_path_and_link_escapes(self):
        for name, kind in [('../outside', tarfile.REGTYPE), ('/outside', tarfile.REGTYPE),
                           ('sub/../../outside', tarfile.REGTYPE), ('app.apk', tarfile.SYMTYPE),
                           ('app.apk', tarfile.LNKTYPE), ('device', tarfile.CHRTYPE)]:
            item = tarfile.TarInfo(name); item.type = kind; item.linkname = '/outside'; item.size = int(kind == tarfile.REGTYPE)
            with self.assertRaises(ValueError): self.p.verify_bundle(self.archive(extra=item), self.root / 'out')
        self.assertFalse((self.root.parent / 'outside').exists())

    def test_extra_missing_and_injected_versions(self):
        for version in ('2.3.4;id', '../../escape', '2.3', ''):
            with self.assertRaises(ValueError): self.p.verify_bundle(self.archive(meta=dict(self.meta, version=version)), self.root / 'out')
        with self.assertRaises(ValueError): self.p.verify_bundle(self.archive(files={**self.files, 'extra.sh': b'id'}), self.root / 'out')

    def test_wrong_version_metadata_is_rejected(self):
        with self.assertRaises(ValueError):
            self.p.verify_bundle(self.archive(files={**self.files, 'version.json': b'{"version":"9.9.9","versionCode":987}'}), self.root / 'out')





class IdentityAndReceiver(BundleContract):
    def setUp(self):
        super().setUp()
        import receive
        self.r = receive
        self.state=self.root/'state'; self.state.mkdir()
        self.spool=self.root/'spool'; self.spool.mkdir()
        self.key=self.root/'synthetic-test-private.pem'
        self.public=self.root/'synthetic-test-public.pem'
        # Ephemeral test fixture only; never installed, reused or used for SSH.
        subprocess.run(['openssl','genpkey','-algorithm','RSA','-pkeyopt','rsa_keygen_bits:2048','-out',str(self.key)],check=True,capture_output=True)
        subprocess.run(['openssl','pkey','-in',str(self.key),'-pubout','-out',str(self.public)],check=True,capture_output=True)
        self.policy=dict(repository='fixture/repo',repositoryId='1234',ownerId='12',subject='repo:fixture/repo:environment:manual-release',
                         environment='manual-release',actorIds=['456'],operatorIds=['789'],
                         oidcKeys={'synthetic':str(self.public)},workflowShas={'fixture/repo/.github/workflows/build-pda-apk.yml@refs/heads/main':['b'*40]},
                         stateDir=str(self.state),spoolDir=str(self.spool),maxBundleBytes=1024**2,reserveBytes=0,preservedFiles={})
        baseline=self.root/'initial-baseline.json'
        baseline.write_text(json.dumps(dict(status='operator-verified-baseline',sha='f'*40,version='2.0.0',pdaVersionCode=900,imageIds={'backend':'sha256:'+'a'*64,'frontend':'sha256:'+'b'*64})))
        self.policy['initialBaselineFile']=str(baseline)
        (self.state/'browser-current.json').write_text(json.dumps(dict(status='executor-success',sha=self.sha,version=self.meta['version'],imageIds={'backend':'sha256:'+'a'*64,'frontend':'sha256:'+'b'*64})))
        self.claims=dict(iss='https://token.actions.githubusercontent.com',repository='fixture/repo',repository_id='1234',
                         repository_owner_id='12',sub=self.policy['subject'],environment='manual-release',ref='refs/heads/main',
                         event_name='workflow_dispatch',run_attempt='1',runner_environment='github-hosted',actor_id='456',run_id='123',
                         workflow_ref=next(iter(self.policy['workflowShas'])),workflow_sha='b'*40,nbf=100,iat=100,exp=400)

    def token(self, checksum, claims=None):
        def encode(raw): return base64.urlsafe_b64encode(raw).rstrip(b'=')
        header=encode(json.dumps(dict(alg='RS256',typ='JWT',kid='synthetic')).encode())
        body=encode(json.dumps(dict(self.claims if claims is None else claims,aud='urn:flowcube-release:v1:'+checksum)).encode())
        signed=header+b'.'+body
        signature=subprocess.run(['openssl','dgst','-sha256','-sign',str(self.key)],input=signed,capture_output=True,check=True).stdout
        return (signed+b'.'+encode(signature)).decode()

    def packet(self, meta=None, claims=None):
        archive=self.archive(meta=meta)
        raw=archive.read_bytes();checksum=self.p.digest_bytes(raw)
        token=self.token(checksum,claims)
        header=json.dumps(dict(token=token,size=len(raw),sha256=checksum)).encode()
        return struct.pack('!I',len(header))+header+raw

    def test_real_rsa_signature_and_identity_rejections(self):
        checksum='d'*64
        self.assertEqual(self.p.verify_oidc(self.token(checksum),checksum,self.policy,self.state,now=200)['actor_id'],'456')
        for values in ({'actor_id':'999'},{'repository_id':'999'},{'workflow_sha':'c'*40},{'event_name':'push'},
                       {'ref':'refs/heads/feature'},{'runner_environment':'self-hosted'},{'run_attempt':'2'},
                       {'exp':150},{'nbf':300},{'workflow_ref':'fixture/repo/.github/workflows/other.yml@refs/heads/main'}):
            with self.subTest(values=values), self.assertRaises(ValueError):
                self.p.verify_oidc(self.token(checksum,dict(self.claims,**values)),checksum,self.policy,self.state,now=200)
        with self.assertRaises(ValueError): self.p.verify_oidc(self.token(checksum),'e'*64,self.policy,self.state,now=200)
        token=self.token(checksum);parts=token.split('.');parts[1]=base64.urlsafe_b64encode(json.dumps(dict(self.claims,actor_id='999')).encode()).rstrip(b'=').decode()
        with self.assertRaises(ValueError): self.p.verify_oidc('.'.join(parts),checksum,self.policy,self.state,now=200)

    def test_normal_receiver_and_duplicate_version(self):
        calls=[];packet=self.packet()
        receipt=self.r.receive(io.BytesIO(packet),self.policy,executor=lambda *args:calls.append(args[0]['sha']),now=200)
        self.assertEqual(receipt['status'],'executor-success');self.assertEqual(calls,[self.sha])
        with self.assertRaisesRegex(ValueError,'Duplicate'):
            self.r.receive(io.BytesIO(packet),self.policy,executor=lambda *a:calls.append('bad'),now=200)
        self.assertEqual(calls,[self.sha])

    def test_failure_consumes_version_and_never_rolls_back(self):
        calls=[];packet=self.packet()
        def fail(*args): calls.append('deploy');raise RuntimeError('synthetic execution failure')
        with self.assertRaises(RuntimeError): self.r.receive(io.BytesIO(packet),self.policy,executor=fail,now=200)
        self.assertEqual(calls,['deploy'])
        receipt=json.loads((self.state/'pda-version-2.3.4.json').read_text())
        self.assertEqual(receipt['status'],'failed-needs-operator')
        with self.assertRaises(ValueError): self.r.receive(io.BytesIO(packet),self.policy,executor=fail,now=200)
        self.assertEqual(calls,['deploy'])

    def test_mismatched_run_sha_and_tampered_whole_package_never_execute(self):
        calls=[]
        for claims in [dict(self.claims,run_id='124'),dict(self.claims,actor_id='999')]:
            with self.assertRaises(ValueError): self.r.receive(io.BytesIO(self.packet(claims=claims)),self.policy,executor=lambda *a:calls.append(1),now=200)
        packet=self.packet();packet=packet[:-100]+bytes([packet[-100]^1])+packet[-99:]
        with self.assertRaises(ValueError): self.r.receive(io.BytesIO(packet),self.policy,executor=lambda *a:calls.append(1),now=200)
        self.assertEqual(calls,[])

    def test_concurrent_duplicate_uses_real_flock(self):
        import threading
        entered=threading.Event();release=threading.Event();packet=self.packet();calls=[]
        def executor(*args):
            calls.append('only-once');entered.set();self.assertTrue(release.wait(10))
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            first=pool.submit(self.r.receive,io.BytesIO(packet),self.policy,executor,200)
            self.assertTrue(entered.wait(10))
            with self.assertRaisesRegex(ValueError,'Another release'):
                self.r.receive(io.BytesIO(packet),self.policy,executor,200)
            release.set();self.assertEqual(first.result()['status'],'executor-success')
        self.assertEqual(calls,['only-once'])

    def test_insufficient_space_and_preserved_config_changes_stop(self):
        packet=self.packet();calls=[]
        with self.assertRaisesRegex(ValueError,'Insufficient'):
            self.r.receive(io.BytesIO(packet),dict(self.policy,reserveBytes=10**30),executor=lambda *a:calls.append(1),now=200)
        config=self.root/'db-lock';config.write_text('approved-existing-db-pin')
        policy=dict(self.policy,preservedFiles={str(config):'e'*64})
        with self.assertRaisesRegex(ValueError,'Compose/lock'):
            self.r.receive(io.BytesIO(packet),policy,executor=lambda *a:calls.append(1),now=200)
        self.assertEqual(calls,[])

    def test_ssh_command_allowlist_runs_real_wrapper_without_sudo(self):
        wrapper=TOOLS/'ssh-receive.sh'
        for command in ('id','bash','scp -t /tmp/x','receive-v1; id','receive-v1 extra',''):
            result=subprocess.run(['/bin/sh',str(wrapper)],env=dict(PATH='/nonexistent',SSH_ORIGINAL_COMMAND=command),capture_output=True)
            self.assertNotEqual(result.returncode,0)
            self.assertIn(b'outside release allowlist',result.stderr)




    def test_preexisting_release_baseline_blocks_same_version_and_pda_code(self):
        self.assertTrue(hasattr(self.r,'validate_release_version'),'existing release baseline must be enforced')
        baseline=self.root/'baseline.json'
        baseline.write_text(json.dumps(dict(status='operator-verified-baseline',sha=self.sha,version='2.3.4',pdaVersionCode=987,imageIds={'backend':'sha256:'+'a'*64,'frontend':'sha256:'+'b'*64})))
        policy=dict(self.policy,initialBaselineFile=str(baseline))
        for meta in (dict(self.meta,kind='browser'),dict(self.meta)):
            with self.assertRaises(ValueError):self.r.validate_release_version(meta,policy)
        baseline.unlink()
        with self.assertRaises((ValueError,OSError)):self.r.validate_release_version(dict(self.meta),policy)


    def test_sigkill_leaves_durable_global_block_for_other_versions(self):
        import signal
        policy=self.root/'policy.json';policy.write_text(json.dumps(self.policy))
        packet=self.root/'packet.bin';packet.write_bytes(self.packet())
        driver=self.root/'crash.py'
        driver.write_text('import sys,json,os,signal\nsys.path.insert(0,'+repr(str(TOOLS))+')\nimport receive\nwith open('+repr(str(packet))+',"rb") as stream:receive.receive(stream,json.load(open('+repr(str(policy))+')),executor=lambda *a:os.kill(os.getpid(),signal.SIGKILL),now=200)\n')
        result=subprocess.run([sys.executable,str(driver)],capture_output=True,timeout=10)
        self.assertEqual(result.returncode,-signal.SIGKILL)
        marker=self.state/'recovery-required.json'
        self.assertTrue(marker.exists(),'global in-flight marker must survive an uncatchable crash')
        self.assertEqual(json.loads(marker.read_text())['status'],'running')
        # Another fully valid version/run must not proceed after a crash.
        self.sha='c'*40;self.meta.update(sha=self.sha,version='3.0.0',versionCode=988,runId='124')
        checks=json.loads(self.files['checks.json'])
        for check in checks:check['sha']=self.sha
        self.files['checks.json']=json.dumps(checks).encode()
        self.files['source-locks.json']=json.dumps(dict(sha=self.sha,locks={n:'c'*64 for n in ('backend','frontend','desktop','scripts/browser-smoke')})).encode()
        self.files['version.json']=b'{"version":"3.0.0","versionCode":988}'
        (self.state/'browser-current.json').write_text(json.dumps(dict(status='executor-success',sha=self.sha,version='3.0.0',imageIds={'backend':'sha256:'+'a'*64,'frontend':'sha256:'+'b'*64})))
        calls=[]
        with self.assertRaisesRegex(ValueError,'Previous failure'):
            self.r.receive(io.BytesIO(self.packet(claims=dict(self.claims,run_id='124'))),self.policy,executor=lambda *a:calls.append(1),now=200)
        self.assertEqual(calls,[])


class DockerArchiveContract(unittest.TestCase):
    def test_exported_config_identities_tags_and_paths(self):
        import protocol as p
        with tempfile.TemporaryDirectory() as temp:
            archive=Path(temp)/'images.tar.gz';sha='a'*40
            def build(change=None):
                files={};manifest=[];ids={}
                for service in ('backend','frontend'):
                    raw=json.dumps({'config':{'Labels':{'org.opencontainers.image.revision':sha,'io.flowcube.quantity-return-cash-contract':'1'}}}).encode()+service.encode()*0
                    if service=='frontend': raw+=b' '
                    filename=p.digest_bytes(raw)+'.json';files[filename]=raw;ids[service]='sha256:'+p.digest_bytes(raw)
                    manifest.append(dict(Config=filename,RepoTags=['flowcube-'+service+':'+sha],Layers=[]))
                if change=='tags':manifest[0]['RepoTags']=['mysql:other']
                if change=='identity':ids['backend']='sha256:'+'f'*64
                files['manifest.json']=json.dumps(manifest).encode()
                with tarfile.open(archive,'w:gz') as tar:
                    for name,raw in files.items():
                        item=tarfile.TarInfo('../escape' if change=='path' and name=='manifest.json' else name);item.size=len(raw);tar.addfile(item,io.BytesIO(raw))
                return ids
            ids=build();p.verify_docker_archive(archive,sha,ids)
            for mode in ('tags','identity','path'):
                ids=build(mode)
                with self.subTest(mode=mode),self.assertRaises(ValueError):p.verify_docker_archive(archive,sha,ids)


class PackagingContract(unittest.TestCase):
    @staticmethod
    def module(name):
        spec=importlib.util.spec_from_file_location(name,TOOLS/(name+'.py'))
        result=importlib.util.module_from_spec(spec);spec.loader.exec_module(result);return result

    def test_two_parameterized_versions_package_source_locks_and_smoke_inputs(self):
        import protocol as p
        maker=self.module('make-bundle');verifier=self.module('verify-local')
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);source=root/'source';source.mkdir()
            def git(*args):return subprocess.check_output(['git','-C',str(source),*args],stderr=subprocess.DEVNULL).decode().strip()
            git('init','-b','main');git('config','user.name','Synthetic');git('config','user.email','synthetic@example.invalid')
            for sequence,version in enumerate(('3.2.1','7.6.5'),1):
                for name in ('backend','frontend','desktop','scripts/browser-smoke'):
                    directory=source/name;directory.mkdir(parents=True,exist_ok=True)
                    (directory/'package.json').write_text(json.dumps(dict(version=version)))
                    (directory/'package-lock.json').write_text(json.dumps(dict(version=version,packages={})))
                apk=source/'backend/apk';apk.mkdir(exist_ok=True)
                metadata=dict(version=version,versionCode=sequence);(apk/'version.json').write_text(json.dumps(metadata))
                git('add','backend','frontend','desktop','scripts');git('commit','-m','synthetic '+version)
                sha=git('rev-parse','HEAD');payload=root/('payload'+str(sequence));payload.mkdir()
                (payload/'app.apk').write_bytes(b'synthetic signed apk');(payload/'version.json').write_text(json.dumps(metadata))
                checks=[dict(workflow=w,sha=sha,conclusion='success',event='push',branch='main',runId=12,allJobsPassed=True,**({'auditTargets':['backend','desktop','frontend','scripts/browser-smoke']} if w=='security-scan.yml' else {})) for w in ('test.yml','security-scan.yml')]
                evidence=root/'checks.json';evidence.write_text(json.dumps(dict(checks=checks,approval=dict(commentId='7',backupCommentId='6',operatorId='789',backupReceiptSha256='e'*64,approvalTime='2026-01-01T00:00:01.000Z',backupTime='2026-01-01T00:00:00.000Z'))))
                env=dict(GITHUB_ACTIONS='true',TARGET_SHA=sha,GITHUB_RUN_ID='123',GITHUB_RUN_ATTEMPT='1',GITHUB_ACTOR_ID='456',GITHUB_WORKFLOW_SHA='b'*40)
                bundle=root/('bundle'+str(sequence)+'.tar')
                made=maker.make_bundle('pda',source,payload,evidence,bundle,env)
                self.assertEqual(made['version'],version)
                previous=Path.cwd()
                try:
                    os.chdir(source)
                    result=verifier.verify_local(bundle,root/('out'+str(sequence)),evidence,env)
                    self.assertEqual(result['sha'],sha)
                    with self.assertRaises(ValueError):verifier.verify_local(bundle,root/('bad'+str(sequence)),evidence,dict(env,TARGET_SHA='f'*40))
                finally:os.chdir(previous)

    def test_sender_uses_parameterized_hosts_single_fixed_command_no_remote_shell(self):
        from unittest.mock import patch
        sender=self.module('send-bundle')
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);bundle=root/'bundle.tar';bundle.write_bytes(b'synthetic bundle')
            for host in ('one.example.invalid','two.example.invalid'):
                work=root/host;work.mkdir();calls=[]
                class FakeProcess:
                    def __init__(self,args,**kw):calls.append(args);self.stdin=io.BytesIO()
                    def wait(self,**kw):return 0
                    def poll(self):return 0
                class Response:
                    def __enter__(self):return io.StringIO('{"value":"synthetic-token"}')
                    def __exit__(self,*a):pass
                env=dict(GITHUB_ACTIONS='true',GITHUB_EVENT_NAME='workflow_dispatch',GITHUB_REF='refs/heads/main',GITHUB_RUN_ATTEMPT='1',FLOWCUBE_SSH_HOST=host,FLOWCUBE_RELEASE_USER='release_fixture',FLOWCUBE_SSH_PORT='2222',FLOWCUBE_RELEASE_SSH_KEY='synthetic-not-a-private-key',FLOWCUBE_SSH_KNOWN_HOSTS='synthetic-public-trust',ACTIONS_ID_TOKEN_REQUEST_URL='https://oidc.actions.githubusercontent.com/token',ACTIONS_ID_TOKEN_REQUEST_TOKEN='synthetic-only',RUNNER_TEMP=str(work))
                with patch.object(sender.urllib.request,'urlopen',return_value=Response()),patch.object(sender.subprocess,'Popen',FakeProcess):sender.send_bundle(bundle,env)
                self.assertEqual(len(calls),1);self.assertEqual(calls[0][-2:],['release_fixture@'+host,'receive-v1'])
                self.assertIn('StrictHostKeyChecking=yes',calls[0]);self.assertIn('ServerAliveInterval=30',calls[0]);self.assertIn('ControlMaster=auto',calls[0])
                self.assertFalse((work/'manual-release-ssh/key').exists())
                self.assertFalse(any('scp'==value or 'bash'==value for value in calls[0]))


class ChildProcessContract(unittest.TestCase):
    def test_receiver_termination_stops_the_whole_child_group(self):
        import receive
        self.assertTrue(hasattr(receive,'run_owned'),'receiver must own and stop entire process groups')
        import signal
        import time
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);started=root/'started';finished=root/'must-not-finish'
            driver=root/'driver.py'
            driver.write_text('import sys,signal\nsys.path.insert(0,'+repr(str(TOOLS))+')\nfrom receive import run_owned\ndef stop(*args):raise RuntimeError("synthetic interruption")\nsignal.signal(signal.SIGTERM,stop)\nrun_owned(["timeout","5","bash","-c",'+repr('echo $$ > '+str(started)+'; sleep 1; touch '+str(finished))+'])\n')
            process=subprocess.Popen([sys.executable,str(driver)],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
            try:
                deadline=time.monotonic()+5
                while not started.exists() and time.monotonic()<deadline:time.sleep(.01)
                self.assertTrue(started.exists())
                process.send_signal(signal.SIGTERM);process.communicate(timeout=10)
                time.sleep(1.2)
                self.assertFalse(finished.exists())
                with self.assertRaises(ProcessLookupError):os.kill(int(started.read_text()),0)
            finally:
                if process.poll() is None:process.kill();process.wait()


if __name__ == '__main__': unittest.main()
