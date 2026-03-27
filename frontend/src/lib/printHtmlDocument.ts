/** 写入打印文档 <title> 等处的最小转义 */
export function escapeHtmlText(text: string): string {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * 在当前文档内用隐藏 iframe 打印完整 HTML，避免 window.open 弹窗（拦截、多窗口、桌面端「像浏览器」）。
 * 浏览器与 Electron 渲染进程均可使用。
 */
export function printHtmlDocument(fullHtml: string): void {
  if (typeof document === 'undefined') return

  const iframe = document.createElement('iframe')
  iframe.setAttribute('aria-hidden', 'true')
  iframe.setAttribute('tabindex', '-1')
  Object.assign(iframe.style, {
    position: 'fixed',
    right: '0',
    bottom: '0',
    width: '0',
    height: '0',
    border: '0',
    opacity: '0',
    pointerEvents: 'none',
  })

  let cleaned = false
  let fallbackTimer: ReturnType<typeof setTimeout> | undefined
  const cleanup = () => {
    if (cleaned) return
    cleaned = true
    if (fallbackTimer !== undefined) window.clearTimeout(fallbackTimer)
    try {
      iframe.remove()
    } catch {
      /* ignore */
    }
  }

  document.body.appendChild(iframe)

  const doc = iframe.contentDocument
  const win = iframe.contentWindow
  if (!doc || !win) {
    cleanup()
    return
  }

  doc.open()
  doc.write(fullHtml)
  doc.close()

  win.addEventListener('afterprint', cleanup, { once: true })
  fallbackTimer = window.setTimeout(cleanup, 120_000)

  const runPrint = () => {
    try {
      win.focus()
      win.print()
    } catch {
      cleanup()
    }
  }

  // 等一帧再 print，减少空白页 / 未排版的概率
  requestAnimationFrame(() => {
    requestAnimationFrame(runPrint)
  })
}
