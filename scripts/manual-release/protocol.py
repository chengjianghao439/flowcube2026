"""Fail-closed, offline release envelope validation. No network or deployment calls."""
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import tarfile
import tempfile
import time

SHA = re.compile(r'[a-f0-9]{40}')
DIGEST = re.compile(r'[a-f0-9]{64}')
VERSION = re.compile(r'[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?')
BROWSER_FILES = {'images.tar.gz', 'scripts.tar', 'source-locks.json', 'checks.json',
                 'backend.image-id', 'frontend.image-id', 'backend.sbom.json',
                 'frontend.sbom.json', 'provenance.json'}
PDA_FILES = {'app.apk', 'version.json', 'checks.json', 'source-locks.json'}


def require(ok, message):
    if not ok:
        raise ValueError(message)


def digest_bytes(content):
    return hashlib.sha256(content).hexdigest()


def digest_file(path):
    result = hashlib.sha256()
    with open(path, 'rb') as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b''):
            result.update(chunk)
    return result.hexdigest()


def json_bytes(raw):
    def unique(items):
        result = {}
        for key, value in items:
            require(key not in result, 'Duplicate JSON field')
            result[key] = value
        return result
    return json.loads(raw, object_pairs_hook=unique)


def regular(path):
    path = Path(path)
    info = path.lstat()
    require(stat.S_ISREG(info.st_mode) and not path.is_symlink(), 'Expected regular file')
    return path


def validate_manifest(meta):
    require(isinstance(meta, dict) and meta.get('schema') == 1, 'Invalid manifest schema')
    require(SHA.fullmatch(str(meta.get('sha', ''))) is not None, 'Full target SHA required')
    require(SHA.fullmatch(str(meta.get('workflowSha', ''))) is not None, 'Full workflow SHA required')
    require(VERSION.fullmatch(str(meta.get('version', ''))) is not None, 'Invalid version')
    for key in ('runId', 'actorId'):
        require(re.fullmatch(r'[1-9][0-9]*', str(meta.get(key, ''))) is not None, 'Invalid run identity')
    require(meta.get('runAttempt') == '1', 'Reruns forbidden; new dispatch required')
    require(meta.get('kind') in ('browser', 'pda'), 'Unsupported release kind')
    if meta['kind'] == 'pda':
        require(type(meta.get('versionCode')) is int and 0 < meta['versionCode'] <= 2147483647, 'Invalid PDA versionCode')
    approval = meta.get('approval', {})
    require(isinstance(approval, dict) and set(approval) == {'commentId', 'backupCommentId', 'operatorId', 'backupReceiptSha256', 'approvalTime', 'backupTime'}, 'Missing verified human approval identity')
    for key in ('commentId', 'backupCommentId', 'operatorId'):
        require(re.fullmatch(r'[1-9][0-9]*', str(approval[key])) is not None, 'Invalid approval identity')
    require(DIGEST.fullmatch(str(approval['backupReceiptSha256'])) is not None, 'Invalid backup receipt reference')
    expected = BROWSER_FILES if meta['kind'] == 'browser' else PDA_FILES
    require(isinstance(meta.get('files'), dict) and set(meta['files']) == expected, 'Unexpected or missing payload')
    for record in meta['files'].values():
        require(isinstance(record, dict) and type(record.get('size')) is int and 0 < record['size'] <= 4 * 1024**3,
                'Invalid file size')
        require(DIGEST.fullmatch(str(record.get('sha256', ''))) is not None, 'Invalid file digest')
    return meta


def validate_checks(checks, sha):
    require(isinstance(checks, list) and {c.get('workflow') for c in checks} == {'test.yml', 'security-scan.yml'}, 'Missing GitHub gates')
    for check in checks:
        require(check.get('sha') == sha and check.get('conclusion') == 'success'
                and check.get('event') in ('push', 'workflow_dispatch', 'schedule') and check.get('branch') == 'main'
                and type(check.get('runId')) is int and check['runId'] > 0, 'GitHub gate identity mismatch')
        require(check.get('allJobsPassed') is True, 'GitHub jobs did not pass')
    security = next(c for c in checks if c['workflow'] == 'security-scan.yml')
    require(security.get('auditTargets') == ['backend', 'desktop', 'frontend', 'scripts/browser-smoke'], 'npm audit gate missing')


