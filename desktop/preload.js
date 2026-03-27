/**
 * Electron 预加载脚本：不暴露 Node；渲染进程与浏览器一致，通过 localStorage 配置 API。
 */
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('flowcubeDesktop', {
  isDesktop: true,
  /** 订阅主进程推送的可用更新（仅打包安装版） */
  subscribeUpdateAvailable: (cb) => {
    if (typeof cb !== 'function') return () => {}
    const handler = (_event, payload) => {
      try {
        cb(payload)
      } catch {
        /* ignore */
      }
    }
    ipcRenderer.on('flowcube:update-available', handler)
    return () => ipcRenderer.removeListener('flowcube:update-available', handler)
  },
  getAppVersion: () => ipcRenderer.invoke('flowcube:get-app-version'),
  isPackaged: () => ipcRenderer.invoke('flowcube:is-packaged'),
  startUpdateDownload: (downloadUrl) =>
    ipcRenderer.invoke('flowcube:start-update-download', downloadUrl),
  ignoreUpdateVersion: (version) =>
    ipcRenderer.invoke('flowcube:ignore-update-version', version),
  /** ERP 引导完成后的 API 根，供主进程触发自动更新（避免早于 localStorage 写入的竞态） */
  notifyApiOriginReady: (origin) => {
    ipcRenderer.send('flowcube:api-origin-ready', origin)
  },
  /** 渲染层在已自行确认后请求关闭（如将来菜单「退出」） */
  acceptClose: () => {
    ipcRenderer.send('flowcube:close-accept')
  },
  /** 系统原生 messageBox；返回 { response: 按钮索引 } */
  showMessageBox: (payload) =>
    ipcRenderer.invoke('flowcube:show-message-box', payload),
  /** 主进程枚举当前系统已安装打印机（仅桌面端） */
  getSystemPrinters: () => ipcRenderer.invoke('flowcube:get-system-printers'),
  /**
   * 本机 ZPL：printerName 与「打印机管理」中名称一致（从本机添加时的系统打印机名）
   * @param {{ content: string, printerName: string }} opts
   */
  printZpl: (opts) => ipcRenderer.invoke('flowcube:print-zpl', opts),
})
