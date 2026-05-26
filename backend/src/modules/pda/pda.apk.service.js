const path = require('path')
const fs = require('fs')
const { safeJsonParse } = require('../../utils/safeJsonParse')
const AppError = require('../../utils/AppError')

const APK_DIR = path.resolve(__dirname, '../../../apk')

function loadVersionMeta() {
  const metaPath = path.join(APK_DIR, 'version.json')
  if (!fs.existsSync(metaPath)) return null
  return safeJsonParse(fs.readFileSync(metaPath, 'utf8'), 'apk/version.json', {
    logBeforeParse: process.env.FLOWCUBE_DEBUG_JSON === '1',
  })
}

function resolveApkPath(meta) {
  return path.join(APK_DIR, meta.filename || 'app-release.apk')
}

function resolvePublicBase(req) {
  const proto = req.get('x-forwarded-proto') || req.protocol || 'http'
  const host = req.get('x-forwarded-host') || req.get('host')
  if (!host) return ''
  return `${proto}://${host}`
}

function setNoStoreHeaders(res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
  res.setHeader('Pragma', 'no-cache')
  res.setHeader('Expires', '0')
  res.setHeader('Surrogate-Control', 'no-store')
}

function buildPdaDownloadPath(meta, stat) {
  const versionCode = Number(meta.versionCode) || 0
  const stamp = Number(stat?.mtimeMs) || Date.now()
  return `/api/pda/download?v=${encodeURIComponent(String(meta.version || 'latest'))}&code=${versionCode}&t=${Math.round(stamp)}`
}

const getApkVersion = async (req) => {
  let meta = null
  try { meta = loadVersionMeta() } catch { throw new AppError('版本信息读取失败', 500, 'PDA_VERSION_READ_FAILED') }
  if (!meta) return null
  const apkPath = resolveApkPath(meta)
  if (!fs.existsSync(apkPath)) return null
  const stat = fs.statSync(apkPath)
  const base = resolvePublicBase(req)
  const downloadPath = buildPdaDownloadPath(meta, stat)
  return {
    version: meta.version,
    versionCode: Number(meta.versionCode) || 0,
    releaseNote: meta.releaseNote || '',
    downloadUrl: base ? `${base}${downloadPath}` : downloadPath,
    size: stat.size,
    publishedAt: meta.publishedAt || new Date().toISOString(),
    available: true,
  }
}

const downloadApk = (req, res) => {
  let meta
  try { meta = loadVersionMeta() } catch { throw new AppError('版本信息 JSON 损坏', 500, 'PDA_VERSION_INVALID') }
  if (!meta) throw new AppError('APK 未部署', 404, 'PDA_APK_NOT_DEPLOYED')
  const apkPath = resolveApkPath(meta)
  if (!fs.existsSync(apkPath)) throw new AppError('APK 文件不存在', 404, 'PDA_APK_NOT_FOUND')
  const stat = fs.statSync(apkPath)
  const fileSize = stat.size
  const range = req.headers.range
  res.setHeader('Content-Type', 'application/vnd.android.package-archive')
  res.setHeader('Content-Disposition', `attachment; filename="JiXu-Flow-PDA-${meta.version}.apk"`)
  res.setHeader('Accept-Ranges', 'bytes')
  res.setHeader('X-FlowCube-PDA-Version', String(meta.version || ''))
  res.setHeader('X-FlowCube-PDA-Version-Code', String(Number(meta.versionCode) || 0))
  if (range) {
    const [startStr, endStr] = range.replace(/bytes=/, '').split('-')
    const start = parseInt(startStr, 10)
    const end = endStr ? parseInt(endStr, 10) : fileSize - 1
    const chunkSize = end - start + 1
    res.setHeader('Content-Range', `bytes ${start}-${end}/${fileSize}`)
    res.setHeader('Content-Length', chunkSize)
    res.status(206)
    const stream = fs.createReadStream(apkPath, { start, end })
    stream.on('error', () => { if (!res.headersSent) res.status(500).end() })
    stream.pipe(res)
  } else {
    res.setHeader('Content-Length', fileSize)
    res.status(200)
    const stream = fs.createReadStream(apkPath)
    stream.on('error', () => { if (!res.headersSent) res.status(500).end() })
    stream.pipe(res)
  }
}

module.exports = { getApkVersion, downloadApk, setNoStoreHeaders }
