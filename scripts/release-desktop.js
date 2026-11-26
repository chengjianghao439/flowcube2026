#!/usr/bin/env node

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const ROOT = path.resolve(__dirname, '..')
const DEFAULT_DOWNLOAD_ROOT = '/var/www/flowcube-downloads'
const DOWNLOAD_ROOT = path.resolve(process.env.FLOWCUBE_DOWNLOADS_ROOT || process.env.APP_UPDATE_DOWNLOADS_DIR || DEFAULT_DOWNLOAD_ROOT)
const LEGACY_BACKEND_DOWNLOADS = path.join(ROOT, 'backend', 'downloads')

function usage() {
  console.error('Usage: node scripts/release-desktop.js <version> [--dry-run] [--rollback] [--manifest-only] [--source-sha=<commit>] [--sha256=<digest>] [--artifact=/path/to/installer.exe] [--notes="..."]')
  process.exit(1)
}

const args = process.argv.slice(2)
const versionArg = args.find((arg) => !arg.startsWith('--'))
if (!versionArg) usage()

const version = versionArg.replace(/^v/i, '').trim()
if (!/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(version)) {
  console.error(`[release-desktop] Invalid version: ${versionArg}`)
  process.exit(1)
}

const dryRun = args.includes('--dry-run')
const rollback = args.includes('--rollback')
const manifestOnly = args.includes('--manifest-only')
const sourceSha = args.find(arg => arg.startsWith('--source-sha='))?.slice('--source-sha='.length)
const expectedDigest = args.find(arg => arg.startsWith('--sha256='))?.slice('--sha256='.length)
const notesArg = args.find((arg) => arg.startsWith('--notes='))
const artifactArg = args.find((arg) => arg.startsWith('--artifact='))
function readReleaseNotes() {
  if (notesArg) return notesArg.slice('--notes='.length)
  if (process.env.FLOWCUBE_RELEASE_NOTES_B64) {
    try {
      return Buffer.from(process.env.FLOWCUBE_RELEASE_NOTES_B64, 'base64').toString('utf8')
    } catch {
      return ''
    }
  }
  return process.env.FLOWCUBE_RELEASE_NOTES || ''
}
const notes = readReleaseNotes()

const tag = `v${version}`
const fileName = `FlowCube-Setup-${version}.exe`
const versionDir = path.join(DOWNLOAD_ROOT, 'versions', tag)
const currentDir = path.join(DOWNLOAD_ROOT, 'current')
const quarantineDir = path.join(DOWNLOAD_ROOT, 'quarantine')
const quarantineFolders = ['unknown-version', 'duplicated', 'old-structure-backup']
const targetExe = path.join(versionDir, fileName)
const targetMetadata = path.join(versionDir, 'metadata.json')
const latestPath = path.join(DOWNLOAD_ROOT, 'latest.json')
const currentExe = path.join(currentDir, 'FlowCube-Setup.exe')
const currentVersion = path.join(currentDir, 'version.txt')

function log(message) {
  console.log(`[release-desktop] ${message}`)
}

function fail(message) {
  console.error(`[release-desktop] ERROR: ${message}`)
  process.exit(1)
}

function fileSha256(filePath) {
  const hash = crypto.createHash('sha256')
  hash.update(fs.readFileSync(filePath))
  return hash.digest('hex')
}

function statOrNull(filePath) {
  try {
    return fs.statSync(filePath)
  } catch {
    return null
  }
}

function isInsideDir(filePath, dirPath) {
  const relative = path.relative(path.resolve(dirPath), path.resolve(filePath))
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)
}

function assertNotLegacyDownloadsArtifact(filePath) {
  if (isInsideDir(filePath, LEGACY_BACKEND_DOWNLOADS)) {
    fail(`backend/downloads 已废弃，禁止从旧目录发布安装包: ${filePath}`)
  }
}

function assertCanonicalManifestUrl(url) {
  if (!String(url || '').startsWith('/versions/')) {
    fail(`latest.json 只允许指向 /versions/，禁止生成旧 /downloads URL: ${url}`)
  }
}

function findArtifacts(searchVersion) {
  const candidates = [
    path.join(ROOT, 'desktop', 'release'),
  ]
  const matches = []
  for (const dir of candidates) {
    if (!fs.existsSync(dir)) continue
    for (const name of fs.readdirSync(dir)) {
      if (!name.toLowerCase().endsWith('.exe')) continue
      if (!name.includes(searchVersion)) continue
      const fullPath = path.join(dir, name)
      const stat = statOrNull(fullPath)
      if (!stat || !stat.isFile()) continue
      matches.push({ path: fullPath, mtimeMs: stat.mtimeMs, size: stat.size })
    }
  }
  return matches.sort((a, b) => b.mtimeMs - a.mtimeMs)
}

