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
 * 本脚本直接用 GitHub REST API 完成同一件事，并补上缺口：
 *  确保 Release 存在（缺则建**草稿**）→ 删除同名旧附件 → 带**超时 + 重试**上传
 *  → **校验**远端附件 state/size → 最后才 `draft=false` + `make_latest` 对外发布。
 * 任何一步失败都以非零退出并打印 `::error::`，中断时留下的是「可见的草稿 + 明确日志」，
 * 而不是「看起来正常但没有包」的 Release。
 *
 * 用法：
 *   node scripts/publish-release-asset.cjs --tag v0.9.20 --version 0.9.20 \
 *     --file desktop/release/FlowCube-Setup-0.9.20.exe
 *
 * 环境变量：`GITHUB_REPOSITORY`、`GH_TOKEN`（或 `GITHUB_TOKEN`）、可选 `GITHUB_API_URL`、
 * `GITHUB_UPLOADS_URL`。默认 5 次尝试、每次 10 分钟超时、失败后 10 秒重试。
 */

const fs = require('node:fs')

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

  const file = args.file
  const stat = fs.statSync(file)
  if (!stat.isFile()) throw fail(`不是文件：${file}`)
  if (stat.size <= 0) throw fail(`文件为空：${file}`)

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
    fileName: args.name || require('node:path').basename(file),
    fileSize: stat.size,
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

/** 确保 Release 存在；不存在时建**草稿**（附件上传并校验通过后才对外发布） */
async function ensureRelease(fetchImpl, options, { sleep = () => Promise.resolve() } = {}) {
  const existing = await callApi(fetchImpl, options, { method: 'GET', url: releaseApi(options, options.tag), allow404: true })
  if (existing) {
    log(`Release ${options.tag} 已存在（id=${existing.id}，draft=${existing.draft}，附件 ${existing.assets?.length ?? 0} 个）`)
    return existing
  }
  log(`Release ${options.tag} 不存在，创建草稿（发布延后到附件校验通过）`)
  let release = null
  for (let attempt = 1; attempt <= options.attempts; attempt += 1) {
    try {
      release = await callApi(fetchImpl, options, {
        method: 'POST',
        url: releaseApi(options, null),
        body: {
          tag_name: options.tag,
          name: `FlowCube ERP ${options.version}`,
          draft: true,
          generate_release_notes: true,
        },
      })
      break
    } catch (error) {
      if (attempt === options.attempts) throw error
      log(`创建 Release 第 ${attempt} 次失败（${error.message}），${options.retryDelayMs}ms 后重试`)
      await sleep(options.retryDelayMs)
    }
  }
  // 草稿已建但标签未对外发布时，tag 可能尚未被 GitHub 关联；这里不做额外补偿，
  // 后续上传与发布步骤都以 release.id 为准。
  return release
}

/** 同名附件存在时先删掉，等价于 gh 的 --clobber */
async function removeExistingAsset(fetchImpl, options, release) {
  const assets = release.assets || []
  const existing = assets.find(asset => asset.name === options.fileName)
  if (!existing) return false
  log(`删除同名旧附件 ${existing.name}（id=${existing.id}）`)
  await callApi(fetchImpl, options, {
    method: 'DELETE',
    url: `${options.apiUrl}/repos/${options.repository}/releases/assets/${existing.id}`,
  })
  return true
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

/** 校验远端附件真的落地且大小一致（上传成功 ≠ 附件可用） */
async function verifyAsset(fetchImpl, options, { sleep = () => Promise.resolve() } = {}) {
  for (let attempt = 1; attempt <= options.attempts; attempt += 1) {
    const release = await callApi(fetchImpl, options, { method: 'GET', url: releaseApi(options, options.tag), allow404: true })
    const asset = (release?.assets || []).find(item => item.name === options.fileName)
    if (asset && asset.state === 'uploaded' && Number(asset.size) === options.fileSize) {
      return asset
    }
    log(`附件校验第 ${attempt} 次未通过（${asset ? `state=${asset.state} size=${asset.size}` : '尚未出现'}），等待后重试`)
    if (attempt < options.attempts) await sleep(options.retryDelayMs)
  }
  throw fail(`附件校验失败：远端不存在 ${options.fileName} 或大小与本地 ${options.fileSize} 不一致`)
}

async function publishRelease(fetchImpl, options, release) {
  const published = await callApi(fetchImpl, options, {
    method: 'PATCH',
    url: `${options.apiUrl}/repos/${options.repository}/releases/${release.id}`,
    body: { draft: false, name: `FlowCube ERP ${options.version}`, make_latest: 'true' },
  })
  log(`已发布 Release ${published.tag_name}（draft=${published.draft}，publishedAt=${published.published_at}）`)
  return published
}

/**
 * 完整流程：确保 Release → 删同名 → 上传（带重试）→ 校验 → 发布。
 * 只返回「已发布且附件已校验」的结果，中间任何失败都抛出。
 */
async function publishReleaseAsset({
  fetchImpl = fetch,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
  logger = log,
  ...rawOptions
}) {
  const options = resolveOptions(rawOptions, rawOptions.env || process.env)
  logger(`准备上传 ${options.fileName}（${options.fileSize} 字节）到 ${options.repository} Release ${options.tag}`)
  logger(`每次上传超时 ${options.timeoutMs}ms，最多尝试 ${options.attempts} 次`)

  const release = await ensureRelease(fetchImpl, options, { sleep })
  await removeExistingAsset(fetchImpl, options, release)

  let uploaded = null
  for (let attempt = 1; attempt <= options.attempts; attempt += 1) {
    try {
      logger(`开始上传（第 ${attempt}/${options.attempts} 次）`)
      uploaded = await uploadAssetOnce(fetchImpl, options, release.id)
      logger(`上传返回：id=${uploaded?.id} state=${uploaded?.state} size=${uploaded?.size}`)
      break
    } catch (error) {
      // 超时/网络中断后远端可能已有半成品附件，下一次尝试前先清掉同名项。
      const current = await callApi(fetchImpl, options, { method: 'GET', url: releaseApi(options, options.tag), allow404: true })
      if (current) await removeExistingAsset(fetchImpl, options, current)
      if (attempt === options.attempts) throw error
      logger(`上传第 ${attempt} 次失败（${error.message}），${options.retryDelayMs}ms 后重试`)
      await sleep(options.retryDelayMs)
    }
  }

  const asset = await verifyAsset(fetchImpl, options, { sleep })
  logger(`附件校验通过：${asset.name}（${asset.size} 字节）`)
  const published = await publishRelease(fetchImpl, options, release)
  return { release: published, asset }
}

if (require.main === module) {
  const args = parseArgs(process.argv.slice(2))
  publishReleaseAsset(args)
    .then(({ asset }) => {
      log(`完成：${asset.browser_download_url || asset.name}`)
    })
    .catch(error => {
      console.error(`::error::${error.message}`)
      if (!error.userFacing) console.error(error.stack)
      process.exitCode = 1
    })
}

module.exports = { parseArgs, resolveOptions, ensureRelease, removeExistingAsset, uploadAssetOnce, verifyAsset, publishRelease, publishReleaseAsset }
