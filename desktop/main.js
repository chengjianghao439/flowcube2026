const { app, BrowserWindow } = require('electron')
const path = require('path')
const { pathToFileURL } = require('url')
const { checkAppUpdate } = require('./lib/updateCheck')

function apiOrigin() {
  const raw = process.env.FLOWCUBE_API_ORIGIN || 'http://127.0.0.1:3000'
  return raw.replace(/\/$/, '')
}

function rendererDist() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'renderer')
  }
  return path.join(__dirname, '..', 'frontend', 'dist')
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
    setImmediate(() => checkAppUpdate(app, win, apiOrigin))
  })

  const indexHtml = path.join(rendererDist(), 'index.html')
  // HashRouter 需要 hash；直接 loadFile 时部分环境下初始 location 无 #，会导致白屏
  const url = pathToFileURL(indexHtml).href + '#/'
  win.loadURL(url).catch((err) => {
    console.error('[FlowCube] 无法加载界面文件:', indexHtml, err)
  })
}

app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})
