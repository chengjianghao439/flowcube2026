console.log('🔥 当前 main.js 已加载')

const { app, BrowserWindow, dialog } = require('electron')
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
        try {
          let origin = await getRendererApiOrigin(win)
          if (!origin) {
            await new Promise((r) => setTimeout(r, 2000))
            origin = await getRendererApiOrigin(win)
          }
          if (!origin) {
            console.warn('[FlowCube] 更新检查跳过：渲染进程未配置 API 根地址（API_BASE_URL）')
            return
          }
          await checkAppUpdate(app, win, () => origin)
        } catch (err) {
          console.error('[FlowCube] 自动更新检查失败:', err)
        }
      }, 3500)
    })
  }

  return win
}

app.whenReady().then(() => {
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
