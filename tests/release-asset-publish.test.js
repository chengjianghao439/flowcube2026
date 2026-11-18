#!/usr/bin/env node
'use strict'

/**
 * 发布附件上传脚本回归（离线，不访问 GitHub）。
 *
 * 覆盖 2026-09-18 发 v0.9.20 时踩到的三个坑：
 *  - gh CLI 上传没有超时，挂起后 run 只能人工取消；
 *  - `gh release create <tag> <file>` 中断会留下**没有附件的草稿** Release；
 *  - 上传成功不校验，远端可能没有附件或大小不符。
 *
 * 使用合成 EXE 和假 GitHub 验证身份冲突、网络中断、草稿转正和服务器发布重试。
 */

const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { test } = require('node:test')
const { createHash } = require('node:crypto')
const { spawnSync } = require('node:child_process')

const { prepareReleaseAsset, completeExistingRelease, validateRecoveryRun } = require('../scripts/publish-release-asset.cjs')

const REPO = 'owner/repo'
const API = 'https://api.github.com'
const UPLOADS = 'https://uploads.github.com'
const TAG = 'v1.2.3'
const VERSION = '1.2.3'
const SOURCE_SHA = 'a'.repeat(40)
const sha256 = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const RELEASE_URL = `${API}/repos/${REPO}/releases/tags/${TAG}`

function makeFile(bytes = 2048) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flowcube-release-asset-'))
  const file = path.join(dir, `FlowCube-Setup-${VERSION}.exe`)
  fs.writeFileSync(file, Buffer.alloc(bytes, 7))
  return { file, fileSize: bytes }
}

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, text: async () => (body === undefined ? '' : JSON.stringify(body)) }
}

function emptyResponse(status) {
  return { ok: status >= 200 && status < 300, status, text: async () => '' }
}

/**
 * 假 GitHub：按方法+路径返回预设结果，并记录调用顺序。
 * uploadPlan 里的每项是 'ok' | 'http500' | 'throw'，用于模拟重试。
 */
