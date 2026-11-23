'use strict'
// Actual main/preload/update modules, with only Electron/network boundaries replaced.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const vm = require('node:vm')
const crypto = require('node:crypto')
const { EventEmitter } = require('node:events')
const { Readable } = require('node:stream')
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
function harness(t, { hash, content = 'installer', stream, redirect, installerError = false, platform = 'win32', packaged = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flowcube-update-test-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const url = 'https://updates.example.test/current/flowcube-2.0.0.exe'
  const manifest = { version: '2.0.0', notes: '更新说明', url,
    sha256: hash === undefined ? crypto.createHash('sha256').update(content).digest('hex') : hash }
  const calls = []; const boxes = []; const opened = []; const events = new Map(); const handlers = new Map(); const listeners = new Map()
  const messages = new Map()
  let exits = 0
  const app = { getVersion: () => '1.0.0', getPath: () => dir, requestSingleInstanceLock: () => false,
    quit() {}, exit() { exits++ }, on: (name, fn) => events.set(name, fn), isPackaged: packaged }
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
    ipcMain: { handle: (name, fn) => handlers.set(name, fn), on: (name, fn) => messages.set(name, fn) },
    dialog: { showMessageBox: async (_win, options) => {
      boxes.push(options)
      return { response: 0 }
    } },
    shell: { openPath: async p => { opened.push(p); return '' } },
    net: {
      fetch: async (input, options) => {
        calls.push({ url: input, options })
        return Response.json({ success: true, data: manifest })
      },
      request: ({ url: input, ...options }) => {
        calls.push({ url: input, options })
        const request = new EventEmitter()
        const controller = new AbortController()
        request.abort = () => { controller.abort(); request.emit('close') }
        function sendResponse() {
          const response = stream ? Readable.fromWeb(stream(controller.signal)) : Readable.from([Buffer.from(content)])
          response.headers = { 'content-length': String(content.length) }
          response.statusCode = 200
          response.on('close', () => request.emit('close'))
          request.emit('response', response)
        }
        request.followRedirect = () => { calls.push({ url: redirect, options }); sendResponse() }
        request.end = () => queueMicrotask(() => {
          if (!controller.signal.aborted) {
            if (redirect) request.emit('redirect', 302, 'GET', redirect)
            else sendResponse()
          }
        })
        return request
      },
    },
  }
  const extra = { process: { env: {}, platform, on() {} } }
  const update = load('desktop/lib/updateCheck.js', { electron, 'node:child_process': {
    execFile: (file, args, options, callback) => {
      opened.push({ file, args, options })
      callback(installerError ? new Error('UAC denied') : null)
    },
  } }, extra)
  load('desktop/main.js', { electron, 'electron-log/main': quiet, './lib/updateCheck': update, './lib/localPrint': {}, './lib/rendererSecurity': { createRendererGuard: () => rendererGuard } }, extra)
  const sender = { sender: win.webContents, senderFrame: win.webContents.mainFrame }
  let bridge
  load('desktop/preload.js', { electron: {
    contextBridge: { exposeInMainWorld: (_key, value) => { bridge = value } },
    ipcRenderer: {
      invoke: async (name, ...args) => handlers.get(name)?.(sender, ...args),
      send: (name, ...args) => messages.get(name)?.(sender, ...args),
      on: (name, fn) => listeners.set(name, [...(listeners.get(name) || []), fn]),
      removeListener: (name, fn) => listeners.set(name, (listeners.get(name) || []).filter(x => x !== fn)),
    },
  } })
  return { dir, update, app, win, bridge, events, handlers, boxes, opened, manifest, url, calls, listeners, exits: () => exits }
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

test('the main process obtains its own manifest and downloads without launching the installer', async t => {
  const h = harness(t)
  const states = []
  h.bridge.subscribeUpdateState(state => states.push(state))
  await h.bridge.triggerUpdateCheck({ downloadUrl: 'https://other.example.test/evil.exe' })
  assert.equal(h.update.getUpdateState().stage, 'ready')
  assert.ok(states.some(state => state.stage === 'downloading' && state.percent === 100))
  assert.ok(h.calls.every(c => !String(c.url).includes('other.example.test')))
  assert.equal(h.opened.length, 0)
  assert.equal(h.exits(), 0)
  assert.equal(h.boxes.length, 0)
})

test('the packaged startup checks and downloads once even if the renderer sends its origin twice', { timeout: 2000 }, async t => {
  const h = harness(t)
  const completed = new Promise(resolve => {
    h.bridge.subscribeUpdateState(state => {
      if (state.stage === 'ready' || state.stage === 'error') resolve(state)
    })
  })
  h.bridge.notifyApiOriginReady('https://updates.example.test')
  h.bridge.notifyApiOriginReady('https://updates.example.test')
  const state = await completed
  assert.equal(state.stage, 'ready')
  assert.equal(h.calls.filter(call => call.url.endsWith('/api/app-update/latest')).length, 1)
  assert.equal(h.opened.length, 0)
})

test('restart without a verified installer is rejected, while explicit restart rereads the manifest and runs NSIS', async t => {
  const h = harness(t)
  await assert.rejects(h.bridge.restartToUpdate(), /下载|校验/)
  await h.bridge.triggerUpdateCheck()
  await Promise.all([h.bridge.restartToUpdate(), h.bridge.restartToUpdate()])
  assert.equal(h.calls.filter(c => c.url.endsWith('/api/app-update/latest')).length, 2)
  assert.equal(h.opened.length, 1)
  assert.match(h.opened[0].args.join(' '), /--updated.*\/S.*--force-run/)
  assert.match(h.opened[0].options.env.FLOWCUBE_INSTALLER_PATH, /update-cache.*\.exe$/)
  assert.equal(h.exits(), 1)
})

test('installer downloads across a trusted HTTPS redirect and refuses an HTTP downgrade', async t => {
  const https = 'https://cdn.example.test/release.exe'
  const redirected = harness(t, { redirect: https })
  await redirected.bridge.triggerUpdateCheck()
  assert.equal(redirected.update.getUpdateState().stage, 'ready')
  assert.ok(redirected.calls.some(call => call.url === https))
  const insecure = harness(t, { redirect: 'http://cdn.example.test/release.exe' })
  await insecure.bridge.triggerUpdateCheck()
  assert.equal(insecure.update.getUpdateState().stage, 'error')
  assert.match(insecure.update.getUpdateState().message, /HTTPS/)
  assert.ok(insecure.calls.every(call => call.url.startsWith('https://')))
})

test('corrupt installer is removed and never opened', async t => {
  const h = harness(t, { hash: 'a'.repeat(64) })
  await h.bridge.triggerUpdateCheck()
  assert.equal(h.update.getUpdateState().stage, 'error')
  assert.match(h.update.getUpdateState().message, /校验/)
  assert.deepEqual(fs.readdirSync(path.join(h.dir, 'update-cache')), [])
  assert.equal(h.opened.length, 0)
})

test('missing manifest digest blocks download and install', async t => {
  const h = harness(t, { hash: '' })
  await h.bridge.triggerUpdateCheck()
  assert.equal(h.update.getUpdateState().stage, 'error')
  assert.equal(h.calls.filter(c => c.options?.method === 'GET').length, 0)
  assert.equal(h.opened.length, 0)
})

test('file modified or manifest superseded after download never runs', async t => {
  const h = harness(t)
  await h.bridge.triggerUpdateCheck()
  const cache = path.join(h.dir, 'update-cache')
  const [file] = fs.readdirSync(cache)
  fs.writeFileSync(path.join(cache, file), 'stage file tampered')
  await h.bridge.restartToUpdate()
  assert.equal(h.update.getUpdateState().stage, 'error')
  await h.bridge.triggerUpdateCheck()
  h.manifest.version = '2.0.1'
  await h.bridge.restartToUpdate()
  assert.equal(h.update.getUpdateState().stage, 'error')
  assert.equal(h.opened.length, 0)
  assert.equal(h.exits(), 0)
})

test('late preload subscriber gets pending update and cleanup removes the listener', async t => {
  const h = harness(t)
  await h.bridge.triggerUpdateCheck()
  const seen = []
  const unsubscribe = h.bridge.subscribeUpdateState(value => seen.push(value))
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(seen.length, 1)
  assert.equal(seen[0].version, '2.0.0')
  assert.equal(seen[0].stage, 'ready')
  unsubscribe()
  assert.equal(h.listeners.get('flowcube:update-state').length, 0)
  await h.bridge.triggerUpdateCheck()
  assert.equal(h.calls.filter(c => c.url === h.url).length, 1)
  assert.equal(seen.length, 1)
})

test('after caching a verified installer, only owned stale cache files are removed', async t => {
  const h = harness(t)
  const cache = path.join(h.dir, 'update-cache')
  fs.mkdirSync(cache)
  fs.writeFileSync(path.join(cache, `${'a'.repeat(64)}.exe`), 'stale')
  fs.writeFileSync(path.join(cache, `${'b'.repeat(64)}-${crypto.randomUUID()}.part`), 'incomplete')
  fs.writeFileSync(path.join(cache, 'note.txt'), 'keep')
  await h.bridge.triggerUpdateCheck()
  assert.equal(h.update.getUpdateState().stage, 'ready')
  assert.deepEqual(fs.readdirSync(cache).sort(), [`${h.manifest.sha256}.exe`, 'note.txt'].sort())
})

test('background cancellation removes partial data and leaves a single retry path', async t => {
  let started
  const downloading = new Promise(resolve => { started = resolve })
  let first = true
  const h = harness(t, { stream: signal => new ReadableStream({
    start(controller) {
      if (!first) { controller.enqueue(Buffer.from('installer')); controller.close(); return }
      first = false
      controller.enqueue(Buffer.from('ins'))
      signal.addEventListener('abort', () => controller.error(signal.reason), { once: true })
      started()
    },
  }) })
  const check = h.bridge.triggerUpdateCheck()
  await downloading
  await h.bridge.triggerUpdateCheck()
  await h.bridge.cancelUpdateDownload()
  await check
  assert.equal(h.update.getUpdateState().stage, 'cancelled')
  assert.deepEqual(fs.readdirSync(path.join(h.dir, 'update-cache')), [])
  await h.bridge.triggerUpdateCheck()
  assert.equal(h.update.getUpdateState().stage, 'ready')
  assert.equal(h.calls.filter(c => c.url === h.url).length, 2)
  assert.equal(h.opened.length, 0)
})

test('failed or cancelled Windows elevation keeps the application open and the package ready', async t => {
  const h = harness(t, { installerError: true })
  await h.bridge.triggerUpdateCheck()
  await h.bridge.restartToUpdate()
  assert.equal(h.update.getUpdateState().stage, 'ready')
  assert.match(h.update.getUpdateState().message, /未启动|取消/)
  assert.equal(h.exits(), 0)
})

test('same or older and unsupported installations never download an EXE', async t => {
  const h = harness(t)
  h.manifest.version = '1.0.0'
  await h.bridge.triggerUpdateCheck()
  assert.equal(h.update.getUpdateState().stage, 'current')
  assert.equal(h.calls.filter(c => c.url === h.url).length, 0)
  const mac = harness(t, { platform: 'darwin' })
  await mac.bridge.triggerUpdateCheck()
  assert.equal(mac.update.getUpdateState().stage, 'unsupported')
  assert.equal(mac.calls.length, 0)
})
