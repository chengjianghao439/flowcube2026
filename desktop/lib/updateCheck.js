const { dialog, shell } = require('electron')
const fs = require('fs').promises
const fssync = require('fs')
const path = require('path')
const { pipeline } = require('stream/promises')
const { Readable, Transform } = require('stream')
const semver = require('semver')

const IGNORE_STATE_FILE = 'app-update-state.json'
const HEAD_TIMEOUT_MS = 12_000
const DOWNLOAD_TIMEOUT_MS = 30 * 60 * 1000
const MAX_DOWNLOAD_RETRIES = 3
/** 留给系统拉起 NSIS / exe 安装器后再退出，避免安装程序尚未启动就释放句柄 */
const QUIT_AFTER_OPEN_MS = 600

/** 更新流程占用（下载 / 安装确认），防止重复触发 */
let updateFlowLocked = false

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

async function ignoreVersion(app, version) {
  const v = String(version).trim()
  if (!v) return
  const list = await loadIgnoredVersions(app)
  if (list.includes(v)) return
  list.push(v)
  const filePath = getStatePath(app)
  await fs.writeFile(filePath, JSON.stringify({ ignoredVersions: list }, null, 2), 'utf8')
}

/**
 * 服务端版本是否高于当前安装版本（semver）；无法解析时回退为规范化字符串不等。
 */
function isRemoteVersionNewer(currentRaw, latestRaw) {
  const current = String(currentRaw).trim()
  const latest = String(latestRaw).trim()
  const c = semver.coerce(current)
  const l = semver.coerce(latest)
  if (c && l) {
    return semver.gt(l, c)
  }
  return latest !== current
}

function isValidDownloadUrl(url) {
  if (typeof url !== 'string' || !url.trim()) return false
  try {
    const u = new URL(url.trim())
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false
    if (!u.hostname) return false
    return true
  } catch {
    return false
  }
}

/**
 * 尽量确认远程资源存在：HEAD；405/501 时尝试 GET Range 首字节。
 * @returns {Promise<'ok'|'missing'|'unknown'>}
 */