function makeGitHub({ release = null, assets = [], uploadPlan = ['ok'], assetSize = null, fileSize, expectedDigest, losePublishResponse = false }) {
  const calls = []
  let currentRelease = release
  let currentAssets = [...assets]
  let uploadIndex = 0
  const fetchImpl = async (url, init = {}) => {
    const method = init.method || 'GET'
    calls.push({ method, url: String(url), body: init.body })
    if (method === 'GET' && String(url) === `${API}/repos/${REPO}/git/ref/tags/${TAG}`) {
      return jsonResponse(200, { object: { type: 'commit', sha: SOURCE_SHA } })
    }
    if (method === 'GET' && String(url) === RELEASE_URL) {
      if (!currentRelease || currentRelease.draft) return jsonResponse(404, { message: 'Not Found' })
      return jsonResponse(200, { ...currentRelease, assets: currentAssets })
    }
    if (method === 'GET' && String(url) === `${API}/repos/${REPO}/releases/42`) {
      return jsonResponse(200, { ...currentRelease, assets: currentAssets })
    }
    if (method === 'GET' && String(url).startsWith(`${API}/repos/${REPO}/releases?`)) {
      return jsonResponse(200, currentRelease ? [{ ...currentRelease, assets: currentAssets }] : [])
    }
    if (method === 'POST' && String(url) === `${API}/repos/${REPO}/releases`) {
      currentRelease = { id: 42, tag_name: TAG, draft: true, published_at: null, ...JSON.parse(init.body) }
      return jsonResponse(201, { ...currentRelease, assets: currentAssets })
    }
    if (method === 'POST' && String(url).startsWith(`${UPLOADS}/repos/${REPO}/releases/`)) {
      const bytes = []
      for await (const chunk of init.body) bytes.push(chunk)
      assert.equal(Buffer.concat(bytes).length, fileSize)
      const plan = uploadPlan[Math.min(uploadIndex, uploadPlan.length - 1)]
      uploadIndex += 1
      if (plan === 'throw') throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' })
      if (plan === 'http500') {
        // 真实情况：上传中断/失败后远端可能留下半成品附件，下一次尝试前必须清掉。
        const partialName = decodeURIComponent(new URL(String(url)).searchParams.get('name'))
        currentAssets = [...currentAssets.filter(item => item.name !== partialName), { id: 99, name: partialName, state: 'starter', size: 0 }]
        return jsonResponse(500, { message: 'Server Error' })
      }
      const name = decodeURIComponent(new URL(String(url)).searchParams.get('name'))
      const asset = { id: 7, name, state: 'uploaded', digest: `sha256:${expectedDigest}`, size: assetSize ?? fileSize, browser_download_url: `https://github.com/${REPO}/releases/download/${TAG}/${name}` }
      currentAssets = [...currentAssets.filter(item => item.name !== name), asset]
      if (plan === 'lost-response') throw new Error('upload completed before response')
      return jsonResponse(201, asset)
    }
    if (method === 'DELETE' && String(url).startsWith(`${API}/repos/${REPO}/releases/assets/`)) {
      const id = Number(String(url).split('/').pop())
      currentAssets = currentAssets.filter(item => item.id !== id)
      return emptyResponse(204)
    }
    if (method === 'PATCH' && String(url) === `${API}/repos/${REPO}/releases/42`) {
      const changes = JSON.parse(init.body)
      currentRelease = { ...currentRelease, ...changes, published_at: changes.draft === false ? '2026-09-18T00:00:00Z' : null }
      if (changes.draft === false && losePublishResponse) throw new Error('publish succeeded before response')
      return jsonResponse(200, currentRelease)
    }
    throw new Error(`未预期的请求：${method} ${url}`)
  }
  return { fetchImpl, calls, assets: () => currentAssets, release: () => currentRelease, uploadCount: () => uploadIndex }
}

const baseOptions = (file) => ({
  repository: REPO,
  token: 'test-token',
  apiUrl: API,
  uploadsUrl: UPLOADS,
  tag: TAG,
  version: VERSION,
  'source-sha': SOURCE_SHA,
  sha256: sha256(file),
  file,
  attempts: 3,
  timeoutMs: 50,
  retryDelayMs: 1,
})

test('Release 不存在时先建草稿，附件落地后仍等待服务器验收', async () => {
  const { file, fileSize } = makeFile()
  const gh = makeGitHub({ fileSize, expectedDigest: sha256(file) })
  const result = await prepareReleaseAsset({ ...baseOptions(file), fetchImpl: gh.fetchImpl, sleep: async () => {}, logger: () => {} })

  const createCall = gh.calls.find(c => c.method === 'POST' && c.url === `${API}/repos/${REPO}/releases`)
  assert.equal(JSON.parse(createCall.body).draft, true, '必须先建草稿，不能直接对外发布')
  assert.equal(JSON.parse(createCall.body).name, `FlowCube ERP ${VERSION}`)
  assert.equal(JSON.parse(createCall.body).generate_release_notes, true)
  assert.equal(JSON.parse(createCall.body).target_commitish, SOURCE_SHA)

  // 顺序：建草稿 → 上传 → 校验 → 发布
  const order = gh.calls.map(c => `${c.method} ${c.url.replace(API, '').replace(UPLOADS, '')}`)
  assert.ok(order[0].startsWith('GET /repos/'), `先查 Release 是否存在，实际：${order[0]}`)
  const createIndex = gh.calls.indexOf(createCall)
  const uploadIndex = gh.calls.findIndex(c => c.method === 'POST' && c.url.startsWith(UPLOADS))
  const verifyIndex = gh.calls.findIndex((c, i) => i > uploadIndex && c.method === 'GET' && c.url.endsWith('/releases/42'))
  assert.ok(createIndex >= 0 && createIndex < uploadIndex && uploadIndex < verifyIndex, '草稿按 ID 校验，不依赖 tag 查询')
  assert.equal(gh.calls.filter(c => c.method === 'PATCH').length, 0, '服务器回读前保持草稿')
  assert.equal(result.release.draft, true)
  assert.equal(result.asset.size, fileSize)
})

