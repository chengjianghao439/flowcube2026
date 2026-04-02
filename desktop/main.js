console.log('🔥 当前 main.js 已加载')

const { app, BrowserWindow, Menu, ipcMain, dialog } = require('electron')
const os = require('os')
const path = require('path')
const fs = require('fs')
const { pathToFileURL } = require('url')
const { checkAppUpdate, startUpdateDownload, ignoreVersion, isValidDownloadUrl } = require('./lib/updateCheck')
const { printZpl } = require('./lib/localPrint')

/** 与 Chromium 枚举一致，避免 PowerShell Get-Printer 与 OpenPrinter 名称不一致导致误拒 */
function normalizeQueueLabel(s) {
  return String(s ?? '')
    .trim()
    .replace(/\u00a0/g, ' ')
    .replace(/\u200b/g, '')
}

/**
 * 将 ERP 传入的名称解析为当前 webContents 可见的系统打印机名（与「打印机管理」同源）
 * @returns {Promise<string>}
 */
async function resolveCanonicalPrinterNameForRaw(event, requestedName) {
  const raw = normalizeQueueLabel(requestedName)
  if (!raw) return raw
  const wc = event.sender
  if (!wc || typeof wc.getPrintersAsync !== 'function') {
    return raw
  }
  let list = []
  try {
    list = await wc.getPrintersAsync()
  } catch (e) {
    console.warn('[FlowCube] getPrintersAsync 失败，使用原始打印机名:', e?.message || e)
    return raw
  }
  const printers = Array.isArray(list) ? list : []
  if (printers.length === 0) {
    return raw
  }
  const target = raw.toLowerCase()
  for (const p of printers) {
    if (normalizeQueueLabel(p.name).toLowerCase() === target) {
      return p.name
    }
  }
  for (const p of printers) {
    const d = normalizeQueueLabel(p.displayName || '')
    if (d && d.toLowerCase() === target) {
      return p.name
    }
  }
  const names = printers.map((p) => p.name).filter(Boolean)
  const sample = names.slice(0, 14).join('、')
  const more = names.length > 14 ? ` … 共 ${names.length} 台` : ''
  throw new Error(
    `找不到打印机「${raw}」。请打开「设置 → 打印机管理」，用「从本机添加」重新选择标签机，勿手改打印机名称；须与下列系统名称之一完全一致：${sample}${more}`,
  )
}

/** 用户已在渲染层确认退出，允许真正关闭窗口（与 ipc flowcube:close-accept 共用） */
const closeAllowed = new WeakSet()
let mainWindow = null

function focusExistingWindow() {
  const win = mainWindow && !mainWindow.isDestroyed()
    ? mainWindow
    : BrowserWindow.getAllWindows().find(item => item && !item.isDestroyed())
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

function quitForInstaller() {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win || win.isDestroyed()) continue
    try {
      win.webContents.executeJavaScript(
        `window.dispatchEvent(new CustomEvent('flowcube-quit-confirmed'))`,
        true,
      ).catch(() => {})
    } catch {
      /* ignore */
    }
    closeAllowed.add(win)
    try {
      win.close()
    } catch {
      /* ignore */
    }
  }
  setTimeout(() => app.exit(0), 150)
}

function readEmbeddedBuildCommit() {
  try {
    return fs.readFileSync(path.join(__dirname, '.git-build-sha'), 'utf8').trim()
  } catch {
    return null
  }
}

console.log('🔥 BUILD VERSION:', app.getVersion())
console.log(
  '🔥 BUILD COMMIT:',
  process.env.GITHUB_SHA || readEmbeddedBuildCommit() || 'local',
)

process.on('uncaughtException', (err) => {
  console.error('[FlowCube] 未捕获异常:', err)
})

process.on('unhandledRejection', (reason) => {
  console.error('[FlowCube] Promise 异常:', reason)
})

function rendererDist() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'renderer')
  }
  return path.join(__dirname, '..', 'frontend', 'dist')
}

