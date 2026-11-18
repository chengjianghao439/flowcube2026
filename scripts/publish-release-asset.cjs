#!/usr/bin/env node
'use strict'

/**
 * 把桌面安装包（exe）发布为 GitHub Release 附件。
 *
 * ## 为什么不用 `gh release upload` / `gh release create <tag> <file>`
 *
 * 2026-09-18 发布 v0.9.20 时踩到三个坑，都是 gh CLI 的行为导致的：
 *  1. **没有超时、也不重试**：Windows runner 上「Upload EXE to Release」连续两次卡在
 *     同一个 112 MB 附件上传上 15 分钟以上（同一份文件、普通网络上传只要 50 秒），run
 *     只能人工取消。根因在 2026-09-18 用本脚本复现：GitHub 附件存储会间歇性返回
 *     `HTTP 500 {"message":"Error saving asset"}`，连试两次失败、第三次成功；gh CLI 对
 *     这种瞬时错误既不重试也不报告，表现为「卡住」。
 *  2. **中断留草稿**：`gh release create <tag> <file>` 的实现是「先建草稿 Release →
 *     上传附件 → 再发布」。上传阶段被中断/取消后，仓库里会留下一个**没有任何附件、
 *     也没对外发布**的草稿 Release，排查时表现为「Release 明明存在却没有安装包」。
 *  3. **不校验落地**：上传命令返回 0 就当作成功，不核对远端附件是否真的存在、大小是否一致。
 *
 * CI 将同一个已核验的 artifact 传入只读预检、草稿准备及最终转正三步。
 * 必须为每次调用提供 --tag、--version、--file、--source-sha、--sha256。
 * --check-only 1 仅读取 GitHub 身份；--prepare-only 1 将已校验的附件写入草稿。
 * 最终转正需要 --origin，先通过可信 HTTPS 校验服务器清单及其实际下载文件。
 */

const fs = require('node:fs')
const { createHash } = require('node:crypto')

const GITHUB_API_URL = 'https://api.github.com'
const GITHUB_UPLOADS_URL = 'https://uploads.github.com'
const API_VERSION = '2022-11-28'
const DEFAULT_ATTEMPTS = 5
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000
const DEFAULT_RETRY_DELAY_MS = 10000

const log = (...args) => console.log('[release-asset]', ...args)

function fail(message) {
  const error = new Error(message)
  error.userFacing = true
  return error
}

function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (!arg.startsWith('--')) throw fail(`未知参数：${arg}`)
    const key = arg.slice(2)
    const value = argv[i + 1]
    if (value === undefined || value.startsWith('--')) throw fail(`参数 ${arg} 缺少取值`)
    out[key] = value
    i += 1
  }
  return out
}

function resolveOptions(args, env = process.env) {
  const repository = args.repository || env.GITHUB_REPOSITORY
  const token = args.token || env.GH_TOKEN || env.GITHUB_TOKEN
  const apiUrl = (args['api-url'] || env.GITHUB_API_URL || GITHUB_API_URL).replace(/\/+$/, '')
  const uploadsUrl = (args['uploads-url'] || env.GITHUB_UPLOADS_URL
    || (apiUrl === GITHUB_API_URL ? GITHUB_UPLOADS_URL : apiUrl.replace('://api.', '://uploads.'))
  ).replace(/\/+$/, '')
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository || '')) throw fail('缺少合法仓库：--repository 或 GITHUB_REPOSITORY')
  if (!token) throw fail('缺少 GitHub token：--token 或 GH_TOKEN/GITHUB_TOKEN')
  if (!args.tag) throw fail('缺少 --tag（如 v0.9.20）')
  if (!args.version) throw fail('缺少 --version（如 0.9.20）')
  if (!args.file) throw fail('缺少 --file（安装包路径）')
  if (!/^\d+\.\d+\.\d+$/.test(args.version) || args.tag !== `v${args.version}`) {
    throw fail('Release tag 必须匹配安装包版本')
  }

  const file = args.file
  const stat = fs.statSync(file)
  if (!stat.isFile()) throw fail(`不是文件：${file}`)
  if (stat.size <= 0) throw fail(`文件为空：${file}`)
  const sourceSha = args['source-sha']
  const sha256 = createHash('sha256').update(fs.readFileSync(file)).digest('hex')
  if (!/^[a-f0-9]{40}$/.test(sourceSha || '')) throw fail('缺少原构建完整提交 --source-sha')
  if (args.sha256 !== sha256) throw fail('本地安装包摘要与原构建不一致')

  const attempts = Number(args.attempts || DEFAULT_ATTEMPTS)
  const timeoutMs = Number(args['timeout-ms'] || DEFAULT_TIMEOUT_MS)
  const retryDelayMs = Number(args['retry-delay-ms'] || DEFAULT_RETRY_DELAY_MS)
  for (const [name, value] of [['attempts', attempts], ['timeout-ms', timeoutMs], ['retry-delay-ms', retryDelayMs]]) {
    if (!Number.isInteger(value) || value <= 0) throw fail(`${name} 必须是正整数，收到 ${value}`)
  }

  return {
    repository, token, apiUrl, uploadsUrl, attempts, timeoutMs, retryDelayMs,
    tag: args.tag,
    version: args.version,
    file,
    fileName: `FlowCube-Setup-${args.version}.exe`,
    fileSize: stat.size, sourceSha, sha256,
  }
}

