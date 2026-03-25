const express = require('express')
const fs = require('fs').promises
const path = require('path')
const { successResponse } = require('../../utils/response')

const router = express.Router()

const defaultDownloadsDir = path.join(__dirname, '../../../downloads')
const DOWNLOADS_DIR = process.env.APP_UPDATE_DOWNLOADS_DIR || defaultDownloadsDir
const MANIFEST_PATH =
  process.env.APP_UPDATE_MANIFEST_PATH || path.join(DOWNLOADS_DIR, 'latest.json')

// GitHub 配置
const GITHUB_OWNER = process.env.GITHUB_OWNER || 'chengjianghao439'
const GITHUB_REPO = process.env.GITHUB_REPO || 'flowcube2026'
const GITHUB_API_URL = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`

/**
 * 从 GitHub API 获取最新 release 信息
 */
async function fetchFromGitHub() {
  const https = require('https')
  
  return new Promise((resolve, reject) => {
    const req = https.get(GITHUB_API_URL, {
      headers: {
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'FlowCube-ERP'
      }
    }, (res) => {
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
          
          // 使用 release body 作为 notes，如果没有则使用 tag
          const notes = release.body || `FlowCube ERP v${version} 发布`
          
          resolve({ version, url, notes })
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
  
  let url = manifest.url
  if (!url && manifest.filename) {
    const base = process.env.APP_PUBLIC_URL || ''
    url = `${base}/downloads/${manifest.filename}`
  }
  
  return {
    version: manifest.version,
    url,
    notes: manifest.notes || ''
  }
}

/**
 * GET /latest
 * 获取最新版本信息：优先从 GitHub API 获取，回退到本地 latest.json
 */
router.get('/latest', async (req, res, next) => {
  try {
    let data
    
    // 优先尝试从 GitHub 获取
    try {
      data = await fetchFromGitHub()
      console.log('[app-update] Fetched from GitHub:', data.version)
    } catch (githubErr) {
      console.warn('[app-update] GitHub fetch failed:', githubErr.message)
      
      // 回退到本地
      try {
        data = await fetchFromLocal()
        console.log('[app-update] Fetched from local:', data.version)
      } catch (localErr) {
        console.error('[app-update] Local fetch also failed:', localErr.message)
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
    
    if (!data.url) {
      return res.status(500).json({
        success: false,
        message: '下载链接无效',
        data: null,
      })
    }
    
    return successResponse(res, {
      version: data.version,
      url: data.url,
      notes: data.notes
    }, 'ok')
  } catch (e) {
    next(e)
  }
})

module.exports = router