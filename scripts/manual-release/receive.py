#!/usr/bin/python3 -BEs
"""Installed root-owned endpoint. No CLI arguments, network, shell or client paths."""
import fcntl
import json
import os
import re
from pathlib import Path
import shutil
import signal
import stat
import struct
import subprocess
import sys
import tempfile
import time
from protocol import (bind_identity, digest_file, json_bytes, regular, require,
                      unpack_scripts, verify_bundle, verify_oidc, verify_docker_archive)

POLICY = '/etc/flowcube-release/policy.json'
SAFE_PATH = '/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin'


def trusted(path, directory=False):
    path = Path(path)
    require(path.is_absolute() and path.resolve() == path, 'Trust path must be absolute without symlinks')
    for parent in [path, *path.parents]:
        info = parent.lstat()
        require(info.st_uid == 0 and info.st_mode & 0o022 == 0, 'Trust path must be root-owned and not writable by others')
    require(path.is_dir() if directory else path.is_file(), 'Trust path has wrong type')
    return path


def load_policy():
    policy = json_bytes(trusted(POLICY).read_bytes())
    for name in ('stateDir', 'spoolDir', 'projectDir', 'toolsDir'):
        trusted(policy[name], directory=True)
    for key in policy['oidcKeys'].values(): trusted(key)
    for key in ('envFile', 'smokeEnvFile', 'mysqlLockFile', 'initialBaselineFile'): trusted(policy[key])
    for key in ('backupDir', 'pdaDir'): trusted(policy[key], directory=True)
    require(type(policy['maxBundleBytes']) is int and 0 < policy['maxBundleBytes'] <= 4*1024**3 and type(policy['reserveBytes']) is int and policy['reserveBytes'] >= 6*1024**3, 'Invalid transfer/disk budget')
    from urllib.parse import urlsplit
    origin=urlsplit(policy['publicOrigin'])
    require(origin.scheme=='https' and origin.hostname and not origin.username and not origin.password and origin.path in ('','/') and not origin.query and not origin.fragment, 'Invalid approved public origin')
    require(policy['composeFiles'] and Path(policy['composeFiles'][0]).parent == Path(policy['projectDir']), 'First Compose file must belong to actual project directory')
    require(set(policy['composeFiles']) | {policy['mysqlLockFile'],policy['initialBaselineFile']} <= set(policy['preservedFiles']), 'Compose combination and database lock must be preserved')
    require(policy['actorIds'] and policy['operatorIds'], 'Operator and boss identity allowlists required')
    for name in policy['preservedFiles']: trusted(name)
    for name in ('server-update.sh', 'release-gate.sh', 'publish-pda.sh', 'lib/runtime-guards.sh', 'lib/pre-migrate-backup.js'):
        trusted(Path(policy['toolsDir'])/name)
    return policy


def verify_preserved(policy):
    for name, checksum in policy['preservedFiles'].items():
        require(digest_file(regular(name)) == checksum, 'Operator-approved Compose/lock bytes changed; do not deploy')


def write_record(file, record):
    file = Path(file)
    raw = (json.dumps(record, sort_keys=True)+'\n').encode()
    with tempfile.NamedTemporaryFile(prefix='.receipt-',dir=file.parent,delete=False) as out:
        out.write(raw); out.flush(); os.fsync(out.fileno()); temporary=out.name
    os.replace(temporary,file)
    fd=os.open(file.parent,os.O_RDONLY)
    try: os.fsync(fd)
    finally: os.close(fd)