function normalizeApiOrigin(raw) {
  if (!raw || typeof raw !== 'string') return ''
  const t = raw.trim().replace(/\/$/, '')
  if (!t) return ''
  try {
    const u = new URL(t.startsWith('http') ? t : `http://${t}`)
    return `${u.protocol}//${u.host}`
  } catch {
    return ''
  }
}

function buildDesktopClientInfo() {
  const hostnameRaw = String(os.hostname() || '').trim() || 'flowcube-desktop'
  const hostname = hostnameRaw.slice(0, 200)
  const clientId = `desktop:${hostnameRaw}`
    .replace(/[^A-Za-z0-9_.:-]/g, '_')
    .slice(0, 200)
  return { clientId, hostname }
}

async function getRendererApiOrigin(win) {
  const script = `(function(){
    try {
      var v = localStorage.getItem('API_BASE_URL') || localStorage.getItem('flowcube:apiOrigin') || '';
      return v.trim();
    } catch (e) { return ''; }
  })()`
  const raw = await win.webContents.executeJavaScript(script, true)
  return normalizeApiOrigin(raw)
}

/** 打包后自动更新检查延迟：给引导写入 API 根地址留时间 */
const PACKAGED_UPDATE_CHECK_DELAY_MS = Math.min(
  30_000,
  Math.max(800, Number(process.env.FLOWCUBE_UPDATE_CHECK_DELAY_MS) || 1800),
)

/** 安装包仅触发一次自动更新检查（IPC 优先，避免引导写入 localStorage 晚于主进程定时器） */
let packagedUpdateCheckStarted = false
function triggerPackagedUpdateCheck(win, originRaw) {
  if (!app.isPackaged || packagedUpdateCheckStarted) return
  const origin = normalizeApiOrigin(originRaw)
  if (!origin) return
  packagedUpdateCheckStarted = true
  setTimeout(() => {
    checkAppUpdate(app, win, () => origin, { ui: 'ipc', quitForInstall: quitForInstaller }).catch((err) => {
      console.error('[FlowCube] 自动更新检查失败:', err)
    })
  }, PACKAGED_UPDATE_CHECK_DELAY_MS)
}

ipcMain.on('flowcube:api-origin-ready', (event, origin) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (win && !win.isDestroyed()) triggerPackagedUpdateCheck(win, origin)
})

ipcMain.handle('flowcube:get-app-version', () => app.getVersion())

ipcMain.handle('flowcube:is-packaged', () => app.isPackaged)

ipcMain.handle('flowcube:start-update-download', async (event, downloadUrl) => {
  const url = typeof downloadUrl === 'string' ? downloadUrl.trim() : ''
  if (!isValidDownloadUrl(url)) {
    throw new Error('无效的下载地址')
  }
  const win = BrowserWindow.fromWebContents(event.sender)
  await startUpdateDownload(app, win, url, { quitForInstall: quitForInstaller })
})

ipcMain.handle('flowcube:ignore-update-version', async (_event, version) => {
  const v = typeof version === 'string' ? version.trim() : ''
  if (!v) return
  await ignoreVersion(app, v)
})

ipcMain.on('flowcube:close-accept', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win || win.isDestroyed()) return
  closeAllowed.add(win)
  win.close()
})

/** 渲染进程请求系统原生提示框（离开确认、confirmAction 等） */
ipcMain.handle('flowcube:show-message-box', async (event, payload) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  const parent = win && !win.isDestroyed() ? win : null
  const p = payload && typeof payload === 'object' ? payload : {}
  const options = {
    type: p.type || 'none',
    title: typeof p.title === 'string' ? p.title : '',
    message: typeof p.message === 'string' ? p.message : '',
    buttons:
      Array.isArray(p.buttons) && p.buttons.length ? p.buttons : ['确定'],
    defaultId: typeof p.defaultId === 'number' ? p.defaultId : 0,
    noLink: p.noLink !== false,
  }
  if (typeof p.detail === 'string' && p.detail) options.detail = p.detail
  if (typeof p.cancelId === 'number') options.cancelId = p.cancelId
  return dialog.showMessageBox(parent, options)
})

