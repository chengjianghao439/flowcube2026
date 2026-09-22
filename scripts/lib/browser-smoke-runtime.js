'use strict'
const path = require('node:path')

// 与 release-gate.sh 的预装浏览器镜像一致；不允许生产 npm exec 临时下载。
function loadPlaywright() {
  const root = process.env.PLAYWRIGHT_RUNTIME_DIR || path.join(__dirname, '../browser-smoke')
  const pkg = require(path.join(root, 'node_modules/playwright-core/package.json'))
  if (pkg.version !== '1.55.0') throw new Error('页面验收 Playwright 版本必须为 1.55.0')
  return require(path.join(root, 'node_modules/playwright-core'))
}

function createRuntime(playwright) {
  let browser, context
  let pages = []
  const active = () => {
    if (!pages.length) throw new Error('页面验收尚未打开页面')
    return pages[pages.length - 1]
  }
  return {
    async run([command, value]) {
      if (command === 'open') {
        if (!browser) browser = await (playwright || loadPlaywright()).chromium.launch({
          headless: true, chromiumSandbox: false,
          ...(process.env.PLAYWRIGHT_BROWSER_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_BROWSER_EXECUTABLE_PATH } : {}),
        })
        if (context) await context.close()
        pages = []
        context = await browser.newContext()
        pages.push(await context.newPage())
        await active().goto(value, { waitUntil: 'domcontentloaded', timeout: 30000 })
        return ''
      }
      if (command === 'tab-new') {
        pages.push(await context.newPage())
        await active().goto(value, { waitUntil: 'domcontentloaded', timeout: 30000 })
        return ''
      }
      if (command === 'tab-close') {
        if (pages.length < 2) throw new Error('不能关闭唯一的 ERP 标签页')
        await pages.pop().close()
        return ''
      }
      if (command === 'eval') {
        try { return JSON.stringify(await active().evaluate(value)) ?? '' }
        catch { throw new Error('页面表达式执行失败（导航中或页面已关闭）') }
      }
      throw new Error(`不支持的页面验收命令：${command}`)
    },
    async waitFor(expression, { timeout = 20000 } = {}) {
      try {
        const handle = await active().waitForFunction(expression, undefined, { timeout, polling: 100 })
        await handle.dispose()
      } catch { throw new Error('等待页面状态超时或页面已关闭') }
    },
    async reload() { await active().reload({ waitUntil: 'domcontentloaded', timeout: 30000 }) },
    async close() {
      const owned = browser
      browser = context = undefined
      pages = []
      if (owned) await owned.close()
    },
  }
}

module.exports = { createRuntime }