function copyExclusive(from, to) {
  fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL)
}

function writeJsonAtomic(filePath, data) {
  const tmp = `${filePath}.tmp-${process.pid}`
  fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
  fs.chmodSync(tmp, 0o644)
  fs.renameSync(tmp, filePath)
}

function copyInstaller(from, to) {
  copyExclusive(from, to)
  fs.chmodSync(to, 0o644)
}

function createPublicDirectory(dir) {
  if (fs.mkdirSync(dir, { recursive: true })) fs.chmodSync(dir, 0o755)
}

function switchCurrent(installer, latest) {
  createPublicDirectory(currentDir)
  const staged = fs.mkdtempSync(path.join(currentDir, '.installer-'))
  try {
    const temporary = path.join(staged, 'setup.exe')
    copyInstaller(installer, temporary)
    fs.renameSync(temporary, currentExe)
    const versionFile = path.join(staged, 'version.txt')
    fs.writeFileSync(versionFile, `${latest.version}\n`, 'utf8')
    fs.chmodSync(versionFile, 0o644)
    fs.renameSync(versionFile, currentVersion)
    writeJsonAtomic(latestPath, latest)
  } finally {
    fs.rmSync(staged, { recursive: true, force: true })
  }
}

function ensureManifestOnlyTarget(artifactPath) {
  if (!fs.existsSync(versionDir)) {
    fail(`manifest-only 要求版本目录已存在: ${versionDir}`)
  }
  const resolvedTarget = path.resolve(targetExe)
  const resolvedArtifact = path.resolve(artifactPath)
  if (resolvedArtifact !== resolvedTarget) {
    fail(`manifest-only 只允许使用规范目录内的安装包: ${targetExe}`)
  }
  if (!fs.existsSync(targetExe)) {
    fail(`manifest-only 目标安装包不存在: ${targetExe}`)
  }
}

function loadExistingVersionMetadata() {
  if (!fs.existsSync(versionDir)) {
    fail(`回滚目标版本不存在: ${versionDir}`)
  }
  if (!fs.existsSync(targetMetadata)) {
    fail(`回滚目标缺少 metadata.json: ${targetMetadata}`)
  }
  const metadata = JSON.parse(fs.readFileSync(targetMetadata, 'utf8'))
  if (metadata.fileName !== fileName || metadata.version !== version) fail('历史版本身份无效')
  if (!fs.existsSync(targetExe)) fail(`回滚目标安装包不存在: ${targetExe}`)
  if (fileSha256(targetExe) !== metadata.sha256) fail('历史安装包摘要与记录不一致')
  return { metadata, existingExe: targetExe }
}

if (rollback) {
  const { metadata, existingExe } = loadExistingVersionMetadata()
  const publishedAt = new Date().toISOString()
  const latest = {
    version,
    url: `/versions/${tag}/${fileName}`,
    sha256: metadata.sha256,
    sourceSha: metadata.sourceSha,
    notes: metadata.notes || '',
    publishedAt,
  }
  assertCanonicalManifestUrl(latest.url)
  log(`下载根目录: ${DOWNLOAD_ROOT}`)
  log(`回滚目标: ${versionDir}`)
  log(`安装包: ${existingExe}`)
  if (dryRun) {
    log('dry-run: 不更新 latest/current')
    log(`将更新: ${latestPath}`)
    log(`将复制: ${existingExe} -> ${currentExe}`)
    log(`将更新: ${currentVersion}`)
    process.exit(0)
  }
  switchCurrent(existingExe, latest)
  log(`已回滚 current/latest 到版本: ${version}`)
  process.exit(0)
}

const artifact = artifactArg
  ? path.resolve(artifactArg.slice('--artifact='.length))
  : (findArtifacts(version)[0] || {}).path

if (!artifact) {
  fail(`未找到版本 ${version} 的桌面安装包。可使用 --artifact=/path/to/file.exe 显式指定。`)
}
if (!fs.existsSync(artifact)) {
  fail(`安装包不存在: ${artifact}`)
}
assertNotLegacyDownloadsArtifact(artifact)

const artifactStat = fs.statSync(artifact)
if (!artifactStat.isFile()) fail(`安装包路径不是文件: ${artifact}`)
if (!artifact.toLowerCase().endsWith('.exe')) fail(`只允许发布 Windows installer .exe: ${artifact}`)

