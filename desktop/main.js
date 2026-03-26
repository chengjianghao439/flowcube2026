console.log('🔥 当前 main.js 已加载')

const { app, BrowserWindow, dialog, Menu, ipcMain } = require('electron')
const path = require('path')
const fs = require('fs')
const { pathToFileURL } = require('url')
const { checkAppUpdate } = require('./lib/updateCheck')

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

/** 安装包仅触发一次自动更新检查（IPC 优先，避免引导写入 localStorage 晚于主进程定时器） */
let packagedUpdateCheckStarted = false
function triggerPackagedUpdateCheck(win, originRaw) {
  if (!app.isPackaged || packagedUpdateCheckStarted) return
  const origin = normalizeApiOrigin(originRaw)
  if (!origin) return
  packagedUpdateCheckStarted = true
  setTimeout(() => {
    checkAppUpdate(app, win, () => origin).catch((err) => {
      console.error('[FlowCube] 自动更新检查失败:', err)
    })
  }, 500)
}

ipcMain.on('flowcube:api-origin-ready', (event, origin) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (win && !win.isDestroyed()) triggerPackagedUpdateCheck(win, origin)
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

  let allowCloseWithoutConfirm = false
  win.on('close', async (e) => {
    if (allowCloseWithoutConfirm) return
    e.preventDefault()
    const { response } = await dialog.showMessageBox(win, {
      type: 'question',
      buttons: ['取消', '退出应用'],
      defaultId: 0,
      cancelId: 0,
      title: '退出 FlowCube',
      message: '确定要退出 FlowCube ERP 吗？',
      noLink: true,
    })
    if (response === 1) {
      allowCloseWithoutConfirm = true
      win.close()
    }
  })

  win.once('ready-to-show', () => {
    win.show()
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

app.whenReady().then(() => {
  // 去掉默认「文件 / 编辑 / 视图…」等系统菜单栏（Windows/Linux）；界面以 Web 为准
  Menu.setApplicationMenu(null)

  createWindow()

  console.log('🚀 应用已启动')

  if (!app.isPackaged) {
    console.log('ℹ️ 未打包：自动更新仅在安装包中启用')
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})
