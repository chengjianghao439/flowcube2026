'use strict'

/** Express 4 ignores returned Promises; observe their lifetime without swallowing
 * rejection or treating a disconnected socket as completed business work. */
function createHttpDrain() {
  const active = new Set(), waiters = new Set(), wrapped = new WeakSet()
  let scheduled = false
  function checkDrained() {
    if (!waiters.size || scheduled) return
    scheduled = true
    // Preserve the existing unhandledRejection decision before shutdown can exit 0.
    setImmediate(() => {
      scheduled = false
      if (active.size) return
      for (const resolve of waiters) resolve()
      waiters.clear()
    })
  }
  function invoke(handler, self, args) {
    const result = handler.apply(self, args)
    if (!result || typeof result.then !== 'function') return result
    const token = {}
    active.add(token)
    // The returned Promise retains the original rejection for Express 4's fatal
    // policy. Do not attach a catch here or forward next() a second time.
    return Promise.resolve(result).finally(() => { active.delete(token); checkDrained() })
  }
  function wrap(handler) {
    switch (handler.length) {
      case 0: return function () { return invoke(handler, this, arguments) }
      case 1: return function (_req) { return invoke(handler, this, arguments) }
      case 2: return function (_req, _res) { return invoke(handler, this, arguments) }
      case 3: return function (_req, _res, _next) { return invoke(handler, this, arguments) }
      case 4: return function (_err, _req, _res, _next) { return invoke(handler, this, arguments) }
      default: return handler // Express 4 skips handlers with more than four args.
    }
  }
  function visit(stack) {
    for (const layer of stack) {
      if (wrapped.has(layer)) continue
      wrapped.add(layer)
      if (layer.route) visit(layer.route.stack)
      else if (Array.isArray(layer.handle?.stack)) visit(layer.handle.stack)
      else if (typeof layer.handle === 'function') layer.handle = wrap(layer.handle)
    }
  }
  return {
    trackAppHandlers(app) {
      if (!Array.isArray(app._router?.stack)) throw new Error('HTTP 排空需要 Express 4 路由栈')
      visit(app._router.stack)
    },
    waitForHandlers() { return new Promise(resolve => { waiters.add(resolve); checkDrained() }) },
  }
}
const httpDrain = createHttpDrain()
module.exports = { createHttpDrain, httpDrain }
