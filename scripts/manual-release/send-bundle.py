#!/usr/bin/env python3
"""Single SSH stdin stream; no remote shell, SCP, probing or remote cleanup commands."""
import json
import os
from pathlib import Path
import re
import shutil
import struct
import subprocess
import sys
import urllib.parse
import urllib.request
from protocol import digest_file, regular, require


def send_bundle(bundle, env):
    require(env.get('GITHUB_ACTIONS') == 'true' and env.get('GITHUB_EVENT_NAME') == 'workflow_dispatch'
            and env.get('GITHUB_REF') == 'refs/heads/main' and env.get('GITHUB_RUN_ATTEMPT') == '1', 'Manual main dispatch required')
    host, user, port = (env.get(n, '') for n in ('FLOWCUBE_SSH_HOST', 'FLOWCUBE_RELEASE_USER', 'FLOWCUBE_SSH_PORT'))
    require(re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9.:-]*', host) is not None
            and re.fullmatch(r'[a-z_][a-z0-9_-]*', user) is not None and user != 'root'
            and port.isdecimal() and 0 < int(port) <= 65535, 'Invalid restricted SSH target')
    require(env.get('FLOWCUBE_RELEASE_SSH_KEY') and env.get('FLOWCUBE_SSH_KNOWN_HOSTS'), 'New release key and pinned host identity required')
    bundle=regular(bundle)
    checksum=digest_file(bundle)
    audience='urn:flowcube-release:v1:'+checksum
    url=urllib.parse.urlsplit(env['ACTIONS_ID_TOKEN_REQUEST_URL'])
    require(url.scheme=='https' and url.hostname is not None and url.hostname.endswith('.actions.githubusercontent.com'), 'Unexpected OIDC endpoint')
    query=urllib.parse.parse_qsl(url.query)+[('audience', audience)]
    endpoint=urllib.parse.urlunsplit(url._replace(query=urllib.parse.urlencode(query)))
    request=urllib.request.Request(endpoint, headers={'Authorization':'Bearer '+env['ACTIONS_ID_TOKEN_REQUEST_TOKEN']})
    with urllib.request.urlopen(request, timeout=20) as response:
        token=json.load(response)['value']
    header=json.dumps(dict(token=token,size=bundle.stat().st_size,sha256=checksum),separators=(',',':')).encode()
    require(len(header)<32768,'Identity header too large')
    # Runner-only temporary files; this code never creates project credentials.
    work=Path(env['RUNNER_TEMP'])/'manual-release-ssh'
    work.mkdir(mode=0o700)
    key=work/'key'; hosts=work/'known_hosts'
    command=['ssh','-F','/dev/null','-T','-o','BatchMode=yes','-o','IdentitiesOnly=yes',
             '-o','StrictHostKeyChecking=yes','-o','UserKnownHostsFile='+str(hosts),'-o','GlobalKnownHostsFile=/dev/null',
             '-o','UpdateHostKeys=no','-o','ConnectTimeout=20','-o','ServerAliveInterval=30','-o','ServerAliveCountMax=10',
             '-o','ControlMaster=auto','-o','ControlPersist=60','-o','ControlPath='+str(work/'master-%C'),
             '-i',str(key),'-p',port,user+'@'+host,'receive-v1']
    process=None
    try:
        key.write_text(env['FLOWCUBE_RELEASE_SSH_KEY']+'\n'); key.chmod(0o600)
        hosts.write_text(env['FLOWCUBE_SSH_KNOWN_HOSTS']+'\n'); hosts.chmod(0o600)
        process=subprocess.Popen(['timeout','-k','30','10800',*command],stdin=subprocess.PIPE)
        process.stdin.write(struct.pack('!I',len(header))+header)
        with bundle.open('rb') as source: shutil.copyfileobj(source,process.stdin,1024*1024)
        process.stdin.close()
        require(process.wait()==0,'Restricted release failed; inspect retained receipt before any retry')
    finally:
        try:
            if process is not None and process.poll() is None:
                process.terminate(); process.wait(timeout=40)
        finally:
            key.unlink(missing_ok=True)
            hosts.unlink(missing_ok=True)
    print('Release executor completed; operations check and human browser QA are still required')


if __name__=='__main__':
    try: send_bundle(sys.argv[1],os.environ)
    except Exception:
        print('::error::Restricted transfer failed; outcome must be checked before retry',file=sys.stderr)
        sys.exit(1)
