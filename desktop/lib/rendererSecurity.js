'use strict'

/** 本地入口按完整 file URL 匹配，只允许 HashRouter 的 hash 变化。 */
function createRendererGuard() {
  const entries = new WeakMap()
  const documentUrl = raw => {
    try { const url = new URL(raw); if (url.protocol !== 'file:') return ''; url.hash = ''; return url.href } catch { return '' }
  }
  function register(contents, entryUrl) { entries.set(contents, documentUrl(entryUrl)) }
  function allowsNavigation(contents, url) {
    const entry = entries.get(contents)
    return Boolean(entry && documentUrl(url) === entry)
  }
  function isTrusted(event) {
    return Boolean(event?.sender && !event.sender.isDestroyed()
      && event.senderFrame && event.senderFrame === event.sender.mainFrame
      && allowsNavigation(event.sender, event.senderFrame.url))
  }
  return { register, allowsNavigation, isTrusted }
}
module.exports = { createRendererGuard }
