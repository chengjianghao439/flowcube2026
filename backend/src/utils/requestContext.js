const { AsyncLocalStorage } = require('async_hooks')

const storage = new AsyncLocalStorage()

function runWithRequestContext(context, fn) {
  return storage.run({ ...(context || {}) }, fn)
}

function getRequestContext() {
  return storage.getStore() || null
}

function getRequestId() {
  return getRequestContext()?.requestId || null
}

function updateRequestContext(patch = {}) {
  const store = storage.getStore()
  if (!store) return null
  Object.assign(store, patch)
  return store
}

module.exports = {
  runWithRequestContext,
  getRequestContext,
  getRequestId,
  updateRequestContext,
}
