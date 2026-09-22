#!/usr/bin/env python3
"""Opt-in local transport for original, same-commit GitHub Actions artifacts.

Requires gh, Node, curl and OpenSSH. No cloud SDK or persistent service.
Credentials and signed URLs stay in memory/stdin, never in command logs.
"""
import concurrent.futures
import hashlib
import json
import os
import pathlib
import re
import shlex
import shutil
import signal
import stat
import subprocess
import tempfile
import time
import threading
import zipfile

WORKFLOWS = {'image': 'deploy-browser.yml', 'pda': 'build-pda-apk.yml', 'desktop': 'build-desktop.yml'}
MAX_ZIP = 2 * 1024**3
MAX_FILE = 1024**3


def select_run(runs, sha, kind, version):
    branch = 'v' + version if kind == 'desktop' else 'main'
    matches = [r for r in runs if r.get('head_sha') == sha and r.get('head_branch') == branch
               and r.get('event') == 'push' and r.get('path') == '.github/workflows/' + WORKFLOWS[kind]]
    return max(matches, key=lambda r: (int(r['id']), int(r.get('run_attempt', 1)))) if matches else None


def artifact_spec(kind, run, version):
    if not re.fullmatch(r'\d+\.\d+\.\d+', version):
        raise ValueError('Invalid version')
    run_id, attempt = str(run['id']), str(run['run_attempt'])
    if not re.fullmatch(r'[1-9]\d*', run_id) or not re.fullmatch(r'[1-9]\d*', attempt):
        raise ValueError('Invalid run identity')
    if kind == 'image':
        return ('deploy-images-' + run_id + '-' + attempt, 'flowcube-images.tar.gz',
                '/tmp/flowcube-images-' + run_id + '-' + attempt + '.tar.gz')
    if kind == 'pda':
        return ('flowcube-pda-apk', 'FlowCubePDA-' + version + '.apk', '/tmp/flowcube-pda-' + run_id + '-' + attempt + '.apk')
    if kind == 'desktop':
        entry = 'Jixu-Flow-Setup-' + version + '.exe'
        return ('FlowCube-Desktop-Setup', entry, '/tmp/flowcube-desktop-release/v' + version + '/' + entry)
    raise ValueError('Invalid artifact kind')


def validate_artifact(artifact, run):
    identity = artifact.get('workflow_run') or {}
    if (artifact.get('expired') or not isinstance(artifact.get('size_in_bytes'), int)
            or not 0 < artifact['size_in_bytes'] <= MAX_ZIP
            or not re.fullmatch(r'sha256:[0-9a-f]{64}', artifact.get('digest') or '')
            or identity.get('id') != run['id'] or identity.get('head_sha') != run['head_sha']):
        raise ValueError('Artifact identity, size or digest invalid')
    # A same-name artifact left by an earlier attempt must never be relayed.
    if run.get('run_started_at') and (artifact.get('created_at') or '') < run['run_started_at']:
        raise ValueError('Artifact belongs to an earlier attempt')


