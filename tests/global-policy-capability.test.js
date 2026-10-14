'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const path = require('node:path')

function controller(mutate = false) {
  const module = { exports: {} }, user = { id: 86, permissions: ['inventory.adjust'] }
  let text = fs.readFileSync(path.join(__dirname, '../backend/src/modules/auth/auth.controller.js'), 'utf8')
  if (mutate || process.env.B7_GLOBAL_CAP_MUTANT === 'unrestricted') text = text.replace('req.user.warehouseIds === null', 'true')
  const requires = {
    '../../middleware/opLogger': () => { throw Error('No authentication writes in read-only capability test') },
    './auth.service': { getMe: async id => { assert.equal(id, 86); return user } },
    '../../utils/response': { successResponse: (_res, data) => data },
  }
  vm.runInNewContext(text, { module, exports: module.exports, require: name => {
    if (!Object.hasOwn(requires, name)) throw Error('Unapproved dependency ' + name)
    return requires[name]
  } })
  return { api: module.exports, user }
}

async function read(scope, body = {}, mutate = false) {
  const { api, user } = controller(mutate)
  const result = await api.getMe({ user: { userId: 86, warehouseIds: scope }, body }, {}, e => { throw e })
  assert.equal(user.hasUnrestrictedWarehouseScope, undefined, 'Never mutate or persist the identity object')
  assert.equal(result.id, 86)
  assert.deepEqual(Array.from(result.permissions), ['inventory.adjust'])
  return result.hasUnrestrictedWarehouseScope
}

test('global policy UI capability requires explicit current unrestricted server scope', async () => {
  assert.equal(await read(null), true)
  for (const scope of [[], [1], [1, 2], undefined, false, 0, 'null', {}]) {
    assert.equal(await read(scope), false)
  }
})
test('body cannot forge global policy UI capability', async () => {
  assert.equal(await read([1], { warehouseIds: null, hasUnrestrictedWarehouseScope: true }), false)
  assert.equal(await read(undefined, { warehouseIds: null }), false)
})
test('capability regression guard fails if restricted scopes are declared unrestricted', async () => {
  await assert.rejects(async () => assert.equal(await read([1], {}, true), false), assert.AssertionError)
})
