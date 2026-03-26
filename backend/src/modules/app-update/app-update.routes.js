const express = require('express')
const fs = require('fs').promises
const path = require('path')
const { successResponse } = require('../../utils/response')

const router = express.Router()

/**
 * GitHub Release 直链 / CDN：境内用户直连常失败，应由同域 /downloads/ 提供安装包。
 * 设为 1 时仍向客户端返回 GitHub 绝对地址（适合境外或已可直连 GitHub 的环境）。
 */
const USE_GITHUB_DIRECT_URL = String(process.env.APP_UPDATE_USE_GITHUB_DIRECT_URL || '').trim() === '1'

function isGitHubReleaseOrCdnUrl(urlString) {
  try {
    const u = new URL(urlString)
    if (u.hostname === 'github.com' && u.pathname.includes('/releases/download/')) return true
    if (u.hostname.endsWith('githubusercontent.com')) return true
    return false
  } catch {
    return false
  }
}

/**
 * 为 Electron / 客户端生成可请求的绝对下载地址（相对路径或仅 filename 时补全）。
 * 从 GitHub API 拿到的 browser_download_url 默认不直接下发，改为同域 /downloads/（需服务器已部署 exe）。
 */
function absolutizeUpdateAssetUrl(req, url, filename) {
  let pathPart = null
  const rawUrl = typeof url === 'string' ? url.trim() : ''
  const fn = filename && String(filename).trim() ? String(filename).trim() : ''

  if (rawUrl) {
    if (/^https?:\/\//i.test(rawUrl)) {
      const allowGithub = USE_GITHUB_DIRECT_URL || !isGitHubReleaseOrCdnUrl(rawUrl)
      if (allowGithub) return rawUrl
      // 有 filename 时走自有域名静态文件，避免客户端直连 GitHub
      if (fn) {
        pathPart = `/downloads/${encodeURIComponent(fn)}`
      } else {
        return rawUrl
      }
    } else {
      pathPart = rawUrl.startsWith('/') ? rawUrl : `/${rawUrl}`
    }
  } else if (fn) {
    pathPart = `/downloads/${encodeURIComponent(fn)}`
  }
  if (!pathPart) return null

  const envBase = (process.env.APP_PUBLIC_URL || '').trim().replace(/\/$/, '')
  if (envBase) {
    return `${envBase}${pathPart}`
  }
  const host = req.get('x-forwarded-host') || req.get('host') || '127.0.0.1:3000'
  let proto = 'http'
  const xfProto = req.get('x-forwarded-proto')
  if (xfProto) {
    proto = xfProto.split(',')[0].trim()
  } else if (req.protocol) {
    proto = String(req.protocol).replace(/:?$/, '')
  }
  return `${proto}://${host}${pathPart}`
}

const defaultDownloadsDir = path.join(__dirname, '../../../downloads')
const DOWNLOADS_DIR = process.env.APP_UPDATE_DOWNLOADS_DIR || defaultDownloadsDir
const MANIFEST_PATH =
  process.env.APP_UPDATE_MANIFEST_PATH || path.join(DOWNLOADS_DIR, 'latest.json')