test('GitHub 同一版本同长度但摘要不同，在远端写入前拒绝', async () => {
  const { file, fileSize } = makeFile()
  const gh = makeGitHub({
    release: { id: 42, tag_name: TAG, draft: false },
    assets: [{ id: 5, name: path.basename(file), state: 'uploaded', size: fileSize, digest: `sha256:${'0'.repeat(64)}` }],
    fileSize,
  })
  await assert.rejects(() => prepareReleaseAsset({ ...baseOptions(file), fetchImpl: gh.fetchImpl }), /摘要/)
  assert.ok(gh.calls.every(call => call.method === 'GET'))
})

test('GitHub 同摘要重试复用附件，上传完成但响应丢失时无需重传', async () => {
  const { file, fileSize } = makeFile()
  const gh = makeGitHub({ fileSize, expectedDigest: sha256(file), uploadPlan: ['lost-response'] })
  const publish = () => prepareReleaseAsset({ ...baseOptions(file), fetchImpl: gh.fetchImpl, sleep: async () => {} })
  const prepared = await publish()
  assert.equal(prepared.release.draft, true)
  const writes = gh.calls.filter(call => call.method !== 'GET')
  assert.equal(gh.uploadCount(), 1)
  await publish()
  assert.deepEqual(gh.calls.filter(call => call.method !== 'GET'), writes)
})

test('服务器只接受同版同提交同摘要，异摘要在任何可见文件改动前拒绝', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flowcube-desktop-version-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const file = path.join(dir, 'fixture.exe')
  const root = path.join(dir, 'downloads')
  fs.writeFileSync(file, 'first synthetic EXE')
  const command = (...args) => spawnSync(process.execPath, [
    path.resolve(__dirname, '../scripts/release-desktop.js'), VERSION, '--artifact=' + file,
    ...(args.some(arg => arg.startsWith('--source-sha=')) ? [] : ['--source-sha=' + SOURCE_SHA]),
    '--sha256=' + sha256(file), ...args,
  ], { env: { ...process.env, FLOWCUBE_DOWNLOADS_ROOT: root }, encoding: 'utf8' })
  const before = command('--dry-run')
  assert.equal(before.status, 0, before.stderr)
  assert.equal(fs.existsSync(root), false)
  assert.equal(command().status, 0)
  assert.equal(command().status, 0, '同源原包可重试')
  const manifestFile = path.join(root, 'latest.json')
  const original = fs.readFileSync(manifestFile, 'utf8')
  const installerFile = path.join(root, JSON.parse(original).url.slice(1))
  const currentFile = path.join(root, 'current/FlowCube-Setup.exe')
  assert.equal(JSON.parse(original).sourceSha, SOURCE_SHA)
  assert.equal(sha256(installerFile), sha256(currentFile))
  fs.unlinkSync(currentFile)
  assert.equal(command().status, 0, '中断缺 current 时原包恢复')
  assert.equal(sha256(installerFile), sha256(currentFile))
  const wrongSource = command('--source-sha=' + 'b'.repeat(40))
  assert.equal(wrongSource.status, 1)
  fs.writeFileSync(file, 'other synthetic EXE')
  const conflict = command('--overwrite')
  assert.equal(conflict.status, 1, conflict.stdout)
  assert.match(conflict.stderr, /摘要/)
  assert.equal(fs.readFileSync(manifestFile, 'utf8'), original)
  assert.equal(fs.readFileSync(installerFile, 'utf8'), 'first synthetic EXE')
  assert.equal(fs.readFileSync(currentFile, 'utf8'), 'first synthetic EXE')
})