def file_sha(path):
    digest = hashlib.sha256()
    with path.open('rb') as source:
        for block in iter(lambda: source.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def verify_extract(archive, artifact, entry, directory):
    if archive.stat().st_size != artifact['size_in_bytes'] or 'sha256:' + file_sha(archive) != artifact['digest']:
        raise ValueError('GitHub ZIP size/digest mismatch')
    target = directory / entry
    with zipfile.ZipFile(archive) as source:
        members = source.infolist()
        if (len(members) != 1 or members[0].filename != entry or members[0].is_dir()
                or stat.S_ISLNK(members[0].external_attr >> 16) or not 0 < members[0].file_size <= MAX_FILE):
            raise ValueError('Unexpected ZIP member')
        with source.open(members[0]) as src, target.open('xb') as dest:
            shutil.copyfileobj(src, dest)
    return target


def download_ranges(size, directory, url_provider, fetch_range, chunk=2*1024*1024, workers=32):
    if not 0 < size <= MAX_ZIP:
        raise ValueError('Invalid ZIP size')
    count = (size + chunk - 1) // chunk
    # Keep workers occupied when a range is slow. Cache signed URLs for at most
    # 30s (GitHub redirects expire after 60s), refresh once across concurrent retries.
    lock = threading.Lock()
    cache = {'url': None, 'at': 0}
    def signed_url(previous=None):
        with lock:
            if not cache['url'] or time.monotonic() - cache['at'] >= 30 or previous == cache['url']:
                cache['url'] = url_provider()
                cache['at'] = time.monotonic()
            return cache['url']
    def fetch(index):
        lo, hi = index * chunk, min(size - 1, (index + 1) * chunk - 1)
        part = directory / ('range-' + str(index))
        previous = None
        for attempt in range(3):
            url = signed_url(previous)
            try:
                fetch_range(url, lo, hi, part)
                if part.stat().st_size == hi - lo + 1:
                    return index
            except (RuntimeError, OSError, subprocess.SubprocessError):
                pass
            previous = url
        raise RuntimeError('Artifact range download failed after bounded retries')
    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
        futures = [pool.submit(fetch, index) for index in range(count)]
        for completed, future in enumerate(concurrent.futures.as_completed(futures), 1):
            future.result()
            if completed % 16 == 0 or completed == count:
                print('relay: ranges ' + str(completed) + '/' + str(count), flush=True)
    archive = directory / 'artifact.zip'
    with archive.open('xb') as dest:
        for index in range(count):
            part = directory / ('range-' + str(index))
            with part.open('rb') as src:
                shutil.copyfileobj(src, dest)
            part.unlink()
    return archive


class Relay:
    def __init__(self, env):
        self.repo = env.get('GITHUB_REPOSITORY', '')
        self.sha = env.get('GITHUB_SHA', '')
        self.version = env.get('RELEASE_TAG', '')[1:]
        self.target = env.get('FLOWCUBE_RELAY_SSH_TARGET', '')
        self.proxy = env.get('FLOWCUBE_RELAY_PROXY', '')
        if (not re.fullmatch(r'[\w.-]+/[\w.-]+', self.repo) or not re.fullmatch(r'[0-9a-f]{40}', self.sha)
                or not re.fullmatch(r'\d+\.\d+\.\d+', self.version)
                or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.@-]*', self.target)):
            raise ValueError('Missing/invalid relay repository, SHA, tag or SSH target')
        self.temp = tempfile.TemporaryDirectory(prefix='flowcube-relay-', dir='/tmp')
        self.root = pathlib.Path(self.temp.name)
        self.options = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '-o', 'ControlMaster=auto',
                        '-o', 'ControlPath=' + str(self.root / 'ssh-%C'), '-o', 'ControlPersist=60']
        self.owned = set()

    def command(self, args, timeout=60, **kwargs):
        result = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout, **kwargs)
        if result.returncode:
            # subprocess errors may include a signed URL or a credential; never echo them.
            raise RuntimeError('Relay command failed: ' + args[0])
        return result.stdout

    def api(self, path):
        for attempt in range(3):
            try:
                return json.loads(self.command(['gh', 'api', 'repos/' + self.repo + '/' + path]))
            except (RuntimeError, OSError, ValueError, subprocess.SubprocessError):
                if attempt == 2:
                    raise RuntimeError('GitHub API unavailable after bounded retries') from None
                time.sleep(2 ** attempt)

    def ssh(self, command):
        return self.command(['ssh'] + self.options + [self.target, command])

    def preflight(self):
        for binary in ['gh', 'node', 'curl', 'ssh', 'scp']:
            if not shutil.which(binary):
                raise RuntimeError('Missing relay tool: ' + binary)
        self.ssh('true')
        print('relay: preflight passed; target SHA ' + self.sha, flush=True)

    def fetch(self, url, lo, hi, dest):
        args = ['curl', '--config', '-', '--silent', '--fail', '--location', '--proto', '=https', '--proto-redir', '=https',
                '--range', str(lo) + '-' + str(hi), '--connect-timeout', '10', '--max-time', '75',
                '--output', str(dest), '--write-out', '%{http_code}']
        if self.proxy:
            args += ['--proxy', self.proxy, '--noproxy', '']
        result = self.command(args, timeout=80, input=('url = ' + json.dumps(url) + '\n').encode())
        if result != b'206':
            raise RuntimeError('Range request did not return HTTP 206')

    def current_run(self, run, kind):
        current = self.api('actions/runs/' + str(run['id']))
        if select_run([current], self.sha, kind, self.version) is None or current['run_attempt'] != run['run_attempt']:
            raise RuntimeError('Run identity/attempt changed during relay')
        if current['status'] == 'completed':
            if current['conclusion'] == 'success':
                return None
            raise RuntimeError('Source workflow ended unsuccessfully')
        return current

    def deliver(self, kind, run, artifact):
        validate_artifact(artifact, run)
        _, entry, remote = artifact_spec(kind, run, self.version)
        if self.current_run(run, kind) is None:
            return 'direct'
        self.owned.add(remote)
        quoted = shlex.quote(remote)
        self.ssh('mkdir -p ' + shlex.quote(str(pathlib.PurePosixPath(remote).parent)) + ' && touch ' + quoted + '.relay.pending')
        started = time.monotonic()
        print('relay: downloading ' + kind + ' run=' + str(run['id']) + ' attempt=' + str(run['run_attempt']) + ' bytes=' + str(artifact['size_in_bytes']), flush=True)
        with tempfile.TemporaryDirectory(prefix=kind + '-', dir=str(self.root)) as local:
            directory = pathlib.Path(local)
            env = dict(os.environ, DEPLOY_ARTIFACT_ID=str(artifact['id']))
            def url():
                return self.command(['node', 'scripts/deploy-artifact-url.js'], env=env).decode().strip()
            archive = download_ranges(artifact['size_in_bytes'], directory, url, self.fetch)
            original = verify_extract(archive, artifact, entry, directory)
            downloaded = time.monotonic()
            if self.current_run(run, kind) is None:
                return 'direct'
            self.command(['scp', '-q'] + self.options + [str(original), self.target + ':' + remote + '.relay.partial'], timeout=180)
            if self.current_run(run, kind) is None:
                return 'direct'
            self.ssh('mv -- ' + quoted + '.relay.partial ' + quoted + '.relay')
            print('relay: ready ' + kind + ' ' + json.dumps(dict(run=run['id'], attempt=run['run_attempt'], artifact=artifact['id'],
                  bytes=original.stat().st_size, sha256=file_sha(original), download_seconds=round(downloaded-started, 1),
                  upload_seconds=round(time.monotonic()-downloaded, 1), total_seconds=round(time.monotonic()-started, 1))), flush=True)
        return 'relay'

    def watch(self):
        done = {}; sources = {}; failures = {}; deadline = time.monotonic() + 330*60
        while time.monotonic() < deadline and len(done) < 3:
            for kind in WORKFLOWS:
                if kind in done:
                    continue
                data = self.api('actions/workflows/' + WORKFLOWS[kind] + '/runs?head_sha=' + self.sha + '&event=push&per_page=100')
                run = select_run(data['workflow_runs'], self.sha, kind, self.version)
                if not run:
                    continue
                if run['status'] == 'completed':
                    if run['conclusion'] != 'success':
                        raise RuntimeError('Source workflow failed: ' + kind)
                    done[kind] = 'direct'
                    print('relay: workflow already succeeded without this relay: ' + kind, flush=True)
                    continue
                wanted, _, remote = artifact_spec(kind, run, self.version)
                matches = [a for a in self.api('actions/runs/' + str(run['id']) + '/artifacts?per_page=100')['artifacts'] if a['name'] == wanted]
                if not matches:
                    continue
                try:
                    if len(matches) != 1:
                        raise ValueError('Ambiguous artifact')
                    done[kind] = self.deliver(kind, run, matches[0])
                    sources[kind] = run
                except (RuntimeError, ValueError, OSError, subprocess.SubprocessError):
                    failures[kind] = failures.get(kind, 0) + 1
                    # Release the pending marker so the receiver can use its existing fallback.
                    self.ssh('rm -f -- ' + shlex.quote(remote) + '.relay.pending')
                    if failures[kind] >= 3:
                        raise RuntimeError('Relay exhausted retries: ' + kind)
                    print('relay: retrying ' + kind + '; attempt ' + str(failures[kind]), flush=True)
            if len(done) < 3:
                time.sleep(10)
        if len(done) != 3:
            raise RuntimeError('Relay watcher timed out')
        print('relay: delivery summary ' + json.dumps(done), flush=True)
        # Ready is not consumed: retain staging until the owning workflow finishes.
        while sources and time.monotonic() < deadline:
            for kind, run in list(sources.items()):
                if self.current_run(run, kind) is None:
                    del sources[kind]
            if sources:
                time.sleep(10)
        if sources:
            raise RuntimeError('Receiver completion timed out')
        print('relay: all receiver workflows succeeded', flush=True)

    def close(self):
        # Own exact staging paths only; published originals are never removed.
        for remote in self.owned:
            try:
                self.ssh('rm -f -- ' + ' '.join(shlex.quote(remote + suffix) for suffix in ['.relay.pending', '.relay.partial', '.relay']))
            except (RuntimeError, OSError, subprocess.SubprocessError):
                print('relay: staging cleanup incomplete for ' + remote, flush=True)
        try:
            self.command(['ssh'] + self.options + ['-O', 'exit', self.target], timeout=15)
        except (RuntimeError, OSError, subprocess.SubprocessError):
            pass
        self.temp.cleanup()


def main():
    relay = None
    def interrupted(signum, frame):
        raise KeyboardInterrupt()
    signal.signal(signal.SIGTERM, interrupted)
    try:
        relay = Relay(os.environ)
        relay.preflight()
        if os.environ.get('FLOWCUBE_RELAY_PREFLIGHT_ONLY') != '1':
            relay.watch()
        return 0
    except KeyboardInterrupt:
        return 130
    except (RuntimeError, ValueError, OSError, subprocess.SubprocessError):
        print('relay: failed; inspect workflow status and sanitized relay stages', flush=True)
        return 1
    finally:
        if relay:
            relay.close()

if __name__ == '__main__':
    raise SystemExit(main())
