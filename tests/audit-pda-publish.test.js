'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const crypto = require('node:crypto')
const vm = require('node:vm')
const { createRequire } = require('node:module')
const { spawn, spawnSync } = require('node:child_process')
const { PassThrough } = require('node:stream')
const root = path.resolve(__dirname, '..')
const publisher = path.join(root, 'scripts/publish-pda.sh')
const servicePath = path.join(root, 'backend/src/modules/pda/pda.apk.service.js')
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex')

function fixture(t) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'flowcube-pda-publish-'))
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }))
  const dir = path.join(tmp, 'backend/apk')
  fs.mkdirSync(dir, { recursive: true })
  function input(code, bytes = Buffer.from(`apk-${code}`), extra = {}) {
    const filename = path.join(tmp, `input-${crypto.randomUUID()}.apk`)
    const manifest = `${filename}.json`
    fs.writeFileSync(filename, bytes)
    fs.writeFileSync(manifest, JSON.stringify({ version: `1.0.${code}`, versionCode: code,
      filename: 'app-release.apk', releaseNote: '测试发布说明', publishedAt: '2026-09-04T00:00:00.000Z', ...extra }))
    return { filename, manifest, bytes }
  }
  function publish(source) { return spawnSync('bash', [publisher, source.filename, source.manifest, dir], { encoding: 'utf8' }) }
  function installMeta(source, published = true) {
    const meta = JSON.parse(fs.readFileSync(source.manifest))
    if (published) {
      meta.sha256 = digest(source.bytes)
      meta.filename = `FlowCubePDA-${meta.versionCode}-${meta.sha256}.apk`
      meta.size = source.bytes.length
    }
    fs.writeFileSync(path.join(dir, meta.filename), source.bytes)
    fs.writeFileSync(path.join(dir, published ? 'published-version.json' : 'version.json'), JSON.stringify(meta))
    return meta
  }
  function service() {
    // 仅将模块的目录定位到临时部署树；执行实际服务源码，fs/crypto/业务依赖均为真实模块。
    const module = { exports: {} }
    vm.runInNewContext(fs.readFileSync(servicePath, 'utf8'), {
      module, exports: module.exports, require: createRequire(servicePath), process, console, Buffer,
      __dirname: path.join(tmp, 'backend/src/modules/pda'),
    }, { filename: servicePath })
    return module.exports
  }
  return { tmp, dir, input, publish, installMeta, service,
    meta: () => JSON.parse(fs.readFileSync(path.join(dir, 'published-version.json'))) }
}
const req = query => ({ query: query || {}, headers: {}, protocol: 'https', get: name => name === 'host' ? 'erp.example.test' : undefined })
async function downloaded(service, query) {
  const output = new PassThrough()
  const chunks = []
  output.headers = {}
  output.setHeader = (key, value) => { output.headers[key] = value }
  output.status = code => { output.statusCode = code; return output }
  output.on('data', bytes => chunks.push(bytes))
  const done = new Promise((resolve, reject) => { output.on('finish', resolve); output.on('error', reject) })
  service.downloadApk(req(query), output)
  await done
  return { bytes: Buffer.concat(chunks), headers: output.headers, status: output.statusCode }
}

test('首次发布先生成不可变APK，再发布完整清单；Git version.json保持原值', t => {
  const f = fixture(t), old = f.input(1), next = f.input(2)
  f.installMeta(old, false)
  const legacy = fs.readFileSync(path.join(f.dir, 'version.json'), 'utf8')
  const result = f.publish(next)
  assert.equal(result.status, 0, result.stderr)
  const meta = f.meta()
  assert.equal(meta.versionCode, 2)
  assert.equal(meta.sha256, digest(next.bytes))
  assert.equal(meta.filename, `FlowCubePDA-2-${digest(next.bytes)}.apk`)
  assert.deepEqual(fs.readFileSync(path.join(f.dir, meta.filename)), next.bytes)
  assert.equal(fs.readFileSync(path.join(f.dir, 'version.json'), 'utf8'), legacy)
})

test('同号同包重跑幂等，不刷新发布时间或改写清单', t => {
  const f = fixture(t), source = f.input(2)
  assert.equal(f.publish(source).status, 0)
  const before = fs.readFileSync(path.join(f.dir, 'published-version.json'), 'utf8')
  const stat = fs.statSync(path.join(f.dir, 'published-version.json'))
  assert.equal(f.publish(source).status, 0)
  assert.equal(fs.readFileSync(path.join(f.dir, 'published-version.json'), 'utf8'), before)
  assert.equal(fs.statSync(path.join(f.dir, 'published-version.json')).mtimeMs, stat.mtimeMs)
})

test('首次迁移将旧固定包变为不可变部署快照，后续Git更新不影响发布事实', async t => {
  const f = fixture(t), source = f.input(1), future = f.input(2)
  const old = f.installMeta(source, false)
  const legacyApk = { filename: path.join(f.dir, old.filename), manifest: path.join(f.dir, 'version.json') }
  assert.equal(f.publish(legacyApk).status, 0)
  const live = f.meta()
  assert.equal(live.publishedAt, old.publishedAt)
  f.installMeta(future, false)
  const service = f.service()
  const version = await service.getApkVersion(req())
  assert.equal(version.versionCode, 1)
  const download = await downloaded(service, Object.fromEntries(new URL(version.downloadUrl).searchParams))
  assert.deepEqual(download.bytes, source.bytes)
})

test('同versionCode不同包或回退版本拒绝，保留原清单和原APK', t => {
  const f = fixture(t), old = f.input(3)
  const meta = f.installMeta(old)
  for (const bad of [f.input(3, Buffer.from('different-apk')), f.input(2)]) {
    assert.notEqual(f.publish(bad).status, 0)
    assert.equal(f.meta().filename, meta.filename)
    assert.deepEqual(fs.readFileSync(path.join(f.dir, meta.filename)), old.bytes)
  }
})

