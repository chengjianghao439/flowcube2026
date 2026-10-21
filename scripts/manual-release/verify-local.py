#!/usr/bin/env python3
"""Fresh publishing runner verifies exact artifact, target locks and current GitHub gates."""
import json
import os
from pathlib import Path
import subprocess
import sys
from protocol import digest_bytes, json_bytes, require, verify_bundle


def verify_local(bundle, output, checks, env):
    meta=verify_bundle(bundle,output)
    require(meta['sha']==env['TARGET_SHA'] and meta['runId']==env['GITHUB_RUN_ID']
            and meta['runAttempt']==env['GITHUB_RUN_ATTEMPT'] and meta['actorId']==env['GITHUB_ACTOR_ID']
            and meta['workflowSha']==env['GITHUB_WORKFLOW_SHA'], 'Downloaded artifact identity mismatch')
    evidence=json_bytes(Path(checks).read_bytes())
    require(meta.get('approval')==evidence['approval'], 'Approval record changed since build')
    locks=json_bytes((Path(output)/'source-locks.json').read_bytes())
    for name,expected in locks['locks'].items():
        original=subprocess.check_output(['git','show',meta['sha']+':'+name+'/package-lock.json'])
        require(digest_bytes(original)==expected,'Target lockfile mismatch')
    if meta['kind']=='browser':
        original=subprocess.check_output(['git','archive','--format=tar',meta['sha'],'scripts','frontend/src/pages/pda','frontend/src/router/routeRegistry.ts'])
        require(digest_bytes(original)==meta['files']['scripts.tar']['sha256'],'Target script archive mismatch')
    return meta


if __name__=='__main__':
    try: verify_local(*sys.argv[1:],os.environ)
    except Exception:
        print('::error::Downloaded release does not match target/run/approval/locks',file=sys.stderr);sys.exit(1)
