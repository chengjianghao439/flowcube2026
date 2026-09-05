'use strict'
// Actual main/preload/update modules, with only Electron/network boundaries replaced.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const vm = require('node:vm')
const crypto = require('node:crypto')
const { createRequire } = require('node:module')
const root = path.resolve(__dirname, '..')
const quiet = { log() {}, info() {}, warn() {}, error() {}, initialize() {}, transports: { file: {}, console: {} } }
function load(rel, mocks, extra = {}) {
  const filename = path.join(root, rel)
  const requireFrom = createRequire(filename)
  const module = { exports: {} }
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    require: name => Object.hasOwn(mocks, name) ? mocks[name] : requireFrom(name),
    module, exports: module.exports, __dirname: path.dirname(filename),
    URL, AbortController, AbortSignal, console: quiet, Buffer,
    process: { env: {}, platform: process.platform, on() {} },
    setTimeout: (fn, ms) => { if (ms < 3000) queueMicrotask(fn); return 1 }, clearTimeout() {}, ...extra,
  }, { filename })
  return module.exports
}
function harness(t, { hash, content = 'installer', mutateBeforeInstall = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flowcube-update-test-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const url = 'https://updates.example.test/current/flowcube-2.0.0.exe'
  const manifest = { version: '2.0.0', notes: '更新说明', url,
    sha256: hash === undefined ? crypto.createHash('sha256').update(content).digest('hex') : hash }
  const calls = []; const boxes = []; const opened = []; const events = new Map(); const handlers = new Map(); const listeners = new Map()
  const app = { getVersion: () => '1.0.0', getPath: () => dir, requestSingleInstanceLock: () => false,
    quit() {}, exit() {}, on: (name, fn) => events.set(name, fn), isPackaged: true }
  const win = { isDestroyed: () => false, webContents: { isDestroyed: () => false,
    executeJavaScript: async () => 'https://updates.example.test',
    send: (name, payload) => { for (const fn of listeners.get(name) || []) fn({}, payload) },
  } }
  const rendererGuard = require('../desktop/lib/rendererSecurity').createRendererGuard()
  win.webContents.mainFrame = { url: 'file:///test/renderer/index.html#/' }
  win.webContents.isDestroyed = () => false
  rendererGuard.register(win.webContents, win.webContents.mainFrame.url)
  const electron = {
    app, Menu: {}, BrowserWindow: { fromWebContents: () => win, getAllWindows: () => [] },
    ipcMain: { handle: (name, fn) => handlers.set(name, fn), on() {} },
    dialog: { showMessageBox: async (_win, options) => {
      boxes.push(options)
      if (mutateBeforeInstall && options.title === '开始安装') {
        fs.writeFileSync(path.join(dir, 'flowcube-2.0.0.exe'), 'corrupted after confirmation')
      }
      return { response: 0 }
    } },
    shell: { openPath: async p => { opened.push(p); return '' } },
    net: { fetch: async (input, options) => {
      calls.push({ url: input, options })
      if (String(input).endsWith('/api/app-update/latest')) return Response.json({ success: true, data: manifest })
      if (options?.method === 'HEAD') return new Response(null, { status: 200 })
      return new Response(content, { status: 200 })
    } },
  }
  const update = load('desktop/lib/updateCheck.js', { electron })
  load('desktop/main.js', { electron, 'electron-log/main': quiet, './lib/updateCheck': update, './lib/localPrint': {}, './lib/rendererSecurity': { createRendererGuard: () => rendererGuard } })
  let bridge
  load('desktop/preload.js', { electron: {
    contextBridge: { exposeInMainWorld: (_key, value) => { bridge = value } },
    ipcRenderer: {
      invoke: async (name, ...args) => handlers.get(name)?.({ sender: win.webContents, senderFrame: win.webContents.mainFrame }, ...args), send() {},
      on: (name, fn) => listeners.set(name, [...(listeners.get(name) || []), fn]),
      removeListener: (name, fn) => listeners.set(name, (listeners.get(name) || []).filter(x => x !== fn)),
    },
  } })
  return { update, app, win, bridge, events, handlers, boxes, opened, manifest, url, calls, listeners }
}

test('certificate errors reject unrelated certificates even for the former allowlisted IP', t => {
  const h = harness(t)
  for (const host of ['47.93.228.251', 'updates.example.test']) {
    let allowed
    h.events.get('certificate-error')({ preventDefault() {} }, null, `https://${host}/api/auth/login`,
      'net::ERR_CERT_COMMON_NAME_INVALID', { fingerprint: 'unrelated' }, value => { allowed = value })
    assert.equal(allowed, false)
  }
})

test('the renderer cannot bypass manifest URL/version binding using an arbitrary URL or hash', async t => {
  const h = harness(t)
  await assert.rejects(h.bridge.startUpdateDownload({ downloadUrl: 'https://other.example.test/evil.exe', version: '2.0.0', sha256: 'a'.repeat(64) }), /清单|地址|版本/)
  await assert.rejects(h.bridge.startUpdateDownload({ downloadUrl: h.url, version: '99.0.0' }), /清单|版本/)
  assert.equal(h.opened.length, 0)
  assert.equal(h.calls.filter(c => c.options?.method === 'GET').length, 0)
})

test('dashboard/preload/main download obtains the manifest itself and installs only a matching digest', async t => {
  const h = harness(t)
  await h.bridge.startUpdateDownload({ downloadUrl: h.url, version: '2.0.0', sha256: 'ignored-renderer-value' })
  assert.equal(h.calls.filter(c => c.url.endsWith('/api/app-update/latest')).length, 1)
  assert.equal(h.opened.length, 1)
})

test('corrupt installer is removed and never opened', async t => {
  const h = harness(t, { hash: 'a'.repeat(64) })
  await h.bridge.startUpdateDownload({ downloadUrl: h.url, version: '2.0.0' })
  assert.equal(h.opened.length, 0)
  assert.ok(h.boxes.some(b => b.title === '安全校验失败'))
})

test('missing manifest digest blocks download and install', async t => {
  const h = harness(t, { hash: '' })
  await assert.rejects(h.bridge.startUpdateDownload({ downloadUrl: h.url, version: '2.0.0' }), /校验|清单/)
  assert.equal(h.opened.length, 0)
})

test('file modified while user confirms is checked again before running it', async t => {
  const h = harness(t, { mutateBeforeInstall: true })
  await h.bridge.startUpdateDownload({ downloadUrl: h.url, version: '2.0.0' })
  assert.equal(h.opened.length, 0)
  assert.ok(h.boxes.some(b => b.title === '安全校验失败'))
})

test('late preload subscriber gets pending update and cleanup removes the listener', async t => {
  const h = harness(t)
  await h.update.checkAppUpdate(h.app, h.win, () => 'https://updates.example.test', { ui: 'ipc' })
  await new Promise(resolve => setImmediate(resolve))
  const seen = []
  const unsubscribe = h.bridge.subscribeUpdateAvailable(value => seen.push(value))
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(seen.length, 1)
  assert.equal(seen[0].version, '2.0.0')
  unsubscribe()
  assert.equal(h.listeners.get('flowcube:update-available').length, 0)
  await h.update.checkAppUpdate(h.app, h.win, () => 'https://updates.example.test', { ui: 'ipc', manual: true })
  assert.equal(seen.length, 1)
})

test('ignoring a version clears the pending snapshot, and explicit manual check can show it again', async t => {
  const h = harness(t)
  await h.update.checkAppUpdate(h.app, h.win, () => 'https://updates.example.test', { ui: 'ipc' })
  await h.bridge.ignoreUpdateVersion('2.0.0')
  assert.equal(await h.handlers.get('flowcube:get-pending-update')({ sender: h.win.webContents, senderFrame: h.win.webContents.mainFrame }), null)
  await h.bridge.triggerUpdateCheck()
  assert.equal((await h.handlers.get('flowcube:get-pending-update')({ sender: h.win.webContents, senderFrame: h.win.webContents.mainFrame })).version, '2.0.0')
})

test('native fallback uses the same verified manifest download path', async t => {
  const h = harness(t)
  await h.update.checkAppUpdate(h.app, null, () => 'https://updates.example.test', { ui: 'native' })
  assert.equal(h.opened.length, 1)
  assert.equal(h.calls.filter(c => c.url.endsWith('/api/app-update/latest')).length, 2)
})