/** 枚举本机已安装打印机（与系统「打印机与扫描仪」一致），供添加打印机仅从列表选择 */
ipcMain.handle('flowcube:get-system-printers', async (event) => {
  const wc = event.sender
  if (!wc || typeof wc.getPrintersAsync !== 'function') {
    return []
  }
  try {
    const list = await wc.getPrintersAsync()
    return (list || []).map((p) => ({
      name: p.name,
      displayName: p.displayName || p.name,
      description: p.description || '',
      status: p.status,
      isDefault: !!p.isDefault,
    }))
  } catch (e) {
    console.error('[flowcube:get-system-printers]', e)
    return []
  }
})

ipcMain.handle('flowcube:get-client-info', async () => buildDesktopClientInfo())

/** 本机直连：按打印机名称 RAW 出 ZPL（Windows WinSpool / macOS·Linux lp） */
ipcMain.handle('flowcube:print-zpl', async (event, opts) => {
  try {
    const o = opts && typeof opts === 'object' ? { ...opts } : {}
    if (o.printerName != null) {
      o.printerName = await resolveCanonicalPrinterNameForRaw(event, o.printerName)
    }
    await printZpl(o)
    return null
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    throw new Error((msg || '').trim() || '本机 RAW 打印失败')
  }
})

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  win.on('close', (e) => {
    if (closeAllowed.has(win)) return
    e.preventDefault()
    void (async () => {
      const { response } = await dialog.showMessageBox(win, {
        type: 'question',
        buttons: ['退出应用', '取消'],
        defaultId: 1,
        cancelId: 1,
        title: '退出极序 Flow',
        message: '确定要退出极序 Flow吗？',
        noLink: true,
      })
      if (response !== 0) return
      try {
        await win.webContents.executeJavaScript(
          `window.dispatchEvent(new CustomEvent('flowcube-quit-confirmed'))`,
          true,
        )
      } catch {
        /* 页面未就绪等 */
      }
      closeAllowed.add(win)
      win.close()
    })()
  })

  win.once('ready-to-show', () => {
    win.show()
  })

  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
  })

  const indexHtml = path.join(rendererDist(), 'index.html')
  const url = pathToFileURL(indexHtml).href + '#/'
  win.loadURL(url).catch((err) => {
    console.error('[FlowCube] 无法加载界面文件:', indexHtml, err)
  })

  if (app.isPackaged) {
    win.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        if (packagedUpdateCheckStarted) return
        try {
          let origin = await getRendererApiOrigin(win)
          if (!origin) {
            await new Promise((r) => setTimeout(r, 3000))
            origin = await getRendererApiOrigin(win)
          }
          if (!origin) {
            await new Promise((r) => setTimeout(r, 5000))
            origin = await getRendererApiOrigin(win)
          }
          if (!origin) {
            console.warn(
              '[FlowCube] 更新检查跳过：渲染进程未配置 API 根地址（API_BASE_URL）；请确认已保存 ERP API 设置',
            )
            return
          }
          triggerPackagedUpdateCheck(win, origin)
        } catch (err) {
          console.error('[FlowCube] 自动更新检查（fallback）失败:', err)
        }
      }, 8000)
    })
  }

  return win
}

const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    focusExistingWindow()
  })
  app.whenReady().then(() => {
    // 去掉默认「文件 / 编辑 / 视图…」等系统菜单栏（Windows/Linux）；界面以 Web 为准
    Menu.setApplicationMenu(null)

    mainWindow = createWindow()

    console.log('🚀 应用已启动')

    if (!app.isPackaged) {
      console.log('ℹ️ 未打包：自动更新仅在安装包中启用')
    }
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    mainWindow = createWindow()
    return
  }
  focusExistingWindow()
})
