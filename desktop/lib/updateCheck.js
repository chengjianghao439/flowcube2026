// Windows 安装版。后台准备更新，重启由用户明确发起。
const { net } = require('electron')
const fs = require('fs').promises
const fssync = require('fs')
const path = require('path')
const crypto = require('crypto')
const { execFile } = require('node:child_process')
const { pipeline } = require('stream/promises')
const { Transform } = require('stream')
const semver = require('semver')

const IGNORE_STATE_FILE = 'app-update-state.json'
const HEAD_TIMEOUT_MS = 12_000
const DOWNLOAD_TIMEOUT_MS = 30 * 60 * 1000
const MAX_REDIRECTS = 5
const MANAGED_CACHE_NAME = /^[a-f0-9]{64}(?:\.exe|-[a-f0-9-]{36}\.part)$/
const DOWNLOAD_REQUEST_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) FlowCube-ERP-Desktop',
  Accept: '*/*',
}

let state = { stage: 'idle' }
let active = null
let prepared = null

function getUpdateState() {
  return state
}

function supportsWindowsUpdate(app) {
  return app.isPackaged && process.platform === 'win32'
}

function publish(win, next) {
  state = next
  if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) {
    try { win.webContents.send('flowcube:update-state', state) } catch { /* 窗口重载后读取主进程快照 */ }
  }
}

function isGitHubReleaseOrCdnUrl(urlString) {
  try {
    const u = new URL(urlString)
    if (u.hostname === 'github.com' && u.pathname.includes('/releases/download/')) return true
    if (u.hostname === 'githubusercontent.com' || u.hostname.endsWith('.githubusercontent.com')) return true
    return false
  } catch {
    return false
  }
}

function getStatePath(app) {
  return path.join(app.getPath('userData'), IGNORE_STATE_FILE)
}

async function loadIgnoredVersions(app) {
  const filePath = getStatePath(app)
  try {
    const raw = await fs.readFile(filePath, 'utf8')
    const data = JSON.parse(raw)
    if (!Array.isArray(data.ignoredVersions)) return []
    return data.ignoredVersions.filter((v) => typeof v === 'string' && v.trim()).map((v) => v.trim())
  } catch {
    return []
  }
}

function isValidDownloadUrl(url) {
  if (typeof url !== 'string' || !url.trim()) return false
  try {
    const u = new URL(url.trim())
    if (u.protocol !== 'https:') return false
    if (!u.hostname || u.username || u.password) return false
    return true
  } catch {
    return false
  }
}

/**
 * 解析最终下载 URL：优先接口绝对地址；否则相对路径拼 origin；再用 filename 拼 /current/
 * 若接口返回 GitHub 直链，改为同域 /current/，避免境内网络无法直连 GitHub。
 */
function resolveDownloadUrl(payload, origin) {
  const base = String(origin || '').replace(/\/$/, '')
  let url = typeof payload.url === 'string' ? payload.url.trim() : ''
  const fn = typeof payload.filename === 'string' ? payload.filename.trim() : ''
  if (isValidDownloadUrl(url) && isGitHubReleaseOrCdnUrl(url) && fn && base) {
    const sameOrigin = `${base}/current/${encodeURIComponent(fn)}`
    if (isValidDownloadUrl(sameOrigin)) return sameOrigin
  }
  if (isValidDownloadUrl(url)) return url
  if (url.startsWith('/')) {
    const built = `${base}${url}`
    if (isValidDownloadUrl(built)) return built
  }
  if (fn && base) {
    const built = `${base}/current/${encodeURIComponent(fn)}`
    if (isValidDownloadUrl(built)) return built
  }
  return ''
}

function verifyFileIntegrity(filePath, expectedSha256) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256')
    const stream = fssync.createReadStream(filePath)
    stream.on('data', (data) => hash.update(data))
    stream.on('end', () => {
      const actual = hash.digest('hex').toLowerCase()
      const expected = expectedSha256.toLowerCase()
      if (actual !== expected) {
        reject(new Error(`SHA-256 mismatch: expected ${expected}, got ${actual}`))
      } else {
        resolve()
      }
    })
    stream.on('error', reject)
  })
}

