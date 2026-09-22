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
def run36(args, input=None, universal_newlines=False, stdout=None, stderr=None, timeout=None):
 assert universal_newlines is True
 assert 'fixture-secret' in input and 'fixture-secret' not in repr(args)
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
`], { encoding: 'utf8', timeout: 5000 })
  assert.equal(result.status, 0, result.stderr)
})

// 直接运行 workflow 的传输分支；仅替换网络命令，不复制 if/else 实现。
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
