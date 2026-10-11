'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { pathToFileURL } = require('node:url')
const { spawn } = require('node:child_process')
const root = path.resolve(__dirname, '../..')

// Optional local acceptance: a real Chromium session and source Vite UI use this
// batch's authenticated synthetic API. No browser state or credential is exported.
async function runGui(c, { adjustmentId, handoffSaleId, barcode } = {}) {
  const directory = process.env.FLOWCUBE_RETENTION_EVIDENCE_DIR
  assert.ok(directory, 'GUI evidence must have an explicit task directory')
  fs.mkdirSync(directory, { recursive: true })
  process.env.DEV_API_TARGET = 'http://127.0.0.1:' + c.server.address().port
  process.env.VITE_ELECTRON = '1'
  const vite = await import(pathToFileURL(path.join(root, 'frontend/node_modules/vite/dist/node/index.js')).href)
  const server = await vite.createServer({ root: path.join(root, 'frontend'), configFile: path.join(root, 'frontend/vite.config.ts'), server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' })
  const session = 'flowcube-change-records-' + process.pid
  // Keep the API event loop available while Chromium loads and queries it.
  const command = (args, input) => new Promise((resolve, reject) => {
    const child = spawn('agent-browser', ['--session', session, ...args], { stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = '', stderr = ''
    const timer = setTimeout(() => child.kill('SIGTERM'), 45000)
    child.stdout.on('data', data => { stdout += data })
    child.stderr.on('data', data => { stderr += data })
    child.on('error', error => { clearTimeout(timer); reject(error) })
    child.on('close', code => { clearTimeout(timer); code === 0 ? resolve(stdout) : reject(new Error(`GUI command failed (${code}): ${input ? 'evaluation failed' : args.join(' ') + ': ' + stderr.trim()}`)) })
    child.stdin.end(input)
  })
  const cli = (...args) => command(['--allowed-domains', '127.0.0.1', ...args])
  const evaluate = async script => JSON.parse(await command(['eval', '--stdin', '--json'], script)).data.result
  const snapshot = async name => fs.writeFileSync(path.join(directory, name + '.txt'), await cli('snapshot', '-i'))
  const capture = name => cli('screenshot', path.join(directory, name + '.png'))
  try {
    await server.listen()
    const address = server.httpServer.address()
    const origin = 'http://127.0.0.1:' + address.port
    const user = await c.ok('GET', '/auth/me')
    await cli('open', origin + '/#/login')
    await evaluate('localStorage.setItem("flowcube-auth-v3", ' + JSON.stringify(JSON.stringify({ state: { token: c.token, refreshToken: null, user, isAuthenticated: true }, version: 0 })) + '); true')
    // A hash-only goto reuses the mounted store; reload rehydrates the synthetic session.
    await cli('reload')
    await cli('open', origin + '/#/sale/' + c.guiSaleId)
    await cli('wait', '--text', '订单信息')
    await snapshot('sale-detail-before-records')
    await cli('find', 'role', 'button', 'click', '--name', '操作记录', '--exact')
    await cli('wait', '--text', '合成核对差额')
    await snapshot('sale-records-collapsed')
    assert.equal(await evaluate('[...document.querySelectorAll("details[open]")].filter(node => node.getClientRects().length > 0).length'), 0, 'change details default collapsed')
    await cli('find', 'text', '查看 3 行变更', 'click', '--exact')
    await cli('wait', '--text', '20.0001')
    for (const width of [1366, 1024, 390]) {
      await cli('set', 'viewport', String(width), '900')
      await capture('sale-records-' + width)
    }
    await snapshot('sale-records-expanded')
    await cli('set', 'viewport', '1366', '900')
    await cli('open', origin + '/#/sale?keyword=' + encodeURIComponent(c.guiSaleNo))
    await cli('wait', '--fn', '[...document.querySelectorAll("tr")].some(node => node.getClientRects().length > 0 && node.innerText.includes(' + JSON.stringify(c.guiSaleNo) + '))')
    await snapshot('sale-list-ready')
    const menuIndex = await evaluate('(() => { const row = [...document.querySelectorAll("tr")].find(node => node.getClientRects().length > 0 && node.innerText.includes(' + JSON.stringify(c.guiSaleNo) + ')); const button = row?.querySelector("button[aria-label=\\"更多操作\\"]"); return [...document.querySelectorAll("button[aria-label=\\"更多操作\\"]")].indexOf(button) })()')
    assert.ok(menuIndex >= 0, '真实销售行必须有原更多操作控件')
    await cli('find', 'nth', String(menuIndex), 'button[aria-label="更多操作"]', 'click')
    await cli('find', 'role', 'menuitem', 'click', '--name', '取消订单', '--exact')
    await cli('wait', '--text', '取消原因（选填）')
    await snapshot('sale-cancel-menu-dialog')
    await capture('sale-cancel-menu-dialog')
    await cli('find', 'role', 'button', 'click', '--name', '返回订单', '--exact')
    await cli('wait', '--fn', '!document.querySelector("[role=dialog]")')
    assert.equal(await evaluate('document.body.style.pointerEvents === "none"'), false, 'natural close releases its pointer lock')
    await cli('find', 'role', 'button', 'click', '--name', '查询', '--exact')
    await cli('wait', '--fn', 'document.querySelectorAll("[role=dialog]").length === 1')
    await snapshot('sale-after-cancel-natural-click')
    await cli('press', 'Escape')
    await cli('wait', '--fn', '!document.querySelector("[role=dialog]")')
    if (handoffSaleId) {
      await cli('set', 'viewport', '1366', '900')
      await cli('open', origin + '/#/sale/' + handoffSaleId)
      await cli('wait', '--fn', '[...document.querySelectorAll("h1")].some(node => node.getClientRects().length > 0 && node.textContent.includes(' + JSON.stringify(c.guiHandoffSaleNo) + '))')
      await cli('find', 'role', 'button', 'click', '--name', '操作记录', '--exact')
      await cli('wait', '--text', '仓库交接（1）')
      assert.equal(await evaluate('document.querySelectorAll("details[data-activity-log-section][open]").length'), 0)
      await snapshot('sale-handoff-collapsed')
      await cli('find', 'text', '仓库交接（1）', 'click', '--exact')
      await cli('wait', '--text', '合成仓库交接')
      await cli('find', 'text', '仓库确认记录（2）', 'click', '--exact')
      if (c.guiAdjustmentNo) await cli('wait', '--text', c.guiAdjustmentNo)
      await capture('sale-handoff-expanded')
      await snapshot('sale-handoff-expanded')
    }
    if (barcode) {
      await cli('open', origin + '/#/settings/barcode-print-query?category=inbound&keyword=' + encodeURIComponent(barcode))
      await cli('wait', '--fn', '[...document.querySelectorAll("tr")].some(node => node.getClientRects().length > 0 && node.innerText.includes(' + JSON.stringify(barcode) + '))')
      await snapshot('print-records-collapsed')
      assert.equal(await evaluate('[...document.querySelectorAll("details[open]")].filter(node => node.getClientRects().length > 0).length'), 0, 'print request details default collapsed')
      await cli('find', 'text', '打印记录', 'click', '--exact')
      await cli('wait', '--text', '请求份数')
      for (const width of [1366, 1024, 390]) {
        await cli('set', 'viewport', String(width), '900')
        await capture('print-records-' + width)
      }
      await snapshot('print-records-expanded')
    }
    // PDA detail is read in its own tab. It does not consume a print job or
    // submit a scanner action; physical confirmations remain real API checks.
    if (adjustmentId) {
      await cli('tab', 'new', origin + '/#/pda/login')
      await cli('wait', '--fn', 'document.readyState === "complete"')
      const code = c.mark + '-gui', secret = crypto.randomBytes(24).toString('hex')
      const bcrypt = c.req('backend/node_modules/bcryptjs')
      await c.insert("INSERT INTO pda_devices(device_code,device_name,warehouse_id,status,secret_hash) VALUES (?,?,?,'active',?)", [code, code, c.a.id, await bcrypt.hash(secret, 10)])
      const ticket = await c.req('backend/src/modules/pda/pda.sessions.service').createSession({ deviceCode: code, deviceSecret: secret, userId: c.userId })
      const sessionBody = { token: ticket.sessionToken, warehouseId: c.a.id, warehouseName: c.a.name, expiresAt: ticket.expiresAt || null, scopes: ticket.scopes || [] }
      await evaluate('(async () => { const binding = await import("/src/lib/pdaDeviceBinding.ts"); await binding.saveDeviceCredential(' + JSON.stringify(code) + ',' + JSON.stringify(secret) + '); await binding.saveDeviceSession(' + JSON.stringify(sessionBody) + '); window.location.hash = "/pda/adjustments/' + adjustmentId + '"; return true })()')
      await cli('wait', '--text', '合成仓库交接')
      await cli('set', 'viewport', '390', '844')
      await capture('pda-adjustment-handoff')
      await snapshot('pda-adjustment-handoff')
    }
    return { session, origin, saleId: c.guiSaleId, adjustmentId: adjustmentId || null, widths: [1366, 1024, 390] }
  } catch (error) {
    try { await snapshot('gui-failure'); await capture('gui-failure') } catch { /* Original failure is retained if the browser also closed. */ }
    throw error
  } finally {
    try { await cli('close') } finally { await server.close() }
  }
}
module.exports = { runGui }