if (manifestOnly) ensureManifestOnlyTarget(artifact)
if (!/^[a-f0-9]{40}$/.test(sourceSha || '')) fail('必须提供原构建完整提交 --source-sha')
if (!/^[a-f0-9]{64}$/.test(expectedDigest || '')) fail('必须提供原构建 --sha256')
const sha256 = fileSha256(artifact)
if (sha256 !== expectedDigest || artifactStat.size === 0) fail('安装包摘要与原构建不一致，或文件为空')

function matchingMetadata() {
  const exists = fs.existsSync(versionDir)
  if (!exists) return null
  const metadata = fs.existsSync(targetMetadata) ? JSON.parse(fs.readFileSync(targetMetadata, 'utf8')) : null
  if (metadata && (metadata.version !== version || metadata.fileName !== fileName ||
      metadata.sha256 !== sha256 || metadata.size !== artifactStat.size)) {
    fail('同版服务器安装包的摘要或身份不一致')
  }
  if (metadata?.sourceSha && metadata.sourceSha !== sourceSha) fail('同版服务器安装包的来源提交不一致')
  if (fs.existsSync(targetExe)) {
    if (fileSha256(targetExe) !== sha256) fail('同版服务器安装包的实际摘要不一致')
  } else if (!metadata) {
    fail('同版目录缺少可核验的安装包身份')
  }
  return metadata
}

const previous = fs.existsSync(latestPath) ? JSON.parse(fs.readFileSync(latestPath, 'utf8')) : null
// A late retry must not promote a historical installer over a newer release.
const stable = /^\d+\.\d+\.\d+$/
if (stable.test(version) && stable.test(previous?.version || '')) {
  const parts = version.split('.').map(BigInt)
  const difference = previous.version.split('.').map(BigInt).map((part, index) => part - parts[index]).find(delta => delta !== 0n)
  if (difference > 0n) fail(`当前版本 ${previous.version} 更新，拒绝将重试发布成降级`)
}
const canonicalUrl = `/versions/${tag}/${fileName}`
if (previous?.version === version && (previous.sha256 !== sha256 || previous.url !== canonicalUrl ||
    (previous.sourceSha && previous.sourceSha !== sourceSha))) {
  fail('同版 latest.json 的摘要、路径或来源提交不一致')
}
const existing = matchingMetadata()
const publishedAt = existing?.createdAt || (previous?.version === version ? previous.publishedAt : null) || new Date().toISOString()
const metadata = {
  version,
  fileName,
  size: artifactStat.size,
  sha256,
  sourceSha,
  createdAt: publishedAt,
  notes: existing?.notes ?? notes,
}
const latest = {
  version,
  url: canonicalUrl,
  sha256,
  sourceSha,
  notes: metadata.notes,
  publishedAt,
}
assertCanonicalManifestUrl(latest.url)

// 在实际 node 身份与可写挂载上只读预检。缺失目录由最近的现有父目录创建。
function requireWritableDirectory(dir) {
  let probe = dir
  for (;;) {
    const stat = fs.statSync(probe, { throwIfNoEntry: false })
    if (stat) {
      if (!stat.isDirectory()) fail(`发布路径不是目录：${probe}`)
      try { fs.accessSync(probe, fs.constants.W_OK | fs.constants.X_OK) }
      catch { fail(`当前发布用户不能写入目录：${probe}`) }
      return
    }
    if (fs.lstatSync(probe, { throwIfNoEntry: false })) fail(`发布目录链接不可用：${probe}`)
    probe = path.dirname(probe)
  }
}

log(`安装包身份：${tag} ${sourceSha} ${sha256}`)
if (dryRun) {
  if (args.includes('--check-write-access')) {
    requireWritableDirectory(DOWNLOAD_ROOT)
    requireWritableDirectory(currentDir)
    if (!fs.existsSync(targetExe) || !existing?.sourceSha) requireWritableDirectory(versionDir)
    if (!fs.existsSync(targetExe)) requireWritableDirectory(path.join(DOWNLOAD_ROOT, '.desktop-staging'))
    for (const folder of quarantineFolders) {
      const dir = path.join(quarantineDir, folder)
      if (!fs.statSync(dir, { throwIfNoEntry: false })?.isDirectory()) requireWritableDirectory(dir)
    }
    pruneVersions(true)
  }
  log('dry-run: 版本身份核对通过')
  process.exit(0)
}