function filenameFromUrl(urlString) {
  try {
    const u = new URL(urlString)
    let base = path.basename(String(u.pathname).replace(/\\/g, '/'))
    base = base.split('?')[0] || ''
    base = base.replace(/[<>:"|?*\x00-\x1f]/g, '_').trim()
    if (!base || base === '.' || base === '..') {
      return `FlowCube-Update-${Date.now()}.exe`
    }
    return base
  } catch {
    return `FlowCube-Update-${Date.now()}.bin`
  }
}

async function resolveSaveDir(app) {
  const downloads = app.getPath('downloads')
  try {
    await fs.mkdir(downloads, { recursive: true })
    await fs.access(downloads, fssync.constants.W_OK)
    return downloads
  } catch {
    const sub = path.join(app.getPath('userData'), 'updates')
    await fs.mkdir(sub, { recursive: true })
    return sub
  }
}

/**
 * 使用 Node 流式下载（http/https，随重定向）。
 * @param {string} downloadUrl
 * @param {string} destPath
 * @param {AbortSignal} signal
 */
async function downloadUpdateFile(downloadUrl, destPath, signal) {
  const res = await fetch(downloadUrl, {
    method: 'GET',
    redirect: 'follow',
    signal,
    headers: { 'User-Agent': 'FlowCube-ERP-Desktop/2' },
  })
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText || ''}`.trim())
  }
  const lenHeader = res.headers.get('content-length')
  const total = lenHeader ? parseInt(lenHeader, 10) : 0
  const body = res.body
  if (!body) throw new Error('下载响应为空')

  let received = 0
  let lastLoggedPct = -1
  let lastUnknownLogBytes = 0
  const progressTransform = new Transform({
    transform(chunk, _enc, cb) {
      received += chunk.length
      if (total > 0) {
        const pct = Math.min(100, Math.floor((received / total) * 100))
        if (pct >= lastLoggedPct + 5 || pct === 100) {
          console.log(
            `[FlowCube] 更新包下载进度: ${pct}% (${received} / ${total} bytes)`
          )
          lastLoggedPct = pct
        }
      } else if (
        lastUnknownLogBytes === 0 ||
        received - lastUnknownLogBytes >= 512 * 1024
      ) {
        lastUnknownLogBytes = received
        console.log(
          `[FlowCube] 更新包已接收 ${received} bytes（服务器未提供总大小）`
        )
      }
      cb(null, chunk)
    },
  })

  const nodeIn = Readable.fromWeb(body)
  await pipeline(nodeIn, progressTransform, fssync.createWriteStream(destPath))
  console.log('[FlowCube] 更新包已保存:', destPath)
}

function showBox(parentWindow, options) {
  if (parentWindow && !parentWindow.isDestroyed()) {
    return dialog.showMessageBox(parentWindow, options)
  }
  return dialog.showMessageBox(options)
}

async function probeDownloadUrl(url) {
  try {
    let res = await fetch(url, {
      method: 'HEAD',
      redirect: 'follow',
      signal: AbortSignal.timeout(HEAD_TIMEOUT_MS),
    })
    if (res.ok) return 'ok'
    if (res.status === 405 || res.status === 501) {
      res = await fetch(url, {
        method: 'GET',
        headers: { Range: 'bytes=0-0' },
        redirect: 'follow',
        signal: AbortSignal.timeout(HEAD_TIMEOUT_MS),
      })
      if (res.ok || res.status === 206) return 'ok'
      if (res.status === 404) return 'missing'
      return 'unknown'
    }
    if (res.status === 404) return 'missing'
    return 'unknown'
  } catch {
    return 'unknown'
  }
}

/**
 * 下载更新包到本机；完成后询问是否安装并拉起安装程序。
 * @param {import('electron').App} app
 * @param {import('electron').BrowserWindow | null | undefined} parentWindow
 * @param {string} downloadUrl
 */
async function startUpdateDownload(app, parentWindow, downloadUrl) {
  if (updateFlowLocked) {
    await showBox(parentWindow, {
      type: 'info',
      title: 'FlowCube 更新',
      message: '正在下载或安装更新，请稍候。当前无法开始另一项更新任务。',
      buttons: ['确定'],
      defaultId: 0,
      noLink: true,
    })
    return
  }

  updateFlowLocked = true
  try {
    await runUpdateDownloadAndInstall(app, parentWindow, downloadUrl)
  } finally {
    updateFlowLocked = false
  }
}

/**
 * @param {import('electron').App} app
 * @param {import('electron').BrowserWindow | null | undefined} parentWindow
 * @param {string} downloadUrl
 */
async function runUpdateDownloadAndInstall(app, parentWindow, downloadUrl) {
  const dir = await resolveSaveDir(app)
  const baseName = filenameFromUrl(downloadUrl)
  const destPath = path.join(dir, baseName)

  let lastError
  for (let attempt = 1; attempt <= MAX_DOWNLOAD_RETRIES; attempt++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS)
    try {
      await downloadUpdateFile(downloadUrl, destPath, controller.signal)
      clearTimeout(timer)
      lastError = null
      break
    } catch (err) {
      clearTimeout(timer)
      lastError = err
      try {
        await fs.unlink(destPath)
      } catch {
        /* 忽略 */
      }
      const msg =
        err && err.name === 'AbortError'
          ? '下载超时，请检查网络后重试。'
          : (err && err.message) || String(err)
      console.error(`[FlowCube] 更新包下载失败（第 ${attempt} 次）:`, msg)

      if (attempt >= MAX_DOWNLOAD_RETRIES) {
        await showBox(parentWindow, {
          type: 'error',
          title: '下载失败',
          message: `已重试 ${MAX_DOWNLOAD_RETRIES} 次仍无法完成下载。`,
          detail: msg,
          buttons: ['确定'],
          defaultId: 0,
          noLink: true,
        })
        return
      }

      const retry = await showBox(parentWindow, {
        type: 'warning',
        title: '下载失败',
        message: '无法完成更新包下载，是否重试？',
        detail: msg,
        buttons: ['重试', '取消'],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
      })
      if (retry.response !== 0) return
    }
  }

  if (lastError) return

  const installChoice = await showBox(parentWindow, {
    type: 'info',
    title: 'FlowCube 更新',
    message: '下载完成，是否立即安装？',
    detail: `文件已保存至：\n${destPath}\n\n选择「立即安装」后，将提示您保存数据并再次确认，再关闭本应用并启动安装程序。`,
    buttons: ['立即安装', '稍后'],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  })

  if (installChoice.response !== 0) return

  const saveConfirm = await showBox(parentWindow, {
    type: 'warning',
    title: '确认安装',
    message: '即将关闭本应用并启动安装程序。',
    detail:
      '请务必先保存当前所有工作内容（未保存的表单、单据等可能丢失）。\n\n确认已保存后，再点击「继续安装」。',
    buttons: ['继续安装', '取消'],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
  })
  if (saveConfirm.response !== 0) return

  try {
    await fs.access(destPath, fssync.constants.F_OK)
  } catch {
    await showBox(parentWindow, {
      type: 'error',
      title: '安装失败',
      message: '找不到已下载的安装文件，请重新下载更新。',
      buttons: ['确定'],
      defaultId: 0,
      noLink: true,
    })
    return
  }

  const finalConfirm = await showBox(parentWindow, {
    type: 'question',
    title: '开始安装',
    message: '确定要立即退出并运行安装程序吗？',
    detail: `安装文件：\n${destPath}`,
    buttons: ['确定退出并安装', '再等等'],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
  })
  if (finalConfirm.response !== 0) return

  const openErr = await shell.openPath(destPath)
  if (openErr) {
    await showBox(parentWindow, {
      type: 'error',
      title: '无法启动安装程序',
      message: openErr,
      detail: destPath,
      buttons: ['确定'],
      defaultId: 0,
      noLink: true,
    })
    return
  }

  setTimeout(() => {
    app.quit()
  }, QUIT_AFTER_OPEN_MS)
}

function buildNotesDetail(notes) {
  const text = typeof notes === 'string' ? notes.trim() : ''
  if (text) {
    return `更新内容：\n${text}`
  }
  return '更新内容：\n暂无说明'
}

async function checkAppUpdate(app, parentWindow, apiOriginFn) {
  const origin = apiOriginFn().replace(/\/$/, '')
  try {
    if (updateFlowLocked) {
      await showBox(parentWindow, {
        type: 'info',
        title: 'FlowCube 更新',
        message: '正在下载或安装更新，请稍候。完成前无法再次检查或下载更新。',
        buttons: ['确定'],
        defaultId: 0,
        noLink: true,
      })
      return
    }

    const res = await fetch(`${origin}/api/app-update/latest`)
    if (!res.ok) return
    const body = await res.json()
    const payload = body && body.data != null ? body.data : body
    const latest = typeof payload.version === 'string' ? payload.version.trim() : ''
    const url = typeof payload.url === 'string' ? payload.url.trim() : ''
    const notes = typeof payload.notes === 'string' ? payload.notes : ''

    if (!latest) {
      console.warn('[FlowCube] 更新检查：缺少版本号')
      return
    }
    if (!isValidDownloadUrl(url)) {
      console.warn('[FlowCube] 更新检查：下载地址无效或协议不支持（需 http/https）')
      return
    }

    const current = app.getVersion()
    if (!isRemoteVersionNewer(current, latest)) return

    const ignored = await loadIgnoredVersions(app)
    if (ignored.includes(latest)) return

    const probe = await probeDownloadUrl(url)
    if (probe === 'missing') {
      console.warn('[FlowCube] 更新检查：下载链接不可用（远程返回不存在）', url)
      return
    }
    if (probe === 'unknown') {
      console.warn('[FlowCube] 更新检查：无法确认文件是否存在，仍提示用户（可能为网络限制）', url)
    }

    const boxOptions = {
      type: 'info',
      title: '发现新版本',
      message: `新版本 ${latest} 已发布（当前 ${current}）。`,
      detail: buildNotesDetail(notes),
      buttons: ['立即更新', '忽略此版本', '稍后提醒'],
      defaultId: 0,
      cancelId: 2,
      noLink: true,
    }
    const result =
      parentWindow && !parentWindow.isDestroyed()
        ? await dialog.showMessageBox(parentWindow, boxOptions)
        : await dialog.showMessageBox(boxOptions)

    if (result.response === 0) {
      await startUpdateDownload(app, parentWindow, url)
    } else if (result.response === 1) {
      await ignoreVersion(app, latest)
    }
  } catch (err) {
    console.warn('[FlowCube] 检查更新失败:', err && err.message ? err.message : err)
  }
}

module.exports = {
  checkAppUpdate,
  /** 供测试或后续自动下载模块复用 */
  isRemoteVersionNewer,
  isValidDownloadUrl,
  startUpdateDownload,
}