/** 主进程从已配置的 HTTPS API 读取清单；不接收渲染层提供的摘要。 */
async function fetchUpdateManifest(origin) {
  if (!isValidDownloadUrl(origin)) throw new Error('更新清单需要有效的 HTTPS 服务器地址')
  const base = new URL(origin).origin
  const res = await net.fetch(`${base}/api/app-update/latest`, {
    redirect: 'error',
    cache: 'no-store',
    credentials: 'omit',
    signal: AbortSignal.timeout(HEAD_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`读取更新清单失败（HTTP ${res.status}）`)
  const body = await res.json()
  if (!body || body.success === false) throw new Error('读取更新清单失败')
  const payload = body.data != null ? body.data : body
  const version = semver.valid(typeof payload.version === 'string' ? payload.version.trim() : '')
  const sha256 = typeof payload.sha256 === 'string' ? payload.sha256.trim().toLowerCase() : ''
  const downloadUrl = resolveDownloadUrl(payload, base)
  if (!version || !/^[a-f0-9]{64}$/.test(sha256) || !isValidDownloadUrl(downloadUrl)) {
    throw new Error('更新清单缺少有效版本、下载地址或 SHA-256 校验值，请联系管理员重新发布')
  }
  return { version, sha256, downloadUrl, notes: typeof payload.notes === 'string' ? payload.notes : '' }
}

function isNewer(current, latest) {
  return Boolean(semver.valid(current) && semver.gt(latest, current))
}

function fetchInstaller(url, signal) {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const request = net.request({ url, method: 'GET', redirect: 'manual', credentials: 'omit',
      cache: 'no-store', headers: DOWNLOAD_REQUEST_HEADERS })
    const abort = () => {
      reject(signal.reason)
      request.abort()
    }
    signal.addEventListener('abort', abort, { once: true })
    request.once('close', () => signal.removeEventListener('abort', abort))
    request.on('error', reject)
    let redirects = 0
    request.on('redirect', (_status, _method, destination) => {
      if (++redirects > MAX_REDIRECTS || !isValidDownloadUrl(destination)) {
        reject(new Error(redirects > MAX_REDIRECTS ? '安装包重定向次数过多' : '安装包重定向不是有效的 HTTPS 地址'))
        request.abort()
        return
      }
      request.followRedirect()
    })
    request.once('response', response => {
      if (response.statusCode !== 200) {
        reject(new Error(`下载更新失败（HTTP ${response.statusCode}）`))
        request.abort()
        return
      }
      resolve(response)
    })
    request.end()
  })
}

async function downloadInstaller(url, file, signal, progress) {
  const response = await fetchInstaller(url, signal)
  const length = Number(response.headers['content-length'])
  const total = Number.isSafeInteger(length) && length > 0 ? length : 0
  let received = 0
  let lastPercent
  let lastReport = 0
  const meter = new Transform({
    transform(chunk, _encoding, callback) {
      received += chunk.length
      const percent = total ? Math.min(100, Math.floor(received * 100 / total)) : undefined
      const now = Date.now()
      if (percent !== lastPercent || now - lastReport >= 250) {
        lastPercent = percent
        lastReport = now
        progress({ received, total, percent })
      }
      callback(null, chunk)
    },
  })
  await pipeline(response, meter, fssync.createWriteStream(file, { flags: 'wx', mode: 0o600 }), { signal })
}

async function verifyInstaller(file, sha256) {
  const stat = await fs.lstat(file)
  if (!stat.isFile()) throw new Error('安装包不是普通文件')
  await verifyFileIntegrity(file, sha256)
}

async function removeStaleCache(directory, retainedFile) {
  const names = await fs.readdir(directory).catch(() => [])
  const stale = names.filter(name => name !== path.basename(retainedFile) && MANAGED_CACHE_NAME.test(name))
  await Promise.allSettled(stale.map(name => fs.unlink(path.join(directory, name))))
}

function versionInfo(app, manifest) {
  return { current: app.getVersion(), version: manifest.version, notes: manifest.notes }
}

