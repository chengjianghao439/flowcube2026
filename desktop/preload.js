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
})
