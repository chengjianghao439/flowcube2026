const { Router } = require('express')
const path = require('path')
const fs   = require('fs')
const { safeJsonParse } = require('../../utils/safeJsonParse')
const router = Router()

// APK 存放目录（放在 backend/apk/ 下，与 index.js 同级）
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

/**
 * GET /api/pda/version
 * 返回当前最新 APK 版本信息（无需登录，PDA 启动时静默检查）
 *
 * 响应格式：
 * {
 *   success: true,
 *   data: {
 *     version: "1.2.0",
 *     versionCode: 3,
 *     releaseNote: "修复扫码稳定性问题",
 *     downloadUrl: "/api/pda/download",
 *     size: 12345678,
 *     publishedAt: "2026-03-18T00:00:00.000Z"
 *   }
 * }
 */
router.get('/version', (req, res) => {
  let meta = null
  try {
    meta = loadVersionMeta()
  } catch {
    return res.status(500).json({ success: false, message: '版本信息读取失败' })
  }

  if (!meta) {
    return res.json({ success: true, data: null })  // 尚未部署 APK
  }

  const apkPath = resolveApkPath(meta)
  if (!fs.existsSync(apkPath)) {
    return res.json({ success: true, data: null })
  }

  const size = fs.statSync(apkPath).size
  const base = resolvePublicBase(req)
  return res.json({
    success: true,
    data: {
      version:     meta.version,
      versionCode: Number(meta.versionCode) || 0,
      releaseNote: meta.releaseNote || '',
      downloadUrl: base ? `${base}/api/pda/download` : '/api/pda/download',
      size,
      publishedAt: meta.publishedAt || new Date().toISOString(),
      available: true,
    },
  })
})

/**
 * GET /api/pda/download
 * 下载最新 APK 文件（支持 Range 断点续传）
 */
router.get('/download', (req, res) => {
  let meta
  try {
    meta = loadVersionMeta()
  } catch {
    return res.status(500).json({ success: false, message: '版本信息 JSON 损坏' })
  }
  if (!meta) {
    return res.status(404).json({ success: false, message: 'APK 未部署' })
  }

  const apkPath = resolveApkPath(meta)
  if (!fs.existsSync(apkPath)) {
    return res.status(404).json({ success: false, message: 'APK 文件不存在' })
  }

  const stat     = fs.statSync(apkPath)
  const fileSize = stat.size
  const range    = req.headers.range

  res.setHeader('Content-Type', 'application/vnd.android.package-archive')
  res.setHeader('Content-Disposition', `attachment; filename="FlowCubePDA-${meta.version}.apk"`)
  res.setHeader('Accept-Ranges', 'bytes')

  if (range) {
    // 断点续传
    const [startStr, endStr] = range.replace(/bytes=/, '').split('-')
    const start = parseInt(startStr, 10)
    const end   = endStr ? parseInt(endStr, 10) : fileSize - 1
    const chunkSize = end - start + 1
    res.setHeader('Content-Range', `bytes ${start}-${end}/${fileSize}`)
    res.setHeader('Content-Length', chunkSize)
    res.status(206)
    fs.createReadStream(apkPath, { start, end }).pipe(res)
  } else {
    res.setHeader('Content-Length', fileSize)
    res.status(200)
    fs.createReadStream(apkPath).pipe(res)
  }
})

module.exports = router
