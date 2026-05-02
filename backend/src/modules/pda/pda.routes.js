const { Router } = require('express')
const path = require('path')
const fs   = require('fs')
const { z } = require('zod')
const { safeJsonParse } = require('../../utils/safeJsonParse')
const { successResponse } = require('../../utils/response')
const AppError = require('../../utils/AppError')
const { asyncRoute, validateBody } = require('../../utils/route')
const { authMiddleware } = require('../../middleware/auth')
const pdaSessions = require('./pda.sessions.service')
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

const createSessionSchema = z.object({
  device_code:   z.string().min(1).max(64),
  device_secret: z.string().min(1).max(255),
})

/**
 * POST /api/pda/sessions
 * 第一阶段设备会话能力：要求用户已登录，但不影响既有 PDA 作业路径。
 */
router.post('/sessions', authMiddleware, validateBody(createSessionSchema), asyncRoute(async (req, res) => {
  const data = await pdaSessions.createSession({
    deviceCode: req.body.device_code,
    deviceSecret: req.body.device_secret,
    userId: req.user.userId,
  })
  return successResponse(res, {
    session_token: data.sessionToken,
    scopes: data.scopes,
    expires_at: data.expiresAt,
    warehouse_id: data.warehouseId,
  }, 'PDA 设备会话已创建')
}))

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
router.get('/version', asyncRoute(async (req, res) => {
  setNoStoreHeaders(res)
  let meta = null
  try {
    meta = loadVersionMeta()
  } catch {
    throw new AppError('版本信息读取失败', 500, 'PDA_VERSION_READ_FAILED')
  }

  if (!meta) {
    return successResponse(res, null)  // 尚未部署 APK
  }

  const apkPath = resolveApkPath(meta)
  if (!fs.existsSync(apkPath)) {
    return successResponse(res, null)
  }

  const stat = fs.statSync(apkPath)
  const size = stat.size
  const base = resolvePublicBase(req)
  const downloadPath = buildPdaDownloadPath(meta, stat)
  return successResponse(res, {
    version:     meta.version,
    versionCode: Number(meta.versionCode) || 0,
    releaseNote: meta.releaseNote || '',
    downloadUrl: base ? `${base}${downloadPath}` : downloadPath,
    size,
    publishedAt: meta.publishedAt || new Date().toISOString(),
    available: true,
  })
}))

/**
 * GET /api/pda/download
 * 下载最新 APK 文件（支持 Range 断点续传）
 */
router.get('/download', asyncRoute(async (req, res) => {
  setNoStoreHeaders(res)
  let meta
  try {
    meta = loadVersionMeta()
  } catch {
    throw new AppError('版本信息 JSON 损坏', 500, 'PDA_VERSION_INVALID')
  }
  if (!meta) {
    throw new AppError('APK 未部署', 404, 'PDA_APK_NOT_DEPLOYED')
  }

  const apkPath = resolveApkPath(meta)
  if (!fs.existsSync(apkPath)) {
    throw new AppError('APK 文件不存在', 404, 'PDA_APK_NOT_FOUND')
  }

  const stat     = fs.statSync(apkPath)
  const fileSize = stat.size
  const range    = req.headers.range

  res.setHeader('Content-Type', 'application/vnd.android.package-archive')
  res.setHeader('Content-Disposition', `attachment; filename="JiXu-Flow-PDA-${meta.version}.apk"`)
  res.setHeader('Accept-Ranges', 'bytes')
  res.setHeader('X-FlowCube-PDA-Version', String(meta.version || ''))
  res.setHeader('X-FlowCube-PDA-Version-Code', String(Number(meta.versionCode) || 0))

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
}))

module.exports = router
