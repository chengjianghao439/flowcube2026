/**
 * Electron 预加载脚本：不暴露 Node；渲染进程与浏览器一致，通过 localStorage 配置 API。
 */
const { contextBridge } = require('electron')

contextBridge.exposeInMainWorld('flowcubeDesktop', {
  isDesktop: true,
})
