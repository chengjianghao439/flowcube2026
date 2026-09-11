const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const { createRequire } = require('node:module')
const path = require('node:path')
const backendRequire = createRequire(path.resolve(__dirname, '../backend/package.json'))
const express = backendRequire('express')
const handlerPath = path.resolve(__dirname, '../backend/src/middleware/errorHandler.js')
const handlerModule = { exports: {} }
const handlerRequire = createRequire(handlerPath)
vm.runInNewContext(fs.readFileSync(handlerPath, 'utf8'), {
  module: handlerModule, process,
  require: name => {
    if (name === '../utils/logger') return { warn() {}, error() {} }
    if (name === '../config/env') return { env: { NODE_ENV: 'test' } }
    if (name === '../utils/errorTracking') return { initializeErrorTracking() {}, captureUnexpectedError() {} }
    return handlerRequire(name)
  },
}, { filename: handlerPath })

for (const [moduleName, endpoint, mime] of [
  ['import', '/products', 'text/csv'],
  ['import', '/stock', 'text/csv'],
  ['import', '/customers', 'text/csv'],
  ['import', '/price-list-items', 'text/csv'],
  ['import', '/suppliers', 'text/csv'],
  ['settings', '/logo', 'image/png'],
]) {
  test(`${moduleName}${endpoint}: accepts a file and rejects unexpected multipart fields`, async () => {
    const filename = path.resolve(__dirname, `../backend/src/modules/${moduleName}/${moduleName}.routes.js`)
    const routeRequire = createRequire(filename)
    const module = { exports: {} }
    vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
      module, require: (name) => {
        if (name.endsWith('/auth')) return { authMiddleware: (_req, _res, next) => next(), requirePermission: () => (_req, _res, next) => next() }
        if (name.endsWith('.controller')) return new Proxy({}, { get: () => (req, res) => res.json({ size: req.file?.size }) })
        return routeRequire(name)
      },
    }, { filename })
    const app = express()
    app.use(module.exports)
    app.use(handlerModule.exports)
    const server = app.listen(0, '127.0.0.1')
    await new Promise(resolve => server.once('listening', resolve))
    try {
      const url = `http://127.0.0.1:${server.address().port}${endpoint}`
      const valid = new FormData()
      valid.append('file', new Blob(['sample'], { type: mime }), 'sample')
      const accepted = await fetch(url, { method: 'POST', body: valid })
      assert.equal(accepted.status, 200)
      assert.equal((await accepted.json()).size, 6)
      const unexpected = new FormData()
      unexpected.append('a[10]', 'unused')
      unexpected.append('file', new Blob(['sample'], { type: mime }), 'sample')
      const rejected = await fetch(url, { method: 'POST', body: unexpected })
      assert.equal(rejected.status, 400)
      assert.equal((await rejected.json()).code, 'LIMIT_FIELD_COUNT')
      const duplicate = new FormData()
      duplicate.append('file', new Blob(['first'], { type: mime }), 'first')
      duplicate.append('file', new Blob(['second'], { type: mime }), 'second')
      const tooMany = await fetch(url, { method: 'POST', body: duplicate })
      assert.equal(tooMany.status, 400)
      assert.equal((await tooMany.json()).code, 'LIMIT_FILE_COUNT')
    } finally {
      await new Promise(resolve => server.close(resolve))
    }
  })
}