// GitHub 配置
const GITHUB_OWNER = process.env.GITHUB_OWNER || 'chengjianghao439'
const GITHUB_REPO = process.env.GITHUB_REPO || 'flowcube2026'
const GITHUB_API_URL = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`

/** 去掉 GitHub 自动生成的 Full Changelog / compare 链接等多余行，便于仪表盘展示 */
function sanitizeReleaseNotes(body) {
  if (!body || typeof body !== 'string') return ''
  return body
    .split(/\r?\n/)
    .filter((line) => {
      const s = line.trim()
      if (!s) return true
      if (/^\*\*full changelog\*\*/i.test(s)) return false
      if (/full changelog/i.test(s)) return false
      if (/github\.com\/[^/]+\/[^/]+\/compare\//i.test(s)) return false
      if (/^compare:\s*https?:/i.test(s)) return false
      return true
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * 从 GitHub API 获取最新 release 信息
 */
async function fetchFromGitHub() {
  const https = require('https')
  const token = (process.env.GITHUB_TOKEN || '').trim()
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'FlowCube-ERP-Backend',
  }
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }

  return new Promise((resolve, reject) => {
    const req = https.get(GITHUB_API_URL, { headers }, (res) => {
      let data = ''
      res.on('data', chunk => data += chunk)
      res.on('end', () => {
        try {
          const release = JSON.parse(data)
          if (!release.tag_name) {
            throw new Error('No release found')
          }
          
          // 解析 version (去掉 v 前缀)
          const version = release.tag_name.replace(/^v/, '')
          
          // 查找 exe 文件
          const exeAsset = release.assets?.find(a => a.name.endsWith('.exe'))
          const zipAsset = release.assets?.find(a => a.name.endsWith('.zip'))
          
          // 优先使用 exe，其次 zip
          const asset = exeAsset || zipAsset
          const url = asset?.browser_download_url || null
          
          // 使用 release body；净化后过短则仅占位（后续可与本地 manifest 合并）
          const rawBody = release.body || ''
          let notes = sanitizeReleaseNotes(rawBody)
          if (!notes) notes = `FlowCube ERP v${version} 已发布`

          resolve({
            version,
            url,
            filename: asset?.name || null,
            notes,
          })
        } catch (e) {
          reject(e)
        }
      })
    })
    
    req.on('error', reject)
    req.setTimeout(10000, () => {
      req.destroy()
      reject(new Error('GitHub API timeout'))
    })
  })
}

/**
 * 从本地 latest.json 读取
 */
async function fetchFromLocal() {
  const raw = await fs.readFile(MANIFEST_PATH, 'utf8')
  const manifest = JSON.parse(raw)
  
  const url = manifest.url ? String(manifest.url).trim() : ''
  const filename = manifest.filename ? String(manifest.filename).trim() : ''

  return {
    version: manifest.version,
    url: url || null,
    filename: filename || null,
    notes: manifest.notes || '',
  }
}

/**
 * GET /latest
 * 获取最新版本信息：优先从 GitHub API 获取，回退到本地 latest.json
 */
router.get('/latest', async (req, res, next) => {
  try {
    let data
    let local = null
    try {
      local = await fetchFromLocal()
    } catch (_) { /* 本地无 manifest 时忽略 */ }

    // 优先尝试从 GitHub 获取
    try {
      data = await fetchFromGitHub()
      console.log('[app-update] Fetched from GitHub:', data.version)
    } catch (githubErr) {
      console.warn('[app-update] GitHub fetch failed:', githubErr.message)

      if (local && local.version) {
        data = local
        console.log('[app-update] Using local manifest:', data.version)
      } else {
        return res.status(404).json({
          success: false,
          message: '暂无发布版本',
          data: null,
        })
      }
    }

    if (!data.version) {
      return res.status(500).json({
        success: false,
        message: '版本信息无效',
        data: null,
      })
    }

    let notes = sanitizeReleaseNotes(data.notes || '')
    if (
      local &&
      local.version &&
      String(local.version) === String(data.version) &&
      local.notes &&
      String(local.notes).trim().length > notes.length
    ) {
      notes = String(local.notes).trim()
    } else if ((!notes || notes.length < 40) && local && local.notes && String(local.notes).trim()) {
      const ln = String(local.notes).trim()
      if (!local.version || String(local.version) === String(data.version)) {
        notes = ln
      }
    }

    const absoluteUrl = absolutizeUpdateAssetUrl(req, data.url, data.filename)

    return successResponse(res, {
      version: data.version,
      notes: notes || '',
      url: absoluteUrl,
      filename: data.filename || null,
    }, 'ok')
  } catch (e) {
    next(e)
  }
})

module.exports = router