'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const root = path.resolve(__dirname, '..')

test('只获取 HTTPS 签名跳转，GitHub token 不随跳转转发', async () => {
  const { resolveArtifactUrl } = require('../scripts/deploy-artifact-url')
  let options
  const signed = 'https://fixture.blob.core.windows.net/file?sig=fixture-secret'
  const fetchImpl = async (url, opts) => { options = opts; return { status: 302, headers: new Headers({ location: signed }) } }
  assert.equal(await resolveArtifactUrl({ repository: 'a/b', artifactId: '123', token: 'token', fetchImpl }), signed)
  assert.equal(options.redirect, 'manual')
  assert.equal(options.headers.Authorization, 'Bearer token')
  for (const location of ['http://example.org/x', 'https://example.org/"secret', 'file:///etc/passwd']) {
    await assert.rejects(resolveArtifactUrl({ repository: 'a/b', artifactId: '123', token: 'token', fetchImpl: async () => ({ status: 302, headers: new Headers({ location }) }) }), /签名地址/)
  }
})

test('接收器校验压缩包条目、大小和 SHA256 后原子替换；失败保留原包且清理临时文件', () => {
  const source = path.join(root, 'scripts/receive-deploy-artifact.py')
  assert.ok(fs.existsSync(source), '缺少离线可验证的归档接收器')
  const result = spawnSync('python3', ['-c', `
import importlib.util, tempfile, pathlib, zipfile, hashlib
spec=importlib.util.spec_from_file_location('receiver', ${JSON.stringify(source)})
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
with tempfile.TemporaryDirectory() as d:
 p=pathlib.Path(d); dest=p/'images.tar.gz'; z=p/'artifact.zip'; data=b'fixture-image'
 digest=hashlib.sha256(data).hexdigest()
 with zipfile.ZipFile(z,'w') as f: f.writestr('flowcube-images.tar.gz',data)
 m.unpack_archive(z,dest,digest,len(data)); assert dest.read_bytes()==data
 for expected,size in [('0'*64,len(data)),(digest,len(data)+1)]:
  dest.write_bytes(b'original')
  try: m.unpack_archive(z,dest,expected,size)
  except ValueError: pass
  else: raise AssertionError('corrupt payload accepted')
  assert dest.read_bytes()==b'original'
 with zipfile.ZipFile(z,'w') as f: f.writestr('../flowcube-images.tar.gz',data)
 try: m.unpack_archive(z,dest,digest,len(data))
 except ValueError: pass
 else: raise AssertionError('unexpected entry accepted')
 assert not list(p.glob('*.partial'))
 for name in ['FlowCubePDA-0.10.3.apk','FlowCube-Setup-0.10.3.exe']:
  with zipfile.ZipFile(z,'w') as f: f.writestr(name,data)
  m.unpack_archive(z,dest,digest,len(data),name)
  assert dest.read_bytes()==data
  try: m.unpack_archive(z,dest,digest,len(data),'other.exe')
  except ValueError: pass
  else: raise AssertionError('wrong package name accepted')
`], { encoding: 'utf8', timeout: 5000 })
  assert.equal(result.status, 0, result.stderr)
})