def verify_bundle(archive, destination):
    """Validate entire flat tar before extracting any payload; no tar.extract/extractall."""
    archive = regular(archive)
    destination = Path(destination)
    with tarfile.open(archive, mode='r:') as tar:
        entries = {}
        for item in tar:
            require(item.isfile() and not item.pax_headers and '/' not in item.name
                    and re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]*', item.name) is not None
                    and item.name not in entries, 'Unsafe archive entry')
            limit = 4 * 1024**3 if item.name == 'images.tar.gz' else 256 * 1024**2 if item.name == 'app.apk' else 32 * 1024**2 if item.name.endswith('.sbom.json') else 16 * 1024**2 if item.name == 'scripts.tar' else 2 * 1024**2
            require(0 < item.size <= limit and len(entries) < 16, 'Archive size/count limit')
            entries[item.name] = item
        require('manifest.json' in entries and entries['manifest.json'].size < 65536, 'Missing or oversized manifest')
        meta = validate_manifest(json_bytes(tar.extractfile(entries['manifest.json']).read()))
        require(set(entries) == {'manifest.json', *meta['files']}, 'Archive file set mismatch')
        for name, record in meta['files'].items():
            item = entries[name]
            require(item.size == record['size'], 'File size mismatch')
            checksum = hashlib.sha256()
            with tar.extractfile(item) as source:
                for chunk in iter(lambda: source.read(1024 * 1024), b''):
                    checksum.update(chunk)
            require(checksum.hexdigest() == record['sha256'], 'File digest mismatch')
        checks = json_bytes(tar.extractfile(entries['checks.json']).read())
        validate_checks(checks, meta['sha'])
        locks = json_bytes(tar.extractfile(entries['source-locks.json']).read())
        require(locks.get('sha') == meta['sha'] and set(locks.get('locks', {})) ==
                {'backend', 'frontend', 'desktop', 'scripts/browser-smoke'}, 'Source lock identity mismatch')
        for value in locks['locks'].values():
            require(isinstance(value, str) and DIGEST.fullmatch(value) is not None, 'Invalid source lock digest')
        if meta['kind'] == 'pda':
            version = json_bytes(tar.extractfile(entries['version.json']).read())
            require(version.get('version') == meta['version'] and version.get('versionCode') == meta['versionCode'], 'PDA metadata mismatch')
        destination.mkdir(mode=0o700, parents=False, exist_ok=False)
        for name, item in entries.items():
            with destination.joinpath(name).open('xb') as output, tar.extractfile(item) as source:
                os.chmod(destination / name, 0o600)
                for chunk in iter(lambda: source.read(1024 * 1024), b''):
                    output.write(chunk)
    return meta


def unpack_scripts(archive, destination):
    """Target smoke scripts only; never execute bundled server-update/release-gate."""
    with tarfile.open(regular(archive), 'r:') as tar:
        entries = list(tar)
        seen = set()
        require(len(entries) <= 2000 and sum(i.size for i in entries) <= 32 * 1024**2, 'Script archive limit')
        for item in entries:
            parts = Path(item.name).parts
            allowed = parts and (parts[0] == 'scripts' or item.name.rstrip('/') in ('frontend', 'frontend/src', 'frontend/src/pages', 'frontend/src/pages/pda', 'frontend/src/router') or item.name.startswith('frontend/src/pages/pda/') or item.name == 'frontend/src/router/routeRegistry.ts')
            require(allowed and not Path(item.name).is_absolute()
                    and '..' not in parts and item.name not in seen
                    and (item.isfile() or item.isdir()), 'Unsafe scripts archive')
            # git archive adds its commit comment as a global PAX header; individual links remain forbidden.
            seen.add(item.name)
        root = Path(destination); root.mkdir(mode=0o700)
        for item in entries:
            target = root / item.name
            if item.isdir(): target.mkdir(mode=0o700, parents=True, exist_ok=True)
            else:
                target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
                with target.open('xb') as output, tar.extractfile(item) as source:
                    output.write(source.read())
                target.chmod(0o600)