test('非法元数据、越界文件名和错误摘要均不能发布', t => {
  const f = fixture(t)
  for (const source of [f.input(0), f.input(2, undefined, { filename: '../escape.apk' }),
    f.input(2, undefined, { sha256: '0'.repeat(64) }), f.input(2, Buffer.alloc(0))]) {
    assert.notEqual(f.publish(source).status, 0)
    assert.equal(fs.existsSync(path.join(f.dir, 'published-version.json')), false)
  }
  assert.equal(fs.existsSync(path.join(f.tmp, 'backend/escape.apk')), false)
})

test('发布目录中同名APK是符号链接时拒绝覆盖或追随', t => {
  const f = fixture(t), source = f.input(2)
  const outside = path.join(f.tmp, 'outside.apk')
  fs.writeFileSync(outside, 'do-not-change')
  fs.symlinkSync(outside, path.join(f.dir, `FlowCubePDA-2-${digest(source.bytes)}.apk`))
  assert.notEqual(f.publish(source).status, 0)
  assert.equal(fs.readFileSync(outside, 'utf8'), 'do-not-change')
  assert.equal(fs.existsSync(path.join(f.dir, 'published-version.json')), false)
})

test('并发发布被目录锁拒绝；持锁进程退出后可正常发布', async t => {
  const f = fixture(t), source = f.input(2)
  const locker = spawn('python3', ['-c',
    'import fcntl,sys,time; f=open(sys.argv[1],"a"); fcntl.flock(f,fcntl.LOCK_EX); print("ready",flush=True); time.sleep(30)',
    path.join(f.dir, '.publish-pda.lock')], { stdio: ['ignore', 'pipe', 'pipe'] })
  t.after(() => locker.kill())
  await new Promise((resolve, reject) => { locker.stdout.once('data', resolve); locker.once('error', reject) })
  assert.notEqual(f.publish(source).status, 0)
  await new Promise(resolve => { locker.once('exit', resolve); locker.kill() })
  assert.equal(f.publish(source).status, 0)
})

test('API优先已发布清单，Git版本提前变化不会暴露新版本号', async t => {
  const f = fixture(t), old = f.input(2), future = f.input(3)
  f.installMeta(old)
  f.installMeta(future, false)
  const version = await f.service().getApkVersion(req())
  assert.equal(version.versionCode, 2)
  assert.equal(version.sha256, digest(old.bytes))
  assert.match(version.downloadUrl, /sha256=/)
})

test('没有部署清单时兼容version.json与旧固定APK', async t => {
  const f = fixture(t), source = f.input(1)
  f.installMeta(source, false)
  const version = await f.service().getApkVersion(req())
  assert.equal(version.versionCode, 1)
  assert.equal(version.sha256, digest(source.bytes))
})

test('清单损坏、路径越界或APK摘要不一致时不能回退到Git版本', async t => {
  const f = fixture(t), old = f.input(1), live = f.input(2)
  f.installMeta(old, false)
  const meta = f.installMeta(live)
  for (const bad of ['{', JSON.stringify({ ...meta, filename: '../outside.apk' }), JSON.stringify({ ...meta, sha256: '0'.repeat(64) })]) {
    fs.writeFileSync(path.join(f.dir, 'published-version.json'), bad)
    await assert.rejects(() => f.service().getApkVersion(req()))
  }
})

test('部署清单或APK为符号链接时不能追随外部文件，悬空清单也不能回退', async t => {
  const f = fixture(t), source = f.input(1)
  f.installMeta(source, false)
  const manifest = path.join(f.dir, 'published-version.json')
  fs.symlinkSync(path.join(f.tmp, 'missing.json'), manifest)
  await assert.rejects(() => f.service().getApkVersion(req()))
  fs.unlinkSync(manifest)
  fs.symlinkSync(source.manifest, manifest)
  await assert.rejects(() => f.service().getApkVersion(req()))
  fs.unlinkSync(manifest)
  const meta = f.installMeta(source)
  const apk = path.join(f.dir, meta.filename)
  fs.unlinkSync(apk)
  fs.symlinkSync(source.filename, apk)
  await assert.rejects(() => f.service().getApkVersion(req()))
})

test('无摘要的旧URL不能取到另一个versionCode，非法下载参数不能越界', async t => {
  const f = fixture(t), source = f.input(2)
  f.installMeta(source)
  const service = f.service()
  for (const query of [{ code: '1' }, { code: '2', sha256: '../outside' }, { code: '../2', sha256: digest(source.bytes) }]) {
    await assert.rejects(() => downloaded(service, query))
  }
})

test('切换新清单后旧下载URL仍取得对应旧APK；摘要缓存按文件身份隔离', async t => {
  const f = fixture(t), old = f.input(2, Buffer.from('same-size-old')), next = f.input(3, Buffer.from('same-size-new'))
  const oldMeta = f.installMeta(old)
  const service = f.service()
  const version = await service.getApkVersion(req())
  const nextMeta = f.installMeta(next)
  const when = fs.statSync(path.join(f.dir, oldMeta.filename)).mtime
  fs.utimesSync(path.join(f.dir, nextMeta.filename), when, when)
  assert.equal((await service.getApkVersion(req())).sha256, digest(next.bytes))
  const query = Object.fromEntries(new URL(version.downloadUrl).searchParams)
  const download = await downloaded(service, query)
  assert.deepEqual(download.bytes, old.bytes)
  assert.equal(download.headers['X-FlowCube-PDA-Version-Code'], '2')
})
