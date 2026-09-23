'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')

test('self profile and warehouse scope use the authenticated user id', async () => {
  const servicePath = require.resolve('../backend/src/modules/users/users.service')
  const controllerPath = require.resolve('../backend/src/modules/users/users.controller')
  const oldService = require.cache[servicePath]
  const oldController = require.cache[controllerPath]
  const seen = []
  require.cache[servicePath] = {
    id: servicePath,
    filename: servicePath,
    loaded: true,
    exports: {
      findById: async id => { seen.push(['profile', id]); return { id } },
      getWarehouseScope: async id => { seen.push(['scope', id]); return [] },
    },
  }
  delete require.cache[controllerPath]
  try {
    const controller = require(controllerPath)
    const req = { user: { userId: 42 }, params: { id: '1' } }
    const res = { status() { return this }, json() { return this } }
    const next = error => { throw error }
    await controller.myDetail(req, res, next)
    await controller.myWarehouseScope(req, res, next)
    assert.deepEqual(seen, [['profile', 42], ['scope', 42]])
  } finally {
    if (oldService) require.cache[servicePath] = oldService
    else delete require.cache[servicePath]
    if (oldController) require.cache[controllerPath] = oldController
    else delete require.cache[controllerPath]
  }
})