test('上传超时/失败会重试，并清理半成品附件', async () => {
  const { file, fileSize } = makeFile()
  const gh = makeGitHub({ release: { id: 42, tag_name: TAG, draft: true, assets: [] }, uploadPlan: ['throw', 'http500', 'ok'], fileSize, expectedDigest: sha256(file) })
  const result = await prepareReleaseAsset({ ...baseOptions(file), fetchImpl: gh.fetchImpl, sleep: async () => {}, logger: () => {} })

  assert.equal(gh.uploadCount(), 3, '应当尝试 3 次')
  assert.ok(gh.calls.some(c => c.method === 'DELETE'), '重试前应清掉可能的半成品附件')
  assert.equal(result.asset.state, 'uploaded')
})

test('附件大小与本地不一致时报错，且绝不发布 Release', async () => {
  const { file, fileSize } = makeFile()
  const gh = makeGitHub({ release: { id: 42, tag_name: TAG, draft: true, assets: [] }, assetSize: fileSize - 1, fileSize, expectedDigest: sha256(file) })
  await assert.rejects(
    () => prepareReleaseAsset({ ...baseOptions(file), fetchImpl: gh.fetchImpl, sleep: async () => {}, logger: () => {} }),
    /附件校验失败/,
  )
  assert.equal(gh.calls.filter(c => c.method === 'PATCH' && JSON.parse(c.body).draft === false).length, 0, '校验不过不能发布')
})

test('多次上传始终失败时抛出错误，不放行', async () => {
  const { file, fileSize } = makeFile()
  const gh = makeGitHub({ release: { id: 42, tag_name: TAG, draft: true, assets: [] }, uploadPlan: ['http500'], fileSize })
  await assert.rejects(
    () => prepareReleaseAsset({ ...baseOptions(file), fetchImpl: gh.fetchImpl, sleep: async () => {}, logger: () => {} }),
    /HTTP 500/,
  )
  assert.equal(gh.uploadCount(), 3)
  assert.equal(gh.calls.filter(c => c.method === 'PATCH' && JSON.parse(c.body).draft === false).length, 0)
})

test('缺少仓库/凭证/文件时提前失败，不发起任何请求', async () => {
  const { file } = makeFile()
  let called = 0
  const fetchImpl = async () => { called += 1; return jsonResponse(200, {}) }
  await assert.rejects(() => prepareReleaseAsset({ ...baseOptions(file), repository: undefined, token: undefined, env: {}, fetchImpl, sleep: async () => {}, logger: () => {} }), /缺少合法仓库/)
  await assert.rejects(() => prepareReleaseAsset({ ...baseOptions(file), token: undefined, env: {}, fetchImpl, sleep: async () => {}, logger: () => {} }), /缺少 GitHub token/)
  await assert.rejects(() => prepareReleaseAsset({ ...baseOptions(file), file: path.join(os.tmpdir(), 'not-exist-flowcube.exe'), fetchImpl, sleep: async () => {}, logger: () => {} }), /ENOENT|no such file/)
  assert.equal(called, 0)
})

