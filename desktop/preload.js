/**
 * Electron 预加载脚本：不暴露 Node；渲染进程与浏览器一致，通过 localStorage 配置 API。
 */
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('flowcubeDesktop', {
  isDesktop: true,
  /** ERP 引导完成后的 API 根，供主进程触发自动更新（避免早于 localStorage 写入的竞态） */
  notifyApiOriginReady: (origin) => {
    ipcRenderer.send('flowcube:api-origin-ready', origin)
  },
  onCloseRequest: (cb) => {
    const listener = () => {
      cb()
    }
    ipcRenderer.on('flowcube:close-request', listener)
    return () => ipcRenderer.removeListener('flowcube:close-request', listener)
  },
  acceptClose: () => {
    ipcRenderer.send('flowcube:close-accept')
  },
  onDesktopMessageBox: (cb) => {
    const listener = (_e, payload) => {
      cb(payload)
    }
    ipcRenderer.on('desktop-show-message-box', listener)
    return () => ipcRenderer.removeListener('desktop-show-message-box', listener)
  },
  sendDesktopMessageBoxResponse: (id, response) => {
    ipcRenderer.send('desktop-message-box-response', { id, response })
  },
  /** 主进程枚举当前系统已安装打印机（仅桌面端） */
  getSystemPrinters: () => ipcRenderer.invoke('flowcube:get-system-printers'),
  /**
   * 本机 ZPL：host+port 为网口斑马；macOS/Linux 可仅用 lpQueue（lp -o raw）
   * @param {{ content: string, host?: string, port?: number, lpQueue?: string }} opts
   */
  printZpl: (opts) => ipcRenderer.invoke('flowcube:print-zpl', opts),
})