def reserve_release(meta, state):
    """Tombstones intentionally survive failure. Global flock protects all three keys."""
    state=Path(state)
    keys=[meta['kind']+'-version-'+meta['version'],meta['kind']+'-sha-'+meta['sha']]
    if meta['kind']=='pda': keys.append('pda-code-'+str(meta['versionCode']))
    paths=[state/(key+'.json') for key in keys]
    require(all(not p.exists() and not p.is_symlink() for p in paths), 'Duplicate release or uncertain earlier attempt; operator investigation required')
    record=dict(meta,status='reserved',reservedAt=int(time.time()))
    for path in paths:
        fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
        with os.fdopen(fd,'w') as output:
            json.dump(record,output); output.flush(); os.fsync(output.fileno())
    fd=os.open(state,os.O_RDONLY)
    try: os.fsync(fd)
    finally: os.close(fd)
    return paths


def run_owned(command, **kwargs):
    """Own the whole session until all deployment clients stop, including on interruption."""
    process=subprocess.Popen(command, start_new_session=True, **kwargs)
    try:
        code=process.wait()
        if code:
            raise subprocess.CalledProcessError(code, command)
    except BaseException:
        # Do not let a repeated SSH/outer timeout signal interrupt child-group cleanup.
        blocked={signal.SIGTERM,signal.SIGINT,signal.SIGHUP,signal.SIGALRM}
        old_mask=signal.pthread_sigmask(signal.SIG_BLOCK,blocked)
        try:
            try: os.killpg(process.pid,signal.SIGTERM)
            except ProcessLookupError: pass
            try: process.wait(timeout=150)
            except subprocess.TimeoutExpired:
                try: os.killpg(process.pid,signal.SIGKILL)
                except ProcessLookupError: pass
                process.wait(timeout=10)
            # A group member may outlive a fast-exiting timeout leader. Kill any remainder
            # before the receiver writes failure or releases its global deployment lock.
            try: os.killpg(process.pid,signal.SIGKILL)
            except ProcessLookupError: pass
        finally:
            signal.pthread_sigmask(signal.SIG_SETMASK,old_mask)
        raise


def current_browser(policy):
    current=Path(policy['stateDir'])/'browser-current.json'
    if current.exists():
        record=json_bytes(regular(current).read_bytes())
        require(record.get('status')=='executor-success','Current application state requires operator recovery')
    else:
        record=json_bytes(regular(policy['initialBaselineFile']).read_bytes())
        require(record.get('status')=='operator-verified-baseline','Operator-verified initial baseline required')
    require(re.fullmatch(r'[a-f0-9]{40}',record.get('sha','')) and
            set(record.get('imageIds',{}))=={'backend','frontend'} and
            all(re.fullmatch(r'sha256:[a-f0-9]{64}',v) for v in record['imageIds'].values()),'Invalid initial/current image identity')
    return record


def validate_release_version(meta, policy):
    current=current_browser(policy)
    def version(value):
        require(re.fullmatch(r'(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)',value or ''),'Routine releases require an unambiguous numeric application version')
        return tuple(int(v) for v in value.split('.'))
    if meta['kind']=='browser':
        require(version(meta['version'])>version(current['version']),'Version already released or older than current application')
    else:
        require(current.get('status')=='executor-success' and current['sha']==meta['sha'] and current['version']==meta['version'],'PDA requires exact successful browser SHA/version')
        pda=Path(policy['stateDir'])/'pda-current.json'
        previous=json_bytes(regular(pda).read_bytes()) if pda.exists() else json_bytes(regular(policy['initialBaselineFile']).read_bytes())
        code=previous.get('versionCode',previous.get('pdaVersionCode'))
        require(type(code) is int and code>0 and meta['versionCode']>code,'Duplicate or older PDA versionCode')
    return current