createPublicDirectory(path.join(DOWNLOAD_ROOT, 'versions'))
if (!fs.existsSync(versionDir)) {
  const stagingRoot = path.join(DOWNLOAD_ROOT, '.desktop-staging')
  fs.mkdirSync(stagingRoot, { recursive: true, mode: 0o700 })
  const staged = fs.mkdtempSync(path.join(stagingRoot, 'version-'))
  try {
    const stagedInstaller = path.join(staged, fileName)
    copyInstaller(artifact, stagedInstaller)
    if (fileSha256(stagedInstaller) !== sha256) throw Error('服务器暂存包摘要与原构建不一致')
    writeJsonAtomic(path.join(staged, 'metadata.json'), metadata)
    fs.chmodSync(staged, 0o755)
    try {
      fs.renameSync(staged, versionDir)
    } catch (error) {
      if (error.code !== 'EEXIST' && error.code !== 'ENOTEMPTY') throw error
      if (!matchingMetadata()) throw error
    }
  } finally {
    fs.rmSync(staged, { recursive: true, force: true })
  }
} else {
  // 保留的旧版记录也用于校验磁盘保留期后恢复的原包。
  if (!fs.existsSync(targetExe)) {
    const stagingRoot = path.join(DOWNLOAD_ROOT, '.desktop-staging')
    fs.mkdirSync(stagingRoot, { recursive: true, mode: 0o700 })
    const staged = fs.mkdtempSync(path.join(stagingRoot, 'installer-'))
    try {
      const temporary = path.join(staged, fileName)
      copyInstaller(artifact, temporary)
      if (fileSha256(temporary) !== sha256) throw Error('服务器暂存包摘要与原构建不一致')
      try {
        fs.linkSync(temporary, targetExe)
      } catch (error) {
        if (error.code !== 'EEXIST' || fileSha256(targetExe) !== sha256) throw error
      }
    } finally {
      fs.rmSync(staged, { recursive: true, force: true })
    }
  }
  if (!existing?.sourceSha) writeJsonAtomic(targetMetadata, metadata)
}
for (const folder of quarantineFolders) {
  fs.mkdirSync(path.join(quarantineDir, folder), { recursive: true })
}
if (fileSha256(targetExe) !== sha256) fail('服务器公开包摘要与原构建不一致')
switchCurrent(targetExe, latest)
log(`已发布版本：${version}，latest.json → ${latest.url}`)

// /versions 保留策略（2026-08-22）：桌面安装包每版 100MB+，磁盘有限。
// 发布成功后清理历史目录，只保留最近 N 版（默认 5，FLOWCUBE_VERSIONS_KEEP 可覆盖），
// 本次刚发布的版本永久保留。
function pruneVersions(checkOnly = false) {
  if (manifestOnly || rollback) return
  const keep = Math.max(2, Number(process.env.FLOWCUBE_VERSIONS_KEEP || 5))
  const versionsDir = path.join(DOWNLOAD_ROOT, 'versions')
  if (!fs.existsSync(versionsDir)) return
  const entries = fs.readdirSync(versionsDir)
    .filter(name => /^v\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(name))
    .filter(name => fs.existsSync(path.join(versionsDir, name, `FlowCube-Setup-${name.slice(1)}.exe`)))
    .sort((a, b) => {
      const parse = (s) => s.replace(/^v/, '').split('.').map(Number)
      const [a1, a2, a3] = parse(a)
      const [b1, b2, b3] = parse(b)
      return b1 - a1 || b2 - a2 || b3 - a3
    })
  // 保留：本次发布的版本 + 排序后前 keep 个（不含本次）
  const keepNames = new Set([`v${version}`])
  for (const name of entries) {
    if (name === `v${version}`) continue
    if (keepNames.size < keep + 1) keepNames.add(name)
    else {
      const info = path.join(versionsDir, name, 'metadata.json')
      if (!fs.existsSync(info)) continue
      const metadata = JSON.parse(fs.readFileSync(info, 'utf8'))
      const oldFile = path.join(versionsDir, name, `FlowCube-Setup-${name.slice(1)}.exe`)
      if (metadata.sourceSha && /^[a-f0-9]{64}$/.test(metadata.sha256 || '') &&
          metadata.version === name.slice(1) && metadata.fileName === path.basename(oldFile)) {
        if (checkOnly) { requireWritableDirectory(path.dirname(oldFile)); continue }
        fs.unlinkSync(oldFile)
        log(`清理历史安装包并保留版本身份: ${name}`)
      }
    }
  }
}
pruneVersions()
