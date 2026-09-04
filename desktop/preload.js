/**
 * Electron 预加载脚本：不暴露 Node；渲染进程与浏览器一致，通过 localStorage 配置 API。
 */
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('flowcubeDesktop', {
  isDesktop: true,
  /** 订阅主进程推送的可用更新（仅打包安装版） */
  subscribeUpdateAvailable: (cb) => {
    if (typeof cb !== 'function') return () => {}
    let active = true
    let receivedEvent = false
    const deliver = (payload) => {
      if (!active || !payload) return
      try { cb(payload) } catch { /* 消费者异常不得影响 IPC */ }
    }
    const handler = (_event, payload) => {
      receivedEvent = true
      deliver(payload)
    }
    ipcRenderer.on('flowcube:update-available', handler)
    // 先监听再读取快照；读取期间收到新事件时丢弃旧快照，避免倒退或重复弹窗。
    ipcRenderer.invoke('flowcube:get-pending-update').then(payload => {
      if (!receivedEvent) deliver(payload)
    }).catch(() => {})
    return () => {
      active = false
      ipcRenderer.removeListener('flowcube:update-available', handler)
    }
  },
  getAppVersion: () => ipcRenderer.invoke('flowcube:get-app-version'),
  isPackaged: () => ipcRenderer.invoke('flowcube:is-packaged'),
  startUpdateDownload: (request) =>
    ipcRenderer.invoke('flowcube:start-update-download', request),
  ignoreUpdateVersion: (version) =>
    ipcRenderer.invoke('flowcube:ignore-update-version', version),
  /** 手动触发更新检查（仪表盘「检查更新」按钮） */
  triggerUpdateCheck: () =>
    ipcRenderer.invoke('flowcube:trigger-update-check'),
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
  /** 当前桌面工作站标识，用于远程打印任务领取 */
  getClientInfo: () => ipcRenderer.invoke('flowcube:get-client-info'),
  /**
   * 本机 ZPL：printerName 与「打印机管理」中名称一致（从本机添加时的系统打印机名）
   * @param {{ content: string, printerName: string }} opts
   */
  printZpl: (opts) => ipcRenderer.invoke('flowcube:print-zpl', opts),
})