for (const mismatch of [null, 'manifest', 'asset', 'public-exe']) {
  test(`原包补发布只允许三方摘要一致，不能重传或重建：${mismatch || '一致'}`, async () => {
    const { file, fileSize } = makeFile()
    const hash = require('node:crypto').createHash('sha256').update(fs.readFileSync(file)).digest('hex')
    const gh = makeGitHub({ release: { id: 42, tag_name: TAG, draft: true }, fileSize,
      assets: [{ id: 7, name: path.basename(file), state: 'uploaded', size: fileSize, digest: `sha256:${mismatch === 'asset' ? '0'.repeat(64) : hash}` }] })
    const canonical = `/versions/${TAG}/${path.basename(file)}`
    const fetchImpl = (url, init) => {
      if (String(url) === 'https://fixture.example/latest.json') {
        return Promise.resolve({ ok: true, json: async () => ({ version: VERSION,
          sha256: mismatch === 'manifest' ? '0'.repeat(64) : hash, url: canonical }) })
      }
      if (String(url) === 'https://fixture.example' + canonical) {
        return Promise.resolve({ ok: true, body: [mismatch === 'public-exe' ? Buffer.alloc(fileSize, 3) : fs.readFileSync(file)] })
      }
      return gh.fetchImpl(url, init)
    }
    const action = () => completeExistingRelease({ ...baseOptions(file), origin: 'https://fixture.example', fetchImpl })
    if (mismatch) await assert.rejects(action, /不一致/)
    else assert.equal((await action()).release.draft, false)
    assert.equal(gh.calls.filter(c => c.method === 'POST' || c.method === 'DELETE').length, 0)
    assert.equal(gh.calls.filter(c => c.method === 'PATCH').length, mismatch ? 0 : 1)
  })
}

test('服务器发布前 GitHub 保持草稿，写入服务器后可恢复丢失的转正响应', async t => {
  const { file, fileSize } = makeFile()
  t.after(() => fs.rmSync(path.dirname(file), { recursive: true, force: true }))
  const digest = sha256(file)
  const downloads = path.join(path.dirname(file), 'downloads')
  const gh = makeGitHub({ fileSize, expectedDigest: digest, losePublishResponse: true })
  const opts = { ...baseOptions(file), sleep: async () => {} }
  const canonical = `/versions/${TAG}/${path.basename(file)}`
  const fetchImpl = (url, init) => {
    if (String(url) === 'https://fixture.example/latest.json') {
      const manifest = path.join(downloads, 'latest.json')
      return Promise.resolve(fs.existsSync(manifest)
        ? { ok: true, json: async () => JSON.parse(fs.readFileSync(manifest)) }
        : { ok: false })
    }
    if (String(url) === 'https://fixture.example' + canonical) {
      return Promise.resolve({ ok: true, body: [fs.readFileSync(path.join(downloads, canonical.slice(1)))] })
    }
    return gh.fetchImpl(url, init)
  }
  const complete = () => completeExistingRelease({ ...opts, origin: 'https://fixture.example', fetchImpl })
  await prepareReleaseAsset({ ...opts, fetchImpl })
  await assert.rejects(complete, /无法读取线上/)
  assert.equal(gh.release().draft, true)
  const release = spawnSync(process.execPath, [path.resolve(__dirname, '../scripts/release-desktop.js'),
    VERSION, '--artifact=' + file, '--source-sha=' + SOURCE_SHA, '--sha256=' + digest], {
    encoding: 'utf8', env: { ...process.env, FLOWCUBE_DOWNLOADS_ROOT: downloads },
  })
  assert.equal(release.status, 0, release.stderr)
  assert.equal(fs.statSync(path.join(downloads, canonical.slice(1))).mode & 0o777, 0o644)
  await assert.rejects(complete, /publish succeeded before response/)
  assert.equal(gh.release().draft, false)
  const writes = gh.calls.filter(call => call.method !== 'GET')
  assert.equal((await complete()).asset.digest, 'sha256:' + digest)
  assert.deepEqual(gh.calls.filter(call => call.method !== 'GET'), writes)
})

test('补发布原构建必须绑定同一 tag、提交和桌面工作流', () => {
  const run = { head_sha: 'a'.repeat(40), head_branch: TAG, event: 'push', path: '.github/workflows/build-desktop.yml' }
  const expected = { sha: run.head_sha, tag: TAG }
  validateRecoveryRun(run, expected)
  for (const changed of [{ head_sha: 'b'.repeat(40) }, { head_branch: 'main' }, { event: 'workflow_dispatch' }, { path: '.github/workflows/other.yml' }]) {
    assert.throws(() => validateRecoveryRun({ ...run, ...changed }, expected), /不匹配/)
  }
})
