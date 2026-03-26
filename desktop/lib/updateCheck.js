const { dialog, shell } = require('electron')
const fs = require('fs').promises
const fssync = require('fs')
const path = require('path')
const { pipeline } = require('stream/promises')
const { Readable, Transform } = require('stream')
const semver = require('semver')

/** 调试：设为 1 时跳过版本比较，只要接口与下载地址有效即弹更新提示 */
const FORCE_UPDATE = process.env.FORCE_UPDATE === '1'

/**
 * 诊断模式（默认关闭）：开启后强制弹窗 + 跳过版本判断，仅用于排障。
 * 启用：FLOWCUBE_UPDATE_DIAG=1
 */
const UPDATE_DIAG_MODE = process.env.FLOWCUBE_UPDATE_DIAG === '1'

const IGNORE_STATE_FILE = 'app-update-state.json'
const HEAD_TIMEOUT_MS = 12_000
const DOWNLOAD_TIMEOUT_MS = 30 * 60 * 1000
const MAX_DOWNLOAD_RETRIES = 3
/** 留给系统拉起 NSIS / exe 安装器后再退出，避免安装程序尚未启动就释放句柄 */
const QUIT_AFTER_OPEN_MS = 600

/** 更新流程占用（下载 / 安装确认），防止重复触发 */
let updateFlowLocked = false

/** GitHub 对短 UA / 仅 HEAD 常返回 403/404；与主进程 GET 下载保持一致 */
const DOWNLOAD_REQUEST_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 FlowCube-ERP-Desktop',
  Accept: '*/*',
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
 * 解析最终下载 URL：优先接口绝对地址；否则相对路径拼 origin；再用 filename 拼 /downloads/
 * 若接口返回 GitHub 直链，改为同域 /downloads/，避免境内网络无法直连 GitHub。
 */
