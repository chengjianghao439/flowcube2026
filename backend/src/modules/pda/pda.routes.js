const { Router } = require('express')
const path = require('path')
const fs   = require('fs')
const { safeJsonParse } = require('../../utils/safeJsonParse')
const router = Router()

// APK 存放目录（放在 backend/apk/ 下，与 index.js 同级）
const APK_DIR = path.resolve(__dirname, '../../../apk')

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
  const metaPath = path.join(APK_DIR, 'version.json')
  if (!fs.existsSync(metaPath)) {
    return res.json({ success: true, data: null })  // 尚未部署 APK
  }
  try {
    const meta = safeJsonParse(fs.readFileSync(metaPath, 'utf8'), 'apk/version.json', {
      logBeforeParse: process.env.FLOWCUBE_DEBUG_JSON === '1',
    })
    const apkPath = path.join(APK_DIR, meta.filename || 'app-release.apk')
    const size = fs.existsSync(apkPath) ? fs.statSync(apkPath).size : 0
    res.json({
      success: true,
      data: {
        version:     meta.version,
        versionCode: meta.versionCode,
        releaseNote: meta.releaseNote || '',
        downloadUrl: '/api/pda/download',
        size,
        publishedAt: meta.publishedAt || new Date().toISOString(),
      },
    })
  } catch {
    res.status(500).json({ success: false, message: '版本信息读取失败' })
  }
})

/**
 * GET /api/pda/download
 * 下载最新 APK 文件（支持 Range 断点续传）
 */
router.get('/download', (req, res) => {
  const metaPath = path.join(APK_DIR, 'version.json')
  if (!fs.existsSync(metaPath)) {
    return res.status(404).json({ success: false, message: 'APK 未部署' })
  }
  let meta
  try {
    meta = safeJsonParse(fs.readFileSync(metaPath, 'utf8'), 'apk/version.json(download)', {
      logBeforeParse: process.env.FLOWCUBE_DEBUG_JSON === '1',
    })
  } catch {
    return res.status(500).json({ success: false, message: '版本信息 JSON 损坏' })
  }
  const apkPath = path.join(APK_DIR, meta.filename || 'app-release.apk')
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