/** 统一的 REST 调用：GET/POST/PATCH/DELETE(JSON) 带超时；404 交给调用方判断 */
async function callApi(fetchImpl, options, { method, url, body, allow404 = false }) {
  const response = await fetchImpl(url, {
    method,
    headers: {
      Authorization: `Bearer ${options.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': API_VERSION,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(options.timeoutMs),
  })
  if (allow404 && response.status === 404) return null
  const text = await response.text()
  if (!response.ok) throw fail(`${method} ${url} 失败：HTTP ${response.status} ${text.slice(0, 300)}`)
  return text ? JSON.parse(text) : null
}

function releaseApi(options, tag, suffix = '') {
  return `${options.apiUrl}/repos/${options.repository}/releases${tag ? `/tags/${encodeURIComponent(tag)}` : ''}${suffix}`
}

async function findRelease(fetchImpl, options) {
  const existing = await callApi(fetchImpl, options, { method: 'GET', url: releaseApi(options, options.tag), allow404: true })
  if (existing) return existing
  // Draft releases are visible in the list even when GET by tag returns 404.
  for (let page = 1; ; page += 1) {
    const releases = await callApi(fetchImpl, options, { method: 'GET', url: `${releaseApi(options, null)}?per_page=100&page=${page}` })
    const matches = releases.filter(item => item.tag_name === options.tag)
    if (matches.length > 1) throw fail(`同一 tag 存在多个 Release：${options.tag}`)
    if (matches.length) return matches[0]
    if (releases.length < 100) return null
  }
}

async function verifySourceTag(fetchImpl, options, allowMissing = false) {
  const url = `${options.apiUrl}/repos/${options.repository}/git`
  const ref = await callApi(fetchImpl, options, {
    method: 'GET', url: `${url}/ref/tags/${encodeURIComponent(options.tag)}`, allow404: allowMissing,
  })
  if (!ref && allowMissing) return
  let target = ref?.object
  for (let links = 0; target?.type === 'tag' && links < 5; links += 1) {
    if (!/^[a-f0-9]{40}$/.test(target.sha || '')) throw fail('GitHub tag 对象身份无效')
    const annotated = await callApi(fetchImpl, options, { method: 'GET', url: `${url}/tags/${target.sha}` })
    target = annotated.object
  }
  if (target?.type !== 'commit' || target.sha !== options.sourceSha) throw fail('GitHub tag 与原构建提交不一致')
}

function identityMarker(options) {
  return `<!-- flowcube-windows ${options.sourceSha} ${options.sha256} -->`
}

function verifyReleaseIdentity(release, options) {
  if (release.tag_name !== options.tag) throw fail('GitHub Release tag 不一致')
  const marker = release.body?.match(/<!-- flowcube-windows .+? -->/g) || []
  if (marker.length && (marker.length !== 1 || marker[0] !== identityMarker(options))) {
    throw fail('同版 GitHub Release 的来源提交或安装包摘要不一致')
  }
  return marker.length === 1
}

async function ensureRelease(fetchImpl, options, sleep) {
  for (let attempt = 1; attempt <= options.attempts; attempt += 1) {
    const existing = await findRelease(fetchImpl, options)
    if (existing) return existing
    try {
      return await callApi(fetchImpl, options, {
        method: 'POST',
        url: releaseApi(options, null),
        body: {
          tag_name: options.tag,
          target_commitish: options.sourceSha,
          name: `FlowCube ERP ${options.version}`,
          body: identityMarker(options),
          draft: true,
          generate_release_notes: true,
        },
      })
    } catch (error) {
      if (attempt === options.attempts) throw error
      await sleep(options.retryDelayMs)
    }
  }
}

function readInstaller(release, options) {
  const installers = (release.assets || []).filter(asset => /\.exe$/i.test(asset.name))
  if (installers.length > 1 || installers.length === 1 && installers[0].name !== options.fileName) {
    throw fail('同版 GitHub Release 的 Windows 附件名称不一致或存在多个候选')
  }
  const [asset] = installers
  if (!asset) return null
  if (release.draft && asset.state === 'starter' && Number(asset.size) === 0 && !asset.digest) return asset
  if (asset.state !== 'uploaded' || Number(asset.size) !== options.fileSize || asset.digest !== `sha256:${options.sha256}`) {
    throw fail('附件校验失败：同版 GitHub 附件摘要、大小或状态与原始安装包不一致')
  }
  return asset
}

async function deleteStarterAsset(fetchImpl, options, asset) {
  await callApi(fetchImpl, options, {
    method: 'DELETE',
    url: `${options.apiUrl}/repos/${options.repository}/releases/assets/${asset.id}`,
  })
}

async function uploadAssetOnce(fetchImpl, options, releaseId) {
  const url = `${options.uploadsUrl}/repos/${options.repository}/releases/${releaseId}/assets?name=${encodeURIComponent(options.fileName)}`
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${options.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': API_VERSION,
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(options.fileSize),
    },
    body: fs.createReadStream(options.file),
    duplex: 'half',
    signal: AbortSignal.timeout(options.timeoutMs),
  })
  const text = await response.text()
  if (!response.ok) throw fail(`上传附件失败：HTTP ${response.status} ${text.slice(0, 300)}`)
  return text ? JSON.parse(text) : null
}

async function releaseById(fetchImpl, options, id) {
  return callApi(fetchImpl, options, { method: 'GET', url: `${releaseApi(options, null)}/${id}` })
}

async function verifyAsset(fetchImpl, options, { sleep = () => Promise.resolve(), releaseId } = {}) {
  for (let attempt = 1; attempt <= options.attempts; attempt += 1) {
    const release = await releaseById(fetchImpl, options, releaseId)
    verifyReleaseIdentity(release, options)
    const asset = readInstaller(release, options)
    if (asset?.state === 'uploaded') return asset
    if (attempt < options.attempts) await sleep(options.retryDelayMs)
  }
  throw fail(`附件校验失败：远端没有已上传的 ${options.fileName}`)
}

async function publishRelease(fetchImpl, options, release) {
  if (!release.draft) return release
  const published = await callApi(fetchImpl, options, {
    method: 'PATCH',
    url: `${options.apiUrl}/repos/${options.repository}/releases/${release.id}`,
    body: { draft: false, name: `FlowCube ERP ${options.version}`, make_latest: 'true' },
  })
  if (published?.draft !== false || published.tag_name !== options.tag) throw fail('GitHub Release 未确认转正')
  log(`已发布 Release ${published.tag_name}（draft=${published.draft}，publishedAt=${published.published_at}）`)
  return published
}

/** Check both public formats before uploading; leave the verified attachment staged in a draft. */
async function prepareReleaseAsset({
  fetchImpl = fetch,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
  logger = log,
  ...rawOptions
}) {
  const options = resolveOptions(rawOptions, rawOptions.env || process.env)
  let release = await findRelease(fetchImpl, options)
  await verifySourceTag(fetchImpl, options, !release && rawOptions['check-only'] === '1')
  let asset = null
  let bound = false
  if (release) {
    bound = verifyReleaseIdentity(release, options)
    asset = readInstaller(release, options)
    if (!release.draft && !asset) throw fail('已公开 GitHub Release 缺少可核验的原始安装包')
  }
  if (rawOptions['check-only'] === '1') return { release, asset }
  if (asset?.state === 'uploaded') return { release, asset }

  if (!release) {
    release = await ensureRelease(fetchImpl, options, sleep)
    bound = verifyReleaseIdentity(release, options)
    asset = readInstaller(release, options)
    if (!release.draft && !asset) throw fail('已公开 GitHub Release 缺少可核验的原始安装包')
  }
  if (!bound && !asset?.digest) {
    release = await callApi(fetchImpl, options, {
      method: 'PATCH',
      url: `${releaseApi(options, null)}/${release.id}`,
      body: { body: [release.body, identityMarker(options)].filter(Boolean).join('\n\n') },
    })
    if (!release.draft || !verifyReleaseIdentity(release, options)) throw fail('无法绑定 GitHub 草稿的原始安装包身份')
    asset = readInstaller(release, options)
  }

  for (let attempt = 1; asset?.state !== 'uploaded' && attempt <= options.attempts; attempt += 1) {
    if (asset?.state === 'starter') await deleteStarterAsset(fetchImpl, options, asset)
    try {
      logger(`开始上传 ${options.fileName}（第 ${attempt}/${options.attempts} 次）`)
      await uploadAssetOnce(fetchImpl, options, release.id)
    } catch (error) {
      // A lost response can follow a committed upload. Re-check before any retry.
      release = await releaseById(fetchImpl, options, release.id)
      verifyReleaseIdentity(release, options)
      asset = readInstaller(release, options)
      if (asset?.state === 'uploaded') break
      if (attempt === options.attempts) throw error
      await sleep(options.retryDelayMs)
      continue
    }
    asset = await verifyAsset(fetchImpl, options, { sleep, releaseId: release.id })
  }

  release = await releaseById(fetchImpl, options, release.id)
  verifyReleaseIdentity(release, options)
  asset = readInstaller(release, options)
  if (asset?.state !== 'uploaded') throw fail('附件校验失败：已验证的安装包不可见')
  return { release, asset }
}

function validateRecoveryRun(run, { sha, tag }) {
  if (run.head_sha !== sha || run.head_branch !== tag || run.event !== 'push' || run.path !== '.github/workflows/build-desktop.yml') {
    throw fail('原构建运行与发布 tag / SHA / workflow 不匹配，拒绝补发布')
  }
}

async function verifyPublicInstaller(fetchImpl, options, origin, canonicalUrl) {
  const installer = await fetchImpl(new URL(canonicalUrl, origin).href, {
    redirect: 'error', signal: AbortSignal.timeout(options.timeoutMs),
  })
  if (!installer.ok || !installer.body) throw fail('无法读取线上 Windows 安装包')
  const hash = createHash('sha256')
  let size = 0
  for await (const chunk of installer.body) {
    size += chunk.byteLength
    if (size > options.fileSize) throw fail('线上 Windows 安装包大小与原始安装包不一致')
    hash.update(chunk)
  }
  if (size !== options.fileSize || hash.digest('hex') !== options.sha256) throw fail('线上 Windows 安装包摘要或大小不一致')
}

/** 只把已验证的同一原始附件转正；不删除、重传、重建或改服务器清单。 */
async function completeExistingRelease({ fetchImpl = fetch, ...rawOptions }) {
  const options = resolveOptions(rawOptions, rawOptions.env || process.env)
  if (!rawOptions.origin) throw fail('补发布需要 --origin')
  const origin = new URL(rawOptions.origin)
  if (origin.protocol !== 'https:' || origin.username || origin.password) throw fail('补发布需要可信 HTTPS 更新清单')
  const response = await fetchImpl(new URL('/latest.json', origin).href, {
    redirect: 'error', signal: AbortSignal.timeout(options.timeoutMs),
  })
  if (!response.ok) throw fail('无法读取线上桌面更新清单')
  const manifest = await response.json()
  const canonicalUrl = `/versions/${options.tag}/${options.fileName}`
  if (manifest.version !== options.version || manifest.sha256 !== options.sha256 || manifest.url !== canonicalUrl ||
      (manifest.sourceSha && options.sourceSha !== manifest.sourceSha)) {
    throw fail('原始安装包与线上版本、路径、来源提交或 SHA256 不一致')
  }
  await verifySourceTag(fetchImpl, options)
  const release = await findRelease(fetchImpl, options)
  if (!release) throw fail(`找不到已上传附件的 Release：${options.tag}`)
  verifyReleaseIdentity(release, options)
  const asset = await verifyAsset(fetchImpl, options, { releaseId: release.id })
  await verifyPublicInstaller(fetchImpl, options, origin, canonicalUrl)
  const published = await publishRelease(fetchImpl, options, release)
  return { release: published, asset }
}

if (require.main === module) {
  const args = parseArgs(process.argv.slice(2))
  const publish = args['check-only'] === '1' || args['prepare-only'] === '1' ? prepareReleaseAsset : completeExistingRelease
  publish(args)
    .then(({ asset }) => {
      log(`完成：${asset?.browser_download_url || asset?.name || args.tag}`)
    })
    .catch(error => {
      console.error(`::error::${error.message}`)
      if (!error.userFacing) console.error(error.stack)
      process.exitCode = 1
    })
}

module.exports = { parseArgs, resolveOptions, prepareReleaseAsset, completeExistingRelease, validateRecoveryRun }