def execute_release(meta, payload, policy):
    """Fixed installed scripts only; no scripts/Compose/policy from upload are executed."""
    tools=Path(policy['toolsDir'])
    env=dict(PATH=SAFE_PATH,HOME='/root',LANG='C.UTF-8',
             PROJECT_DIR=policy['projectDir'], RELEASE_TOOLS_DIR=str(tools),
             EXPECTED_COMMIT=meta['sha'], COMPOSE_FILE=':'.join(policy['composeFiles']),
             COMPOSE_PROJECT_NAME=policy['composeProject'], COMPOSE_ENV_FILES=policy['envFile'],
             MYSQL_EXPECTED_VERSION=policy['mysqlVersion'], MYSQL_EXPECTED_IMAGE_ID=policy['mysqlImageId'],
             BACKUP_DIR=policy['backupDir'], RELEASE_STATE_DIR=policy['stateDir'],
             RELEASE_GATE_ENV_FILE=policy['smokeEnvFile'], PLAYWRIGHT_IMAGE=policy['playwrightImage'],
             DEPLOY_PUBLIC_ORIGIN=policy['publicOrigin'], FLOWCUBE_DEPLOY_TIMEOUT_GROUP='1')
    if meta['kind']=='browser':
        current=current_browser(policy)
        before=dict(env,EXPECTED_COMMIT=current['sha'],EXPECTED_BACKEND_ID=current['imageIds']['backend'],EXPECTED_FRONTEND_ID=current['imageIds']['frontend'])
        run_owned(['timeout','-k','150','180','bash',str(tools/'server-update.sh'),'verify-current'],cwd=policy['projectDir'],env=before)
        overlay=Path(payload)/'application-images.json'
        overlay.write_text(json.dumps({'services':{service:{'image':'flowcube-'+service+':'+meta['sha']} for service in ('backend','frontend')}}))
        env['COMPOSE_FILE']+=':'+str(overlay)
        source=Path(payload)/'source'; unpack_scripts(Path(payload)/'scripts.tar',source)
        env.update(RELEASE_SOURCE_DIR=str(source),DEPLOY_IMAGE_ARCHIVE=str(Path(payload)/'images.tar.gz'),
                   DEPLOY_IMAGE_SHA256=meta['files']['images.tar.gz']['sha256'])
        for service in ('backend','frontend'):
            env['EXPECTED_'+service.upper()+'_ID']=(Path(payload)/(service+'.image-id')).read_text().strip()
        verify_docker_archive(Path(payload)/'images.tar.gz',meta['sha'],{service:env['EXPECTED_'+service.upper()+'_ID'] for service in ('backend','frontend')})
        run_owned(['timeout','-k','150','7200','bash',str(tools/'server-update.sh')],cwd=policy['projectDir'],env=env)
    else:
        current=json_bytes(regular(Path(policy['stateDir'])/'browser-current.json').read_bytes())
        require(current.get('status')=='executor-success' and current['sha']==meta['sha'] and current['version']==meta['version'], 'PDA requires this exact successful browser SHA/version')
        for service in ('backend','frontend'): env['EXPECTED_'+service.upper()+'_ID']=current['imageIds'][service]
        run_owned(['timeout','-k','10','180','bash',str(tools/'server-update.sh'),'verify-current'],cwd=policy['projectDir'],env=env)
        run_owned(['timeout','-k','10','300','bash',str(tools/'publish-pda.sh'),str(Path(payload)/'app.apk'),
                        str(Path(payload)/'version.json'),policy['pdaDir']],cwd=policy['projectDir'],env=env)