function resolveDownloadUrl(payload, origin) {
  const base = String(origin || '').replace(/\/$/, '')
  let url = typeof payload.url === 'string' ? payload.url.trim() : ''
  const fn = typeof payload.filename === 'string' ? payload.filename.trim() : ''
  if (isValidDownloadUrl(url) && isGitHubReleaseOrCdnUrl(url) && fn && base) {
    const sameOrigin = `${base}/downloads/${encodeURIComponent(fn)}`
    if (isValidDownloadUrl(sameOrigin)) return sameOrigin
  }
  if (isValidDownloadUrl(url)) return url
  if (url.startsWith('/')) {
    const built = `${base}${url}`
    if (isValidDownloadUrl(built)) return built
  }
  if (fn && base) {
    const built = `${base}/downloads/${encodeURIComponent(fn)}`
    if (isValidDownloadUrl(built)) return built
  }
  return ''
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
    headers: { ...DOWNLOAD_REQUEST_HEADERS },
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
    // GitHub Release 直链对 HEAD 常 404；objects.githubusercontent.com 亦同。用 GET Range 探测首字节。
    if (isGitHubReleaseOrCdnUrl(url)) {
      const res = await fetch(url, {
        method: 'GET',
        headers: { ...DOWNLOAD_REQUEST_HEADERS, Range: 'bytes=0-0' },
        redirect: 'follow',
        signal: AbortSignal.timeout(HEAD_TIMEOUT_MS),
      })
      if (res.ok || res.status === 206) return 'ok'
      if (res.status === 404) return 'missing'
      console.warn('[FlowCube] probeDownloadUrl GitHub/CDN 状态:', res.status, url)
      return 'unknown'
    }

    let res = await fetch(url, {
      method: 'HEAD',
      headers: { ...DOWNLOAD_REQUEST_HEADERS },
      redirect: 'follow',
      signal: AbortSignal.timeout(HEAD_TIMEOUT_MS),
    })
    if (res.ok) return 'ok'
    if (res.status === 405 || res.status === 501) {
      res = await fetch(url, {
        method: 'GET',
        headers: { ...DOWNLOAD_REQUEST_HEADERS, Range: 'bytes=0-0' },
        redirect: 'follow',
        signal: AbortSignal.timeout(HEAD_TIMEOUT_MS),
      })
      if (res.ok || res.status === 206) return 'ok'
      if (res.status === 404) return 'missing'
      return 'unknown'
    }
    if (res.status === 404) return 'missing'
    return 'unknown'
  } catch (err) {
    console.warn('[FlowCube] probeDownloadUrl 异常:', err && err.message ? err.message : err)
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

/**
 * 强制诊断：不依赖 semver，一定走 fetch + 打全量日志 + 无条件弹窗（用于定位为何未弹窗）。
 */
async function runDiagnosticUpdateCheck(app, parentWindow, origin) {
  const base = origin.replace(/\/$/, '')
  const endpoint = `${base}/api/app-update/latest`

  console.log('[FlowCube] 【诊断】开始检查更新')
  console.log('[FlowCube] 【诊断】API 根:', base)
  console.log('[FlowCube] 【诊断】完整请求 URL:', endpoint)
  console.log('[FlowCube] ⚠️ 强制触发更新（已跳过版本比较）')

  const needUpdate = true
  console.log('[FlowCube] 【诊断】needUpdate (固定):', needUpdate)

  let latest = {
    _diag: true,
    _endpoint: endpoint,
    _error: null,
    version: null,
    notes: null,
    url: null,
    filename: null,
  }

  try {
    const res = await fetch(endpoint)
    console.log('[FlowCube] 【诊断】fetch 完成 | HTTP:', res.status, res.statusText)

    let body
    try {
      body = await res.json()
    } catch (parseErr) {
      latest._error = `响应非 JSON: ${parseErr && parseErr.message}`
      console.error('[FlowCube] 【诊断】解析 JSON 失败:', parseErr)
      body = null
    }

    console.log('[FlowCube] 接口返回数据(原始):', body)

    if (body && body.data != null && typeof body.data === 'object') {
      const d = body.data
      latest = {
        ...latest,
        version: d.version != null ? d.version : null,
        notes: d.notes != null ? d.notes : null,
        url: d.url != null ? d.url : null,
        filename: d.filename != null ? d.filename : null,
      }
    } else if (body && typeof body === 'object') {
      latest = {
        ...latest,
        version: body.version != null ? body.version : null,
        notes: body.notes != null ? body.notes : null,
        url: body.url != null ? body.url : null,
        filename: body.filename != null ? body.filename : null,
      }
    }

    let url =
      typeof latest.url === 'string' && latest.url.trim()
        ? latest.url.trim()
        : ''
    const fn =
      typeof latest.filename === 'string' && latest.filename.trim()
        ? latest.filename.trim()
        : ''

    if (!url && fn) {
      url = `${base}/downloads/${encodeURIComponent(fn)}`
      latest._constructedUrl = true
    } else if (url && url.startsWith('/') && !/^https?:\/\//i.test(url)) {
      url = `${base}${url}`
      latest._constructedUrl = true
    } else if (url && !/^https?:\/\//i.test(url) && fn) {
      url = `${base}/downloads/${encodeURIComponent(fn)}`
      latest._constructedUrl = true
    }

    latest._finalDownloadUrl = url || null
    console.log('[FlowCube] 接口返回数据(latest):', latest)
    console.log('[FlowCube] 最终下载地址:', latest._finalDownloadUrl || '(无)')
  } catch (err) {
    latest._error = err && err.message ? err.message : String(err)
    console.error('[FlowCube] 【诊断】fetch 异常:', err)
  }

  const boxOpts = {
    type: 'info',
    title: 'FlowCube 更新诊断',
    message: '检测到更新（强制模式）',
    detail: JSON.stringify(latest, null, 2).slice(0, 32000),
    buttons: ['确定'],
  }
  if (parentWindow && !parentWindow.isDestroyed()) {
    await dialog.showMessageBox(parentWindow, boxOpts)
  } else {
    await dialog.showMessageBox(boxOpts)
  }
  console.log('[FlowCube] 已强制弹出更新窗口')
}

async function checkAppUpdate(app, parentWindow, apiOriginFn) {
  const origin = apiOriginFn().replace(/\/$/, '')
  console.log('[FlowCube] 开始检查更新 | API 根:', origin)

  if (UPDATE_DIAG_MODE) {
    try {
      await runDiagnosticUpdateCheck(app, parentWindow, origin)
    } catch (err) {
      console.error('[FlowCube] 【诊断】runDiagnosticUpdateCheck 失败:', err)
    }
    return
  }

  if (FORCE_UPDATE) {
    console.log('[FlowCube] FORCE_UPDATE=1，版本比较将跳过（仅用于调试）')
  }

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

    const endpoint = `${origin}/api/app-update/latest`
    const res = await fetch(endpoint)
    console.log('[FlowCube] 更新接口 HTTP:', res.status, res.statusText, '|', endpoint)

    if (!res.ok) {
      console.error('[FlowCube] 更新接口请求失败，状态码:', res.status)
      return
    }

    const body = await res.json()
    console.log('[FlowCube] 接口返回:', JSON.stringify(body))

    if (body && body.success === false) {
      console.error('[FlowCube] 接口 success=false:', body.message || body)
      return
    }

    const payload = body && body.data != null ? body.data : body
    const latest = typeof payload.version === 'string' ? payload.version.trim() : ''
    const notes = typeof payload.notes === 'string' ? payload.notes : ''

    const resolvedUrl = resolveDownloadUrl(
      { url: payload.url, filename: payload.filename },
      origin,
    )

    console.log('[FlowCube] 解析后下载 URL:', resolvedUrl || '(无)')

    if (!latest) {
      console.warn('[FlowCube] 更新检查中止：缺少版本号')
      return
    }

    const current = app.getVersion()
    const cSem = semver.coerce(current)
    const lSem = semver.coerce(latest)
    const semverGt =
      cSem && lSem ? semver.gt(lSem, cSem) : isRemoteVersionNewer(current, latest)

    console.log('[FlowCube] 当前版本:', current)
    console.log('[FlowCube] 最新版本:', latest)
    console.log(
      '[FlowCube] 是否需要更新(semver.gt):',
      semverGt,
      '| coerce 当前:',
      cSem ? cSem.version : '(无法解析)',
      '| coerce 最新:',
      lSem ? lSem.version : '(无法解析)',
    )

    const needUpdate = FORCE_UPDATE || semverGt
    console.log('[FlowCube] 是否需要更新(最终):', needUpdate, FORCE_UPDATE ? '(含 FORCE_UPDATE)' : '')

    if (!needUpdate) {
      console.log('[FlowCube] 不弹窗：当前已是最新或未启用强制更新')
      return
    }

    if (!isValidDownloadUrl(resolvedUrl)) {
      console.error(
        '[FlowCube] 更新检查中止：下载地址无效（需完整 http/https）。payload.url / filename 均未解析出可用链接。',
      )
      if (FORCE_UPDATE) {
        await showBox(parentWindow, {
          type: 'warning',
          title: 'FlowCube 更新（调试）',
          message: 'FORCE_UPDATE=1 已开启，但接口未返回可下载的安装包链接。',
          detail: '请检查后端 latest.json 的 url / filename，或设置 APP_PUBLIC_URL。',
          buttons: ['确定'],
          defaultId: 0,
          noLink: true,
        })
      }
      return
    }

    const ignored = await loadIgnoredVersions(app)
    if (ignored.includes(latest) && !FORCE_UPDATE) {
      console.log('[FlowCube] 用户已忽略版本:', latest)
      return
    }

    try {
      new URL(resolvedUrl)
    } catch (e) {
      console.error('[FlowCube] new URL 解析失败:', e)
      return
    }

    const probe = await probeDownloadUrl(resolvedUrl)
    console.log('[FlowCube] 下载链接探测结果:', probe, '|', resolvedUrl)

    if (probe === 'missing') {
      console.error('[FlowCube] 更新检查中止：远程文件不存在 (404)', resolvedUrl)
      return
    }
    if (probe === 'unknown') {
      console.warn(
        '[FlowCube] 无法确认文件是否存在（HEAD 受限等），仍尝试提示用户:',
        resolvedUrl,
      )
    }

    console.log('[FlowCube] 弹出更新提示')

    const boxOptions = {
      type: 'info',
      title: FORCE_UPDATE ? '发现新版本（调试强制）' : '发现新版本',
      message: FORCE_UPDATE
        ? `【调试】将显示更新流程（当前 ${current}，服务端标记 ${latest}）。`
        : `新版本 ${latest} 已发布（当前 ${current}）。`,
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
      await startUpdateDownload(app, parentWindow, resolvedUrl)
    } else if (result.response === 1 && !FORCE_UPDATE) {
      await ignoreVersion(app, latest)
    }
  } catch (err) {
    console.error('[FlowCube] 更新失败:', err)
  }
}

module.exports = {
  checkAppUpdate,
  /** 供测试或后续自动下载模块复用 */
  isRemoteVersionNewer,
  isValidDownloadUrl,
  startUpdateDownload,
}
