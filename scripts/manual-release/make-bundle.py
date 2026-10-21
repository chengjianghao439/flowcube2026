#!/usr/bin/env python3
"""GitHub runner only. Package immutable source metadata plus exact build bytes."""
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tarfile
from protocol import (BROWSER_FILES, PDA_FILES, digest_file, digest_bytes, json_bytes,
                      regular, require, validate_manifest, verify_bundle)


def make_bundle(kind, source_dir, payload_dir, checks_file, output, env):
    require(env.get('GITHUB_ACTIONS') == 'true', 'Build packaging requires GitHub Actions')
    source, payload = Path(source_dir), Path(payload_dir)
    sha = env.get('TARGET_SHA', '')
    def git(*args):
        return subprocess.check_output(['git', '-C', str(source), *args])
    require(git('rev-parse', 'HEAD').decode().strip() == sha, 'Source SHA mismatch')
    def original(name): return git('show', sha + ':' + name)
    packages = [json_bytes(original(n + '/package.json')) for n in ('backend', 'frontend', 'desktop')]
    version = packages[0]['version']
    require(all(p['version'] == version for p in packages), 'Application versions are inconsistent')
    evidence = json_bytes(regular(checks_file).read_bytes())
    meta = dict(schema=1, kind=kind, sha=sha, version=version, workflowSha=env['GITHUB_WORKFLOW_SHA'],
                runId=env['GITHUB_RUN_ID'], runAttempt=env['GITHUB_RUN_ATTEMPT'], actorId=env['GITHUB_ACTOR_ID'],
                approval=evidence['approval'])
    temporary = payload / 'source-locks.json'
    locks = {n: digest_bytes(original(n + '/package-lock.json')) for n in ('backend', 'frontend', 'desktop', 'scripts/browser-smoke')}
    temporary.write_text(json.dumps(dict(sha=sha, locks=locks))+'\n')
    (payload / 'checks.json').write_text(json.dumps(evidence['checks'])+'\n')
    if kind == 'browser':
        with (payload / 'scripts.tar').open('wb') as target:
            subprocess.run(['git', '-C', str(source), 'archive', '--format=tar', sha, 'scripts', 'frontend/src/pages/pda', 'frontend/src/router/routeRegistry.ts'], stdout=target, check=True)
        files = BROWSER_FILES
    else:
        pda = json_bytes(original('backend/apk/version.json'))
        require(pda['version'] == version, 'PDA/application version mismatch')
        require(json_bytes((payload/'version.json').read_bytes()) == pda, 'Built PDA metadata differs from selected SHA')
        meta['versionCode'] = pda['versionCode']
        files = PDA_FILES
    meta['files'] = {n: dict(size=regular(payload/n).stat().st_size, sha256=digest_file(payload/n)) for n in sorted(files)}
    validate_manifest(meta)
    output = Path(output)
    with tarfile.open(output, 'w', format=tarfile.USTAR_FORMAT) as tar:
        raw = (json.dumps(meta, sort_keys=True)+'\n').encode()
        item = tarfile.TarInfo('manifest.json'); item.size=len(raw); item.mode=0o600
        tar.addfile(item, io.BytesIO(raw))
        for name in sorted(files):
            item = tarfile.TarInfo(name); item.size=meta['files'][name]['size']; item.mode=0o600
            with regular(payload/name).open('rb') as data: tar.addfile(item, data)
    print(json.dumps(dict(sha=sha, kind=kind, sha256=digest_file(output))))
    return meta


if __name__ == '__main__':
    try: make_bundle(*sys.argv[1:], os.environ)
    except Exception:
        print('::error::Release bundle creation failed; no publish authorized', file=sys.stderr)
        sys.exit(1)
