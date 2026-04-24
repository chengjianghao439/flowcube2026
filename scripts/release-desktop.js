#!/usr/bin/env node

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const ROOT = path.resolve(__dirname, '..')
const DEFAULT_DOWNLOAD_ROOT = '/var/www/flowcube-downloads'
const DOWNLOAD_ROOT = path.resolve(process.env.FLOWCUBE_DOWNLOADS_ROOT || process.env.APP_UPDATE_DOWNLOADS_DIR || DEFAULT_DOWNLOAD_ROOT)
const LEGACY_BACKEND_DOWNLOADS = path.join(ROOT, 'backend', 'downloads')

function usage() {
  console.error('Usage: node scripts/release-desktop.js <version> [--dry-run] [--rollback] [--manifest-only] [--artifact=/path/to/installer.exe] [--notes="..."]')
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
const notesArg = args.find((arg) => arg.startsWith('--notes='))
const artifactArg = args.find((arg) => arg.startsWith('--artifact='))
const notes = notesArg ? notesArg.slice('--notes='.length) : ''

const tag = `v${version}`
const fileName = `FlowCube-Setup-${version}.exe`
const versionDir = path.join(DOWNLOAD_ROOT, 'versions', tag)
const currentDir = path.join(DOWNLOAD_ROOT, 'current')
const quarantineDir = path.join(DOWNLOAD_ROOT, 'quarantine')
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
  fs.renameSync(tmp, filePath)
}

function ensureNoExistingVersion() {
  if (fs.existsSync(versionDir)) {
    fail(`版本目录已存在，拒绝覆盖: ${versionDir}`)
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
  const existingFileName = String(metadata.fileName || '').trim()
  if (!existingFileName) fail(`metadata.json 缺少 fileName: ${targetMetadata}`)
  const existingExe = path.join(versionDir, existingFileName)
  if (!fs.existsSync(existingExe)) fail(`回滚目标安装包不存在: ${existingExe}`)
  return { metadata, existingExe, existingFileName }
}

if (rollback) {
  const { metadata, existingExe, existingFileName } = loadExistingVersionMetadata()
  const publishedAt = new Date().toISOString()
  const latest = {
    version,
    url: `/versions/${tag}/${existingFileName}`,
    sha256: metadata.sha256 || fileSha256(existingExe),
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
  fs.mkdirSync(currentDir, { recursive: true })
  writeJsonAtomic(latestPath, latest)
  fs.copyFileSync(existingExe, currentExe)
  fs.writeFileSync(currentVersion, `${version}\n`, 'utf8')
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

if (manifestOnly) {
  ensureManifestOnlyTarget(artifact)
} else {
  ensureNoExistingVersion()
}

const publishedAt = new Date().toISOString()
const sha256 = fileSha256(artifact)
const metadata = {
  version,
  fileName,
  size: artifactStat.size,
  sha256,
  createdAt: publishedAt,
  notes,
}
const latest = {
  version,
  url: `/versions/${tag}/${fileName}`,
  sha256,
  notes,
  publishedAt,
}
assertCanonicalManifestUrl(latest.url)

log(`下载根目录: ${DOWNLOAD_ROOT}`)
log(`版本目录: ${versionDir}`)
log(`安装包来源: ${artifact}`)
log(`发布文件名: ${fileName}`)
log(`大小: ${artifactStat.size} bytes`)
log(`sha256: ${sha256}`)
if (dryRun) {
  log(manifestOnly
    ? 'dry-run: manifest-only 不复制安装包，仅校验并生成 metadata/latest/current'
    : 'dry-run: 不创建目录、不复制文件、不更新 latest/current')
  if (!manifestOnly) {
    log(`将创建: ${versionDir}`)
    log(`将复制: ${artifact} -> ${targetExe}`)
  }
  log(`将写入: ${targetMetadata}`)
  log(`将更新: ${latestPath}`)
  log(`将更新: ${currentExe}`)
  log(`将更新: ${currentVersion}`)
  log(`将确保隔离目录存在: ${quarantineDir}/unknown-version, duplicated, old-structure-backup`)
  process.exit(0)
}

fs.mkdirSync(path.join(DOWNLOAD_ROOT, 'versions'), { recursive: true })
if (!manifestOnly) {
  fs.mkdirSync(versionDir, { recursive: false })
}
fs.mkdirSync(currentDir, { recursive: true })
fs.mkdirSync(path.join(quarantineDir, 'unknown-version'), { recursive: true })
fs.mkdirSync(path.join(quarantineDir, 'duplicated'), { recursive: true })
fs.mkdirSync(path.join(quarantineDir, 'old-structure-backup'), { recursive: true })

if (!manifestOnly) {
  copyExclusive(artifact, targetExe)
}
writeJsonAtomic(targetMetadata, metadata)
writeJsonAtomic(latestPath, latest)
fs.copyFileSync(targetExe, currentExe)
fs.writeFileSync(currentVersion, `${version}\n`, 'utf8')

log(manifestOnly ? `已补齐 manifest: ${version}` : `已发布版本: ${version}`)
log(`latest.json -> ${latest.url}`)
log('历史版本未覆盖；current 指针已更新，可通过重写 latest/current 回滚。')