def verify_oidc(token, archive_digest, policy, signature_dir, now=None):
    """RS256 with operator-pinned GitHub issuer keys; never fetch trust material."""
    require(isinstance(token, str) and len(token) <= 20000 and token.count('.') == 2, 'Invalid identity token')
    parts = token.split('.')
    def decode(value):
        require(re.fullmatch(r'[A-Za-z0-9_-]+', value) is not None, 'Invalid token encoding')
        return base64.urlsafe_b64decode(value + '=' * (-len(value) % 4))
    header, claims = (json_bytes(decode(p)) for p in parts[:2])
    require(header.get('alg') == 'RS256' and header.get('typ') == 'JWT', 'Unapproved signature algorithm')
    key = policy.get('oidcKeys', {}).get(header.get('kid'))
    require(key is not None, 'Unknown issuer key; operator trust refresh required')
    key = regular(key)
    with tempfile.TemporaryDirectory(prefix='signature-', dir=signature_dir) as temp:
        signature = Path(temp) / 'signature'; signature.write_bytes(decode(parts[2]))
        verified = subprocess.run(['openssl', 'dgst', '-sha256', '-verify', str(key), '-signature', str(signature)],
                                  input=(parts[0] + '.' + parts[1]).encode(), capture_output=True, timeout=10)
        require(verified.returncode == 0, 'Invalid GitHub signature')
    now = int(time.time()) if now is None else now
    require(all(type(claims.get(n)) is int for n in ('exp', 'nbf', 'iat'))
            and claims['nbf'] <= now < claims['exp'] and claims['iat'] <= now
            and 0 < claims['exp'] - claims['iat'] <= 600, 'Expired or invalid token time')
    expected = {'iss': 'https://token.actions.githubusercontent.com',
                'aud': 'urn:flowcube-release:v1:' + archive_digest,
                'repository': policy['repository'], 'repository_id': policy['repositoryId'],
                'repository_owner_id': policy['ownerId'], 'sub': policy['subject'],
                'environment': policy['environment'], 'ref': 'refs/heads/main',
                'event_name': 'workflow_dispatch', 'run_attempt': '1', 'runner_environment': 'github-hosted'}
    require(all(claims.get(k) == v for k, v in expected.items()), 'Untrusted workflow identity')
    require(claims.get('actor_id') in policy['actorIds'], 'Dispatch actor is not authorized')
    workflow = claims.get('workflow_ref', '')
    require(workflow in policy['workflowShas'] and claims.get('workflow_sha') in policy['workflowShas'][workflow],
            'Workflow code is not approved')
    require(re.fullmatch(r'[1-9][0-9]*', claims.get('run_id', '')) is not None, 'Invalid workflow run')
    return claims


def bind_identity(meta, claims, policy):
    require(meta['runId'] == claims['run_id'] and meta['runAttempt'] == claims['run_attempt']
            and meta['actorId'] == claims['actor_id'] and meta['workflowSha'] == claims['workflow_sha'], 'Bundle/run identity mismatch')
    workflow_file = 'deploy-browser.yml' if meta['kind'] == 'browser' else 'build-pda-apk.yml'
    require(claims['workflow_ref'] == policy['repository'] + '/.github/workflows/' + workflow_file + '@refs/heads/main', 'Wrong release workflow')


def verify_docker_archive(archive, sha, image_ids):
    """Inspect exported Docker config identities/tags before docker load can change tags."""
    with tarfile.open(regular(archive), 'r:gz') as tar:
        members={};total=0
        for member in tar:
            parts=Path(member.name).parts
            require(not Path(member.name).is_absolute() and '..' not in parts and parts
                    and all(re.fullmatch(r'[A-Za-z0-9_.-]+', p) for p in parts)
                    and (member.isfile() or member.isdir()) and member.name not in members, 'Unsafe Docker archive')
            total+=member.size
            require(total <= 8*1024**3 and len(members)<10000, 'Docker archive expansion limit')
            members[member.name]=member
        require('manifest.json' in members and members['manifest.json'].size<65536,'Missing Docker image manifest')
        manifest=json_bytes(tar.extractfile(members['manifest.json']).read())
        require(isinstance(manifest,list) and len(manifest)==2,'Expected exactly two application images')
        seen=set()
        for record in manifest:
            tags=record.get('RepoTags')
            service=next((n for n in ('backend','frontend') if tags==['flowcube-'+n+':'+sha]),None)
            require(service is not None and service not in seen,'Unexpected Docker image tags')
            seen.add(service)
            config=members.get(record.get('Config',''))
            require(config is not None and config.isfile() and config.size<2*1024**2,'Missing Docker image config')
            raw=tar.extractfile(config).read()
            require('sha256:'+digest_bytes(raw)==image_ids[service],'Docker image config identity mismatch')
            labels=json_bytes(raw).get('config',{}).get('Labels',{})
            require(labels.get('org.opencontainers.image.revision')==sha,'Docker revision mismatch')
            if service=='backend':
                require(labels.get('io.flowcube.quantity-return-cash-contract')=='1','Target write contract missing')