async function checkAppUpdate(app, win, apiOriginFn, { manual = false } = {}) {
  if (!supportsWindowsUpdate(app)) {
    if (manual) publish(win, { stage: 'unsupported', current: app.getVersion(), message: '自动更新适用于 Windows 安装版。' })
    return
  }
  if (active || state.stage === 'installing' || (!manual && state.stage !== 'idle')) return
  const controller = new AbortController()
  active = controller
  let info = { current: app.getVersion() }
  let partial
  let downloading = false
  prepared = null
  publish(win, { stage: 'checking', ...info })
  try {
    const origin = await apiOriginFn()
    const manifest = await fetchUpdateManifest(origin)
    info = versionInfo(app, manifest)
    if (process.env.FLOWCUBE_UPDATE_DIAG === '1') console.info('[FlowCube] 更新检查', info.current, '→', info.version)
    if (!isNewer(info.current, info.version)) {
      publish(win, { stage: 'current', ...info })
      return
    }
    if (!manual && (await loadIgnoredVersions(app)).includes(manifest.version)) {
      publish(win, { stage: 'idle', ...info })
      return
    }
    const directory = path.join(app.getPath('userData'), 'update-cache')
    await fs.mkdir(directory, { recursive: true, mode: 0o700 })
    if (!(await fs.lstat(directory)).isDirectory()) throw new Error('更新缓存目录不可用')
    const file = path.join(directory, `${manifest.sha256}.exe`)
    let cached = true
    try {
      await verifyInstaller(file, manifest.sha256)
    } catch (error) {
      cached = false
      if (error.code !== 'ENOENT') await fs.unlink(file)
    }
    if (!cached) {
      downloading = true
      partial = path.join(directory, `${manifest.sha256}-${crypto.randomUUID()}.part`)
      publish(win, { stage: 'downloading', ...info, received: 0, total: 0 })
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS)])
      await downloadInstaller(manifest.downloadUrl, partial, signal, data => {
        if (!controller.signal.aborted) publish(win, { stage: 'downloading', ...info, ...data })
      })
      try { await verifyInstaller(partial, manifest.sha256) }
      catch { throw new Error('安装包 SHA-256 校验失败，请重新下载。') }
      controller.signal.throwIfAborted()
      await fs.rename(partial, file)
      partial = undefined
    }
    await removeStaleCache(directory, file)
    controller.signal.throwIfAborted()
    prepared = { origin: new URL(origin).origin, manifest, file }
    publish(win, { stage: 'ready', ...info })
  } catch (error) {
    if (partial) await fs.unlink(partial).catch(() => {})
    if (controller.signal.aborted) {
      publish(win, { stage: 'cancelled', ...info })
    } else {
      const message = error.name === 'TimeoutError' ? '更新请求超时，请重试。' : error.message || '更新失败，请重试。'
      console.warn('[FlowCube] 更新未完成:', message)
      publish(win, { stage: 'error', ...info, message, showNotice: manual || downloading })
    }
  } finally {
    active = null
  }
}

function cancelUpdateDownload(win) {
  if (state.stage !== 'downloading' || !active) return
  publish(win, { ...state, stage: 'cancelling' })
  active.abort()
}

function launchInstaller(file) {
  const systemRoot = process.env.SystemRoot || 'C:\\Windows'
  const powershell = path.win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  // RunAs 返回时系统已接受安装器启动。路径经环境变量传递，与固定脚本分开。
  const script = "$ErrorActionPreference='Stop'; Start-Process -FilePath $env:FLOWCUBE_INSTALLER_PATH -ArgumentList @('--updated','/S','--force-run') -Verb RunAs"
  return new Promise((resolve, reject) => {
    execFile(powershell, ['-NoProfile', '-NonInteractive', '-Command', script],
      { windowsHide: true, env: { ...process.env, FLOWCUBE_INSTALLER_PATH: file } },
      error => error ? reject(error) : resolve())
  })
}

async function restartToUpdate(app, win, origin, quitForInstall) {
  if (active || state.stage === 'installing') return
  if (!supportsWindowsUpdate(app) || !prepared || state.stage !== 'ready') throw new Error('更新包尚未下载并通过校验')
  const { manifest, file } = prepared
  const info = versionInfo(app, manifest)
  publish(win, { stage: 'installing', ...info })
  try {
    if (!isValidDownloadUrl(origin) || new URL(origin).origin !== prepared.origin) throw new Error('更新服务器已变化，请重新检查。')
    const fresh = await fetchUpdateManifest(origin)
    if (!isNewer(info.current, fresh.version) || fresh.version !== manifest.version
        || fresh.sha256 !== manifest.sha256 || fresh.downloadUrl !== manifest.downloadUrl) {
      throw new Error('更新清单已变化，请重新检查。')
    }
    try { await verifyInstaller(file, fresh.sha256) }
    catch { throw new Error('本地安装包丢失或校验失败，请重新下载。') }
  } catch (error) {
    prepared = null
    publish(win, { stage: 'error', ...info, message: error.message, showNotice: true })
    return
  }
  try {
    await launchInstaller(file)
  } catch {
    publish(win, { stage: 'ready', ...info, message: '安装程序未启动。若取消了系统授权，可以再次点击重启升级。' })
    return
  }
  quitForInstall()
}

module.exports = { supportsWindowsUpdate, getUpdateState, checkAppUpdate, cancelUpdateDownload, restartToUpdate }
