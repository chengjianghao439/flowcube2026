const express = require('express')
const fs = require('fs').promises
const path = require('path')
const { successResponse } = require('../../utils/response')
const { env } = require('../../config/env')

const router = express.Router()

/**
 * 桌面更新以本地 canonical manifest 为权威来源。
 * GitHub Release 仅在显式开启 direct URL 时作为降级排障能力，避免多发布源竞争。
 */
const USE_GITHUB_DIRECT_URL = env.APP_UPDATE_USE_GITHUB_DIRECT_URL

async function fileExists(filePath) {
  if (!filePath) return false
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

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
 */
function absolutizeUpdateAssetUrl(req, url, filename) {
  let pathPart = null
  const rawUrl = typeof url === 'string' ? url.trim() : ''
  const fn = filename && String(filename).trim() ? String(filename).trim() : ''

  if (rawUrl) {
    if (/^https?:\/\//i.test(rawUrl)) {
      const allowGithub = USE_GITHUB_DIRECT_URL || !isGitHubReleaseOrCdnUrl(rawUrl)
      if (allowGithub) return rawUrl
      return null
    } else {
      pathPart = rawUrl.startsWith('/') ? rawUrl : `/${rawUrl}`
    }
  } else if (fn) {
    pathPart = `/current/${encodeURIComponent(fn)}`
  }
  if (!pathPart) return null

  const envBase = env.APP_PUBLIC_URL
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

const DOWNLOADS_DIR = env.APP_UPDATE_DOWNLOADS_DIR
const MANIFEST_PATH = env.APP_UPDATE_MANIFEST_PATH || path.join(DOWNLOADS_DIR, 'latest.json')

// GitHub 配置
const GITHUB_OWNER = env.GITHUB_OWNER
const GITHUB_REPO = env.GITHUB_REPO
const GITHUB_API_URL = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`

function normalizeVersion(v) {
  return String(v || '')
    .trim()
    .replace(/^v/i, '')
}

function compareVersions(a, b) {
  const pa = normalizeVersion(a).split('.').map((item) => Number.parseInt(item, 10) || 0)
  const pb = normalizeVersion(b).split('.').map((item) => Number.parseInt(item, 10) || 0)
  const len = Math.max(pa.length, pb.length)
  for (let i = 0; i < len; i += 1) {
    const av = pa[i] || 0
    const bv = pb[i] || 0
    if (av > bv) return 1
    if (av < bv) return -1
  }
  return 0
}

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
          if (!notes) notes = `极序 Flow ERP v${version} 已发布`

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
  const filename = manifest.filename || manifest.fileName
    ? String(manifest.filename || manifest.fileName).trim()
    : path.basename(url.split('?')[0] || '')

  return {
    version: manifest.version,
    url: url || null,
    filename: filename || null,
    notes: manifest.notes || '',
    sha256: manifest.sha256 || null,
    publishedAt: manifest.publishedAt || null,
  }
}

function resolveManifestAssetPath(manifest) {
  const rawUrl = typeof manifest.url === 'string' ? manifest.url.trim() : ''
  if (!rawUrl || /^https?:\/\//i.test(rawUrl)) return ''
  const pathname = rawUrl.split('?')[0]
  if (pathname.startsWith('/versions/')) {
    return path.join(DOWNLOADS_DIR, pathname.slice('/'.length))
  }
  if (pathname.startsWith('/current/')) {
    return path.join(DOWNLOADS_DIR, pathname.slice('/'.length))
  }
  // Deprecated compatibility path. Canonical manifests must use /versions/ or /current/.
  if (pathname.startsWith('/downloads/')) {
    return path.join(DOWNLOADS_DIR, pathname.slice('/downloads/'.length))
  }
  return path.join(DOWNLOADS_DIR, pathname.replace(/^\/+/, ''))
}

/**
 * GET /latest
 * 获取最新版本信息：本地 latest.json 是唯一默认权威入口
 */
router.get('/latest', async (req, res, next) => {
  try {
    let local = null
    try {
      local = await fetchFromLocal()
    } catch (err) {
      if (!err || err.code !== 'ENOENT') throw err
      /* 本地无 manifest 时忽略 */
    }

    if (!local || !local.version) {
      if (USE_GITHUB_DIRECT_URL) {
        try {
          const github = await fetchFromGitHub()
          const githubUrl = absolutizeUpdateAssetUrl(req, github.url, github.filename)
          return successResponse(res, {
            version: github.version,
            notes: sanitizeReleaseNotes(github.notes || ''),
            url: githubUrl,
            filename: github.filename,
          }, 'ok')
        } catch (githubErr) {
          console.warn('[app-update] GitHub direct fallback failed:', githubErr.message)
        }
      }
        return res.status(404).json({
          success: false,
          message: '暂无发布版本',
          data: null,
        })
    }

    if (!local.version) {
      return res.status(500).json({
        success: false,
        message: '版本信息无效',
        data: null,
      })
    }

    const notes = sanitizeReleaseNotes(local.notes || '')
    const assetPath = resolveManifestAssetPath(local)
    if (assetPath && !await fileExists(assetPath)) {
      return res.status(500).json({
        success: false,
        message: `更新 manifest 指向的安装包不存在: ${local.url}`,
        data: null,
      })
    }
    const absoluteUrl = absolutizeUpdateAssetUrl(req, local.url, local.filename)
    if (!absoluteUrl) {
      return res.status(500).json({
        success: false,
        message: '更新 manifest 下载地址无效',
        data: null,
      })
    }

    return successResponse(res, {
      version: local.version,
      notes: notes || '',
      url: absoluteUrl,
      filename: local.filename,
      sha256: local.sha256,
      publishedAt: local.publishedAt,
    }, 'ok')
  } catch (e) {
    next(e)
  }
})

module.exports = router