test('EXE/APK manifest bundle 校验所有字节与来源，拒污染成员而保留原包', () => {
  const source = path.join(root, 'scripts/receive-deploy-artifact.py')
  const result = spawnSync('python3', ['-c', `
import importlib.util, tempfile, pathlib, zipfile, hashlib, json, warnings
spec=importlib.util.spec_from_file_location('receiver', ${JSON.stringify(source)})
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
sha='a'*40; data=b'owned release bytes'; digest=hashlib.sha256(data).hexdigest()
def bundle(name,metadata):
 manifest=dict(sha=sha,runId='123',file=name,sha256=digest,metadata={k:hashlib.sha256(v).hexdigest() for k,v in metadata.items()})
 return [(name,data),('release-provenance.json',json.dumps(manifest).encode())]+list(metadata.items())
with tempfile.TemporaryDirectory() as d:
 p=pathlib.Path(d); z=p/'artifact.zip'; dest=p/'package'
 def write(entries):
  with warnings.catch_warnings():
   warnings.simplefilter('ignore',UserWarning)
   with zipfile.ZipFile(z,'w') as f:
    for name,raw in entries:f.writestr(name,raw)
 for name,metadata in [('expected.apk',{'version.json':b'{"version":"1.2.3","versionCode":123}'}),('expected.exe',{'releaseNotes.md':b'owned notes'}),('expected.exe',{})]:
  good=bundle(name,metadata); write(good)
  m.unpack_archive(z,dest,digest,len(data),name)
  assert dest.read_bytes()==data
  # Optional independent source/run context is used by direct consumers; the
  # deployed receiver additionally binds bytes to the fresh CI verification.
  m.unpack_archive(z,dest,digest,len(data),name,sha,'123')
  cases=[good+[('unknown',b'x')],good+[(name,data)],good+[('../version.json',b'x')]]
  if metadata:
   key=list(metadata)[0];cases += [good+[(key,b'x')],good[:2]+[(key,b'changed')],bundle(name,{key:b'x'*(1024*1024+1)}),bundle(name,{key:b'x'*(1024*1024)})]
   link=zipfile.ZipInfo(key);link.create_system=3;link.external_attr=0o120777<<16
   cases.append(good[:2]+[(link,metadata[key])])
  changed=list(good);changed[0]=(name,b'changed release bytes');cases.append(changed)
  wrong=list(good);manifest=json.loads(wrong[1][1]);manifest['file']='other.exe';wrong[1]=('release-provenance.json',json.dumps(manifest).encode());cases.append(wrong)
  for field,value in [('sha','not-a-sha'),('runId','123;injected'),('sha256','bad'),('metadata',{}),('extra','unexpected')]:
   wrong=list(good);manifest=json.loads(wrong[1][1]);manifest[field]=value
   # Empty metadata is valid for the installer bundle without release notes.
   if field=='metadata' and not metadata:continue
   wrong[1]=('release-provenance.json',json.dumps(manifest).encode());cases.append(wrong)
  wrong=list(good);wrong[1]=('release-provenance.json',wrong[1][1][:-1]+b',"sha":"'+sha.encode()+b'"}');cases.append(wrong)
  for bad in cases:
   dest.write_bytes(b'original');write(bad)
   try:m.unpack_archive(z,dest,digest,len(data),name)
   except ValueError:pass
   else:raise AssertionError('polluted bundle accepted')
   assert dest.read_bytes()==b'original';assert not list(p.glob('*.partial'))
  write(good)
  for target,run in [('b'*40,'123'),(sha,'124')]:
   try:m.unpack_archive(z,dest,digest,len(data),name,target,run)
   except ValueError:pass
   else:raise AssertionError('different source/run accepted')
 # Image archives never inherit the release-bundle exception.
 write(bundle('flowcube-images.tar.gz',{}))
 try:m.unpack_archive(z,dest,digest,len(data))
 except ValueError:pass
 else:raise AssertionError('multi-entry image archive accepted')
`], { encoding: 'utf8', timeout: 5000 })
  assert.equal(result.status, 0, result.stderr)
})

