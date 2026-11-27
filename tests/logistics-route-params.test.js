'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')

const svcPath = require.resolve('../backend/src/modules/logistics/logistics.service')
const freightPath = require.resolve('../backend/src/modules/logistics/logistics.freight')
const shipmentPath = require.resolve('../backend/src/modules/logistics/logistics.shipment')
const failIfCalled = (name) => () => { throw new Error(`${name} should not be called for invalid id`) }

require.cache[svcPath] = {
  id: svcPath, filename: svcPath, loaded: true,
  exports: {
    getWaybillById: failIfCalled('getWaybillById'),
    getTrackEvents: failIfCalled('getTrackEvents'),
    manualSetTracking: failIfCalled('manualSetTracking'),
    retryFetch: failIfCalled('retryFetch'),
    voidWaybill: failIfCalled('voidWaybill'),
  },
}
require.cache[freightPath] = { id: freightPath, filename: freightPath, loaded: true, exports: {} }
require.cache[shipmentPath] = {
  id: shipmentPath, filename: shipmentPath, loaded: true,
  exports: { updateShipment: failIfCalled('updateShipment') },
}

const logisticsController = require('../backend/src/modules/logistics/logistics.controller')

test('运单 :id 参数非法时在进入数据库前抛出 400 INVALID_ID，避免 NaN 触发 500', async () => {
  const invalidIds = ['shipments', 'abc', '0', '-1', '1.5', '1e2', '9007199254740992', '']
  const handlers = [
    ['detail', logisticsController.detail],
    ['track', logisticsController.track],
    ['updateShipment', logisticsController.updateShipment],
    ['setTracking', logisticsController.setTracking],
    ['retry', logisticsController.retry],
    ['voidOne', logisticsController.voidOne],
  ]

  for (const [name, fn] of handlers) {
    for (const badId of invalidIds) {
      let caught = null
      const req = { params: { id: badId }, body: {}, user: { userId: 1, warehouseIds: null } }
      const res = { status() { throw new Error('unexpected response write') } }
      await fn(req, res, (err) => { caught = err })
      assert.ok(caught, `${name}(${JSON.stringify(badId)}) should forward error`)
      assert.equal(caught.statusCode, 400, `${name}(${JSON.stringify(badId)}) statusCode`)
      assert.equal(caught.code, 'INVALID_ID', `${name}(${JSON.stringify(badId)}) code`)
    }
  }
})
