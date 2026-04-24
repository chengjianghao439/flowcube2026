const { app, BrowserWindow, Menu, shell, dialog } = require('electron')
const path = require('path')
const { spawn } = require('child_process')

let mainWindow = null
let backendProcess = null

const BACKEND_PORT = 3000
const FRONTEND_URL = process.env.NODE_ENV === 'development'
  ? 'http://localhost:5173'
  : `http://localhost:${BACKEND_PORT}`

function startBackend() {
  const backendPath = path.join(__dirname, '../backend/index.js')
  backendProcess = spawn(process.execPath, [backendPath], {
    env: { ...process.env, PORT: String(BACKEND_PORT) },
    stdio: 'pipe',
  })
  backendProcess.stdout.on('data', d => console.log('[backend]', d.toString()))
  backendProcess.stderr.on('data', d => console.error('[backend]', d.toString()))
  backendProcess.on('exit', code => console.log('[backend] exited with code', code))
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280, height: 800,
    minWidth: 1024, minHeight: 640,
    title: 'FlowCube ERP',
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  })

  const menu = Menu.buildFromTemplate([
    { label: '文件', submenu: [{ role: 'quit', label: '退出' }] },
    { label: '视图', submenu: [{ role: 'reload', label: '刷新' }, { role: 'toggleDevTools', label: '开发者工具' }, { type: 'separator' }, { role: 'zoomIn', label: '放大' }, { role: 'zoomOut', label: '缩小' }, { role: 'resetZoom', label: '重置缩放' }] },
    { label: '帮助', submenu: [{ label: '关于 FlowCube', click: () => dialog.showMessageBox(mainWindow, { title: 'FlowCube ERP', message: 'FlowCube ERP\n版本 1.0.0\n\n企业进销存管理系统' }) }] },
  ])
  Menu.setApplicationMenu(menu)

  // 等待后端启动后再加载页面
  let retries = 0
  const tryLoad = () => {
    require('http').get(FRONTEND_URL, () => mainWindow.loadURL(FRONTEND_URL)).on('error', () => {
      if (retries++ < 20) setTimeout(tryLoad, 500)
      else mainWindow.loadURL(FRONTEND_URL)
    })
  }
  setTimeout(tryLoad, 1000)

  mainWindow.on('closed', () => { mainWindow = null })
}

app.whenReady().then(() => {
  startBackend()
  createWindow()
  app.on('activate', () => { if (!mainWindow) createWindow() })
})

app.on('window-all-closed', () => {
  if (backendProcess) backendProcess.kill()
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => { if (backendProcess) backendProcess.kill() })