test('签名 URL 只从 stdin 进入 curl，不进入参数/日志，下载失败退出并清理', () => {
  const source = path.join(root, 'scripts/receive-deploy-artifact.py')
  assert.ok(fs.existsSync(source))
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flowcube-artifact-'))
  const secret = 'https://fixture.example/file?sig=never-log-this'
  fs.writeFileSync(path.join(dir, 'curl'), '#!/usr/bin/env python3\nimport sys\nassert "never-log-this" not in repr(sys.argv)\nassert "never-log-this" in sys.stdin.read()\nsys.exit(28)\n', { mode: 0o755 })
  try {
    const r = spawnSync('python3', [source, path.join(dir, 'out.tar.gz'), 'a'.repeat(64), '100'], {
      input: secret + '\n', encoding: 'utf8', timeout: 5000, env: { ...process.env, PATH: dir + ':' + process.env.PATH },
    })
    assert.notEqual(r.status, 0)
    assert.match(r.stderr, /curl_exit=28/)
    assert.doesNotMatch(r.stdout + r.stderr, /never-log-this/)
    assert.deepEqual(fs.readdirSync(dir), ['curl'])
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('接收器完整成功路径兼容生产 Python 3.6 的 subprocess 和 pathlib API', () => {
  const source = path.join(root, 'scripts/receive-deploy-artifact.py')
  const result = spawnSync('python3', ['-c', `
import importlib.util, tempfile, pathlib, zipfile, hashlib, sys, io, types
spec=importlib.util.spec_from_file_location('receiver', ${JSON.stringify(source)})
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
unlink=pathlib.Path.unlink
def unlink36(self): return unlink(self)
pathlib.Path.unlink=unlink36
data=b'fixture-image'; digest=hashlib.sha256(data).hexdigest()
curl_fails=False
def run36(args, input=None, universal_newlines=False, stdout=None, stderr=None, timeout=None):
 assert universal_newlines is True
 assert 'fixture-secret' in input and 'fixture-secret' not in repr(args)
 if curl_fails:
  pathlib.Path(sys.argv[1]+'.relay').write_bytes(data)
  return types.SimpleNamespace(returncode=28)
 with zipfile.ZipFile(args[args.index('--output')+1], 'w') as z:
  z.writestr('flowcube-images.tar.gz', data)
 return types.SimpleNamespace(returncode=0)
m.subprocess.run=run36
with tempfile.TemporaryDirectory() as d:
 dest=pathlib.Path(d)/'out.tar.gz'
 sys.argv=['receiver',str(dest),digest,str(len(data))]
 sys.stdin=io.StringIO('https://fixture.example/file?sig=fixture-secret\\n')
 m.main()
 assert dest.read_bytes()==data
 assert list(pathlib.Path(d).iterdir())==[dest]
 curl_fails=True
 sys.stdin=io.StringIO('https://fixture.example/file?sig=fixture-secret\\n')
 m.main()
 assert dest.read_bytes()==data
 assert list(pathlib.Path(d).iterdir())==[dest]
`], { encoding: 'utf8', timeout: 5000 })
  assert.equal(result.status, 0, result.stderr)
})

test('中转归档必须匹配 CI 字节数和摘要，拒绝损坏包与符号链接且保留原归档', () => {
  const source = path.join(root, 'scripts/receive-deploy-artifact.py')
  const result = spawnSync('python3', ['-c', `
import importlib.util, tempfile, pathlib, hashlib
spec=importlib.util.spec_from_file_location('receiver', ${JSON.stringify(source)})
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
with tempfile.TemporaryDirectory() as d:
 p=pathlib.Path(d); dest=p/'images.tar.gz'; relay=p/'images.tar.gz.relay'; data=b'valid-image'
 digest=hashlib.sha256(data).hexdigest(); dest.write_bytes(b'original')
 assert m.accept_relay_archive(dest,digest,len(data)) is False
 for payload in [b'wrong-size',b'x'*len(data)]:
  relay.write_bytes(payload)
  try: m.accept_relay_archive(dest,digest,len(data))
  except ValueError: pass
  else: raise AssertionError('corrupt relay accepted')
  assert dest.read_bytes()==b'original'
 relay.unlink(); target=p/'target'; target.write_bytes(data); relay.symlink_to(target)
 try: m.accept_relay_archive(dest,digest,len(data))
 except ValueError: pass
 else: raise AssertionError('symlink accepted')
 relay.unlink(); relay.write_bytes(data)
 assert m.accept_relay_archive(dest,digest,len(data)) is True
 assert dest.read_bytes()==data and not relay.exists()
 assert m.wait_for_relay(dest,digest,len(data),timeout=0) is False
 (p/'images.tar.gz.relay.pending').touch()
 try: m.wait_for_relay(dest,digest,len(data),timeout=0)
 except RuntimeError: pass
 else: raise AssertionError('unbounded relay wait')
 relay.write_bytes(data)
 assert m.wait_for_relay(dest,digest,len(data),timeout=1) is True
`], { encoding: 'utf8', timeout: 5000 })
  assert.equal(result.status, 0, result.stderr)
})

// 直接运行 workflow 的传输分支；仅替换网络命令，不复制 if/else 实现。
for (const scenario of ['https', 'fallback', 'fallback-failed', 'bad-checksum']) {
  test(`APK/EXE 共用传输器：${scenario}，摘要与清理不省略`, () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flowcube-package-transfer-'))
    const artifact = path.join(dir, 'fixture.exe')
    fs.writeFileSync(artifact, 'fixture-package')
    const put = (name, code) => fs.writeFileSync(path.join(dir, name), '#!/usr/bin/env bash\n' + code, { mode: 0o755 })
    put('timeout', 'shift 3; exec "$@"\n')
    put('node', `if [[ "$1" == scripts/deploy-artifact-url.js ]]; then printf '%s\\n' 'https://fixture/?sig=private-signed-url'; else exec ${JSON.stringify(process.execPath)} "$@"; fi\n`)
    put('ssh', `printf '%s\\n' "$*" >> "$EVENT_LOG"
if [[ "$*" == *python3* ]]; then
 IFS= read -r signed; [[ "$signed" == *private-signed-url ]] || exit 8
 [[ "$SCENARIO" == https ]] && exit 0; exit 1
fi
if [[ "$*" == *sha256sum* && "$SCENARIO" == bad-checksum ]]; then exit 1; fi
exit 0\n`)
    put('scp', `printf '%s\\n' "$*" >> "$EVENT_LOG"
if [[ "$*" == *fixture.exe* && "$SCENARIO" == fallback-failed ]]; then exit 23; fi
exit 0\n`)
    try {
      const r = spawnSync('bash', ['scripts/transfer-release-asset.sh', artifact, 'fixture', '22', '/tmp/fixture.exe'], {
        cwd: root, encoding: 'utf8', timeout: 5000, env: { ...process.env, PATH: dir + ':' + process.env.PATH,
          SCENARIO: scenario, EVENT_LOG: path.join(dir, 'events'), GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '1', DEPLOY_ARTIFACT_ID: '456' },
      })
      assert.equal(r.status, scenario === 'fallback-failed' ? 23 : scenario === 'bad-checksum' ? 1 : 0, r.stdout + r.stderr)
      const events = fs.readFileSync(path.join(dir, 'events'), 'utf8')
      assert.match(events, /rm -f.*relay\.pending.*relay\.partial/)
      if (scenario === 'fallback' || scenario === 'bad-checksum') assert.match(events, /sha256sum/)
      assert.doesNotMatch(r.stdout + r.stderr + events, /private-signed-url/)
    } finally { fs.rmSync(dir, { recursive: true, force: true }) }
  })
}

test('两端使用本轮 artifact，中转源必须在正式发布前就可下载', () => {
  const yaml = require(path.join(root, 'frontend/node_modules/js-yaml'))
  const desktop = yaml.load(fs.readFileSync(path.join(root, '.github/workflows/build-desktop.yml'), 'utf8'))
  const steps = Object.values(desktop.jobs).flatMap(job => job.steps || [])
  const stage = steps.findIndex(s => s.id === 'exe_artifact')
  const publish = steps.findIndex(s => s.name === 'Publish EXE to canonical download directory')
  assert.ok(stage >= 0 && stage < publish)
  assert.match(steps[publish].run, /bash scripts\/transfer-release-asset\.sh/)
  assert.match(desktop.jobs.build.outputs.artifact_id, /steps\.exe_artifact\.outputs\.artifact-id/)
  assert.ok(desktop.jobs.publish.needs.includes('build'))
  assert.match(steps[publish].env.DEPLOY_ARTIFACT_ID, /needs\.build\.outputs\.artifact_id/)
  const pda = yaml.load(fs.readFileSync(path.join(root, '.github/workflows/build-pda-apk.yml'), 'utf8'))
  assert.match(pda.jobs['build-pda'].outputs.artifact_id, /steps\.apk_artifact\.outputs\.artifact-id/)
  assert.match(pda.jobs['sign-pda'].outputs.artifact_id, /steps\.signed_apk\.outputs\.artifact-id/)
  assert.ok(pda.jobs['publish-pda'].needs.includes('sign-pda'))
  const pdaPublish = pda.jobs['publish-pda'].steps.find(s => s.name === 'Publish PDA APK to server')
  assert.match(pdaPublish.run, /bash scripts\/transfer-release-asset\.sh/)
  assert.match(pdaPublish.env.DEPLOY_ARTIFACT_ID, /needs\.sign-pda\.outputs\.artifact_id/)
})

for (const scenario of ['https', 'fallback', 'fallback-failed']) {
  test(`workflow 传输分支：${scenario}`, () => {
    const yaml = require(path.join(root, 'frontend/node_modules/js-yaml'))
    const wf = yaml.load(fs.readFileSync(path.join(root, '.github/workflows/deploy-browser.yml'), 'utf8'))
    const run = wf.jobs.deploy.steps.find(s => s.name === 'Deploy backend and frontend on server').run
    assert.ok(run.includes('HTTPS_OK=0'), '必须有 HTTPS 快路径')
    const block = run.slice(run.indexOf('RECEIVER_SCRIPT='), run.indexOf('timeout -k 5 60 scp -o ConnectTimeout=20'))
      .replace(/\$\{\{[^}]+\}\}/g, 'fixture')
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flowcube-transfer-branch-'))
    fs.writeFileSync(path.join(dir, 'flowcube-images.tar.gz'), '0123456789abcdef')
    const stub = `
SSH_TARGET=fixture; SSH_PORT=22; SSH_COMMON=(); IMAGE_ARCHIVE=/tmp/fixture; IMAGE_SHA256=fixture; ARCHIVE_BYTES=16
timeout() { shift 3; "$@"; }
scp() { echo 'SCP_HELPER'; }
node() { printf '%s\\n' 'https://fixture.test/?sig=fixture-secret'; }
stat() { echo 16; }
ssh() {
 case "\${@: -1}" in
  python3*) read -r signed; [[ "$signed" == *fixture-secret ]] || return 10; [ "$SCENARIO" = https ];;
  cat*) echo 16;;
  *) return 0;;
 esac
}
xargs() { cat >/dev/null; echo 'SCP_FALLBACK'; [ "$SCENARIO" != fallback-failed ]; }
`
    try {
      const r = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', stub + block], { encoding: 'utf8', timeout: 5000,
        env: { ...process.env, SCENARIO: scenario, RUNNER_TEMP: dir, GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '1', DEPLOY_ARTIFACT_ID: '456' } })
      assert.equal(r.status, scenario === 'fallback-failed' ? 1 : 0, r.stdout + r.stderr)
      assert.equal(r.stdout.includes('SCP_FALLBACK'), scenario !== 'https')
      assert.doesNotMatch(r.stdout + r.stderr, /fixture-secret/)
    } finally { fs.rmSync(dir, { recursive: true, force: true }) }
  })
}
