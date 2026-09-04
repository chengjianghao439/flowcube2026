const path = require('path')
const fs = require('fs')
const crypto = require('crypto')
const { safeJsonParse } = require('../../utils/safeJsonParse')
const AppError = require('../../utils/AppError')

const APK_DIR = path.resolve(__dirname, '../../../apk')

// 不可变包按文件身份缓存；不同版本即使 mtime/大小相同也不能共用摘要。
let apkHashCache = { key: '', sha256: '' }

function sha256OfApk(apkPath) {
  const stat = fs.statSync(apkPath)
  const key = `${apkPath}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`
  if (apkHashCache.key === key && apkHashCache.sha256) {
    return apkHashCache.sha256
  }
  const hash = crypto.createHash('sha256')
  hash.update(fs.readFileSync(apkPath))
  const digest = hash.digest('hex')
  apkHashCache = { key, sha256: digest }
  return digest
}

function pathExists(filename) {
  try { fs.lstatSync(filename); return true } catch (error) {
    if (error.code === 'ENOENT') return false
    throw error
  }
}

function loadVersionMeta() {
  // 已部署清单独立于 Git。它损坏时必须报错，不能退回可能已被 git reset 更新的源码版本。
  const publishedPath = path.join(APK_DIR, 'published-version.json')
  const metaPath = pathExists(publishedPath) ? publishedPath : path.join(APK_DIR, 'version.json')
  if (!pathExists(metaPath)) return null
  if (!fs.lstatSync(metaPath).isFile()) throw new Error('版本清单必须是普通文件')
  const meta = safeJsonParse(fs.readFileSync(metaPath, 'utf8'), `apk/${path.basename(metaPath)}`, {
    logBeforeParse: process.env.FLOWCUBE_DEBUG_JSON === '1',
  })
  if (!meta || typeof meta !== 'object' || !Number.isInteger(meta.versionCode) || meta.versionCode <= 0 || meta.versionCode > 2147483647 ||
    typeof meta.version !== 'string' || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(meta.version) ||
    (meta.sha256 !== undefined && !/^[a-f0-9]{64}$/.test(meta.sha256))) {
    throw new Error('版本清单格式非法')
  }
  resolveApkPath(meta)
  return meta
}

function resolveApkPath(meta) {
  const filename = meta.filename ?? 'app-release.apk'
  if (typeof filename !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]*\.apk$/.test(filename)) {
    throw new AppError('APK 文件名非法', 500, 'PDA_VERSION_INVALID')
  }
  const apkPath = path.join(APK_DIR, filename)
  if (pathExists(apkPath) && !fs.lstatSync(apkPath).isFile()) {
    throw new AppError('APK 文件必须是普通文件', 500, 'PDA_VERSION_INVALID')
  }
  return apkPath
}

function verifyApk(meta, apkPath) {
  const stat = fs.statSync(apkPath)
  const sha256 = sha256OfApk(apkPath)
  if (!stat.size || (meta.sha256 !== undefined && meta.sha256 !== sha256) ||
    (meta.size !== undefined && meta.size !== stat.size)) {
    throw new AppError('APK 与发布清单不一致', 500, 'PDA_APK_INTEGRITY_INVALID')
  }
  return { stat, sha256 }
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

function buildPdaDownloadPath(meta, stat, sha256) {
  const versionCode = Number(meta.versionCode) || 0
  const stamp = Number(stat?.mtimeMs) || Date.now()
  return `/api/pda/download?v=${encodeURIComponent(String(meta.version || 'latest'))}&code=${versionCode}&sha256=${sha256}&t=${Math.round(stamp)}`
}

const getApkVersion = async (req) => {
  let meta = null
  try { meta = loadVersionMeta() } catch { throw new AppError('版本信息读取失败', 500, 'PDA_VERSION_READ_FAILED') }
  if (!meta) return null
  const apkPath = resolveApkPath(meta)
  if (!fs.existsSync(apkPath)) return null
  const { stat, sha256 } = verifyApk(meta, apkPath)
  const base = resolvePublicBase(req)
  const downloadPath = buildPdaDownloadPath(meta, stat, sha256)
  return {
    version: meta.version,
    versionCode: Number(meta.versionCode) || 0,
    releaseNote: meta.releaseNote || '',
    downloadUrl: base ? `${base}${downloadPath}` : downloadPath,
    // APK sha256（2026-08-21 审计 E 修复）：前端下载后比对，防止 API 基址被
    // 指向恶意服务器时下载到被替换的 APK
    sha256,
    size: stat.size,
    publishedAt: meta.publishedAt || new Date().toISOString(),
    available: true,
  }
}

const downloadApk = (req, res) => {
  let meta
  try { meta = loadVersionMeta() } catch { throw new AppError('版本信息 JSON 损坏', 500, 'PDA_VERSION_INVALID') }
  if (!meta) throw new AppError('APK 未部署', 404, 'PDA_APK_NOT_DEPLOYED')
  let apkPath = resolveApkPath(meta)
  const requestedHash = req.query?.sha256
  const requestedCode = req.query?.code
  if (requestedHash !== undefined) {
    const code = Number(requestedCode)
    if (typeof requestedHash !== 'string' || !/^[a-f0-9]{64}$/.test(requestedHash) ||
      !Number.isInteger(code) || code <= 0 || code > 2147483647) {
      throw new AppError('下载版本参数非法', 400, 'PDA_DOWNLOAD_VERSION_INVALID')
    }
    const immutablePath = resolveApkPath({ filename: `FlowCubePDA-${code}-${requestedHash}.apk` })
    if (fs.existsSync(immutablePath)) {
      apkPath = immutablePath
      const version = req.query?.v
      meta = { filename: path.basename(apkPath), versionCode: code, sha256: requestedHash,
        version: typeof version === 'string' && /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version) ? version : String(code) }
    } else if (code !== meta.versionCode) {
      throw new AppError('请求的 APK 版本已不可用，请刷新版本信息', 409, 'PDA_DOWNLOAD_VERSION_CHANGED')
    } else {
      // 兼容迁移前的固定文件地址，但绝不能把已变化的包当作旧包下载。
      meta = { ...meta, sha256: requestedHash }
    }
  } else if (requestedCode !== undefined && Number(requestedCode) !== meta.versionCode) {
    throw new AppError('APK 版本已更新，请刷新版本信息', 409, 'PDA_DOWNLOAD_VERSION_CHANGED')
  }
  if (!fs.existsSync(apkPath)) throw new AppError('APK 文件不存在', 404, 'PDA_APK_NOT_FOUND')
  const { stat } = verifyApk(meta, apkPath)
  const fileSize = stat.size
  const range = req.headers.range
  res.setHeader('Content-Type', 'application/vnd.android.package-archive')
  res.setHeader('Content-Disposition', `attachment; filename="JiXu-Flow-PDA-${meta.version}.apk"`)
  res.setHeader('Accept-Ranges', 'bytes')
  res.setHeader('X-FlowCube-PDA-Version', String(meta.version || ''))
  res.setHeader('X-FlowCube-PDA-Version-Code', String(Number(meta.versionCode) || 0))
  if (range) {
    const [startStr, endStr] = range.replace(/bytes=/, '').split('-')
    const start = parseInt(startStr, 10) // 前缀 'bytes=' 已剥；非法/越界值须拦截，否则 chunkSize 为负/NaN
    const end = endStr ? parseInt(endStr, 10) : fileSize - 1
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start >= fileSize || end < start || end >= fileSize) {
      res.setHeader('Content-Range', `bytes */${fileSize}`)
      res.status(416).end()
      return
    }
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
