#!/usr/bin/env node
'use strict'

/**
 * 发版后线上核对：确认「仓库里写的版本」与「线上真正对外公布的版本」一致。
 *
 * 为什么需要它：2026-09-18 发 v0.9.20 时发现 v0.9.19 的 PDA 发布**从未成功**
 * （一次 failed、一次 cancelled），生产 `/api/pda/version` 一直停在 0.9.18 / 126，
 * 而代码、镜像、桌面更新清单都已经是 0.9.19——整条链路没有一处会因此报错，只有现场
 * PDA 检测不到更新。浏览器与桌面有部署门禁，PDA 是独立构建，容易被漏掉。
 *
 * 用法：
 *   node scripts/verify-live-release.cjs                     # origin 取 deploy 配置
 *   node scripts/verify-live-release.cjs --origin https://jixuflow.com
 *
 * 退出码：0 = 全部一致；1 = 有项目不一致（PDA 未发布时会额外打印补跑命令）。
 */

const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const root = path.resolve(__dirname, '..')

function readJson(relative) {
  return JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'))
}

function resolveOrigin(argv, env = process.env, runner = execFileSync) {
  const index = argv.indexOf('--origin')
  if (index >= 0 && argv[index + 1]) return argv[index + 1].replace(/\/+$/, '')
  if (env.FLOWCUBE_ERP_ORIGIN) return env.FLOWCUBE_ERP_ORIGIN.replace(/\/+$/, '')
  try {
    const value = runner('node', [path.join(root, 'scripts/read-deploy-config.js'), 'erpOrigin'], { cwd: root, encoding: 'utf8' }).trim()
    if (value) return value.replace(/\/+$/, '')
  } catch {
    // 下面统一报错，避免把配置缺失伪装成核对失败。
  }
  throw new Error('缺少站点的 origin：用 --origin https://… 指定，或配置 deploy 配置的 erpOrigin')
}

/**
 * 纯函数：只做判定，不发请求，便于离线回归。
 * expected: { desktopVersion, pdaVersion, pdaVersionCode }
 */
function assessLiveRelease({ latestJson, appUpdate, pdaVersion, health }, expected) {
  const checks = []
  const record = (name, ok, detail) => checks.push({ name, ok: !!ok, detail })

  const desktopVersion = expected.desktopVersion
  record('桌面更新清单版本', latestJson?.version === desktopVersion, `latest.json=${latestJson?.version ?? '(缺失)'}，期望 ${desktopVersion}`)
  record('桌面安装包路径', typeof latestJson?.url === 'string' && latestJson.url.endsWith(`/versions/v${desktopVersion}/FlowCube-Setup-${desktopVersion}.exe`),
    `url=${latestJson?.url ?? '(缺失)'}`)
  record('桌面安装包摘要', /^[a-f0-9]{64}$/i.test(latestJson?.sha256 || ''), `sha256=${latestJson?.sha256 ? `${latestJson.sha256.slice(0, 12)}…` : '(缺失)'}`)
  record('桌面更新说明', typeof latestJson?.notes === 'string' && latestJson.notes.includes(`v${desktopVersion}`), `notes 首行=${(latestJson?.notes || '').split('\n')[0] || '(缺失)'}`)

  const updateVersion = appUpdate?.data?.version ?? appUpdate?.version
  record('桌面更新接口版本', updateVersion === desktopVersion, `/api/app-update/latest=${updateVersion ?? '(缺失)'}，期望 ${desktopVersion}`)

  const pda = pdaVersion?.data ?? {}
  record('PDA 已发布版本', pda.version === expected.pdaVersion,
    `/api/pda/version=${pda.version ?? '(缺失)'}，期望 ${expected.pdaVersion}`)
  record('PDA 已发布 versionCode', Number(pda.versionCode) === Number(expected.pdaVersionCode),
    `versionCode=${pda.versionCode ?? '(缺失)'}，期望 ${expected.pdaVersionCode}`)
  record('PDA 安装包可下载', pda.available === true && typeof pda.downloadUrl === 'string' && pda.downloadUrl.includes(`code=${expected.pdaVersionCode}`),
    `available=${pda.available}，downloadUrl=${pda.downloadUrl ? '已提供' : '(缺失)'}`)
  record('PDA 更新说明', typeof pda.releaseNote === 'string' && pda.releaseNote.trim().length > 0,
    `releaseNote=${pda.releaseNote ? `${pda.releaseNote.slice(0, 24)}…` : '(缺失)'}`)

  record('生产健康检查', health?.success === true && (health?.data?.status ?? 'ok') === 'ok', `/api/health=${health?.data?.status ?? '(缺失)'}`)

  return checks
}

async function fetchJson(fetchImpl, origin, endpoint, timeoutMs = 15000) {
  const response = await fetchImpl(`${origin}${endpoint}`, { headers: { 'Cache-Control': 'no-cache' }, signal: AbortSignal.timeout(timeoutMs) })
  if (!response.ok) throw new Error(`${endpoint} 返回 HTTP ${response.status}`)
  return response.json()
}

async function verifyLiveRelease({ origin, fetchImpl = fetch, logger = console.log, expected = {} }) {
  const desktop = readJson('desktop/package.json')
  const pdaManifest = readJson('backend/apk/version.json')
  const expectation = {
    desktopVersion: expected.desktopVersion || desktop.version,
    pdaVersion: expected.pdaVersion || pdaManifest.version,
    pdaVersionCode: expected.pdaVersionCode || pdaManifest.versionCode,
  }
  const [latestJson, appUpdate, pdaVersion, health] = await Promise.all([
    fetchJson(fetchImpl, origin, '/latest.json'),
    fetchJson(fetchImpl, origin, '/api/app-update/latest'),
    fetchJson(fetchImpl, origin, '/api/pda/version'),
    fetchJson(fetchImpl, origin, '/api/health'),
  ])
  const checks = assessLiveRelease({ latestJson, appUpdate, pdaVersion, health }, expectation)
  const failed = checks.filter(check => !check.ok)
  checks.forEach(check => logger(`${check.ok ? '✅' : '❌'} ${check.name}：${check.detail}`))
  logger(`\n核对 ${origin}：${checks.length - failed.length}/${checks.length} 项一致（期望桌面 ${expectation.desktopVersion}、PDA ${expectation.pdaVersion}/${expectation.pdaVersionCode}）`)
  if (failed.some(check => check.name.startsWith('PDA'))) {
    logger('\nPDA 尚未发布本版。用发布提交补跑（勿在只改文档、带 [skip ci] 的提交上跑）：')
    logger('  gh workflow run build-pda-apk.yml --ref main -f checkout_ref=<已部署的发布提交 SHA>')
  }
  return { checks, ok: failed.length === 0 }
}

if (require.main === module) {
  Promise.resolve()
    .then(() => resolveOrigin(process.argv.slice(2)))
    .then(origin => verifyLiveRelease({ origin }))
    .then(({ ok }) => { process.exitCode = ok ? 0 : 1 })
    .catch(error => {
      console.error(`::error::${error.message}`)
      process.exitCode = 1
    })
}

module.exports = { assessLiveRelease, resolveOrigin, verifyLiveRelease }