def receive(stream, policy, executor=execute_release, now=None):
    def read_exact(size):
        content=bytearray()
        while len(content)<size:
            chunk=stream.read(min(size-len(content),1024*1024))
            require(chunk, 'Truncated release stream')
            content.extend(chunk)
        return bytes(content)
    length=struct.unpack('!I',read_exact(4))[0]
    require(0 < length < 32768,'Invalid release header')
    header=json_bytes(read_exact(length))
    require(set(header)=={'token','size','sha256'} and type(header['size']) is int
            and 0 < header['size'] <= policy['maxBundleBytes'], 'Bundle exceeds approved transfer limit')
    require(isinstance(header['sha256'],str) and __import__('re').fullmatch(r'[a-f0-9]{64}',header['sha256']), 'Invalid bundle digest')
    claims=verify_oidc(header['token'],header['sha256'],policy,policy['stateDir'],now=now)
    # No persistent incoming writes before authenticating the workflow and approver.
    lock_fd=os.open(Path(policy['stateDir'])/'deploy.lock',os.O_RDWR|os.O_CREAT|os.O_NOFOLLOW,0o600)
    with os.fdopen(lock_fd,'a') as lock:
        try: fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError: raise ValueError('Another release is active') from None
        require(not (Path(policy['stateDir'])/'recovery-required.json').exists(),'Previous failure requires operator inspection/recovery before any new release')
        verify_preserved(policy)
        free=shutil.disk_usage(policy['spoolDir']).free
        require(free >= header['size']*3+policy['reserveBytes'],f'Insufficient release disk space: {free//1024**2} MiB available; no cleanup performed')
        run=Path(tempfile.mkdtemp(prefix='incoming-'+claims['run_id']+'-',dir=policy['spoolDir']))
        archive=run/'bundle.tar'
        with archive.open('xb') as output:
            remaining=header['size']
            while remaining:
                content=read_exact(min(1024*1024,remaining)); output.write(content); remaining-=len(content)
            output.flush(); os.fsync(output.fileno())
        require(not stream.read(1),'Trailing release bytes')
        require(digest_file(archive)==header['sha256'],'Whole package digest mismatch')
        payload=run/'payload'
        meta=verify_bundle(archive,payload)
        bind_identity(meta,claims,policy)
        approval=meta.get('approval',{})
        require(approval.get('operatorId') in policy['operatorIds'],'Backup operator not authorized')
        validate_release_version(meta,policy)
        reservations=reserve_release(meta,policy['stateDir'])
        receipt=dict(meta,status='running',bundleSha256=header['sha256'],receivedAt=int(time.time()))
        write_record(run/'receipt.json',receipt)
        # Durable before the first executor action: SIGKILL/OOM/power loss cannot
        # run exception handlers. A leftover running marker blocks every version.
        recovery=Path(policy['stateDir'])/'recovery-required.json'
        write_record(recovery,receipt)
        try:
            executor(meta,payload,policy)
            verify_preserved(policy)
            receipt['status']='executor-success'
            if meta['kind']=='browser':
                receipt['imageIds']={service:(payload/(service+'.image-id')).read_text().strip() for service in ('backend','frontend')}
                write_record(Path(policy['stateDir'])/'browser-current.json',receipt)
            else:
                write_record(Path(policy['stateDir'])/'pda-current.json',receipt)
        except BaseException:
            receipt['status']='failed-needs-operator'
            write_record(Path(policy['stateDir'])/'recovery-required.json',receipt)
            raise
        finally:
            for record in [run/'receipt.json',*reservations]: write_record(record,receipt)
        # Only clear after current identity and every reservation/receipt are durable.
        recovery.unlink()
        fd=os.open(policy['stateDir'],os.O_RDONLY)
        try: os.fsync(fd)
        finally: os.close(fd)
        print('Executor succeeded; operations inspection and human browser QA remain pending',flush=True)
    return receipt


def main():
    try:
        require(len(sys.argv)==1 and os.geteuid()==0,'Root-installed endpoint with no arguments required')
        os.environ.clear(); os.environ.update(PATH=SAFE_PATH,LANG='C.UTF-8')
        os.umask(0o077)
        def interrupted(signum, frame): raise RuntimeError('Release interrupted; operator must inspect retained state')
        for sig in (signal.SIGALRM,signal.SIGTERM,signal.SIGINT,signal.SIGHUP): signal.signal(sig,interrupted)
        signal.alarm(10400)
        receive(sys.stdin.buffer,load_policy())
    except BaseException:
        print('Release stopped; inspect retained receipt, no automatic rollback or retry',file=sys.stderr)
        return 1
    return 0


if __name__=='__main__': sys.exit(main())
