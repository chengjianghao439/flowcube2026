'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const filename = path.join(__dirname, '../backend/scripts/resync-inventory-stock.js')
const script = new vm.Script(fs.readFileSync(filename, 'utf8'), { filename })

for (const failure of ['none', 'sync', 'rollback']) {
  test(`库存校准逐维度使用同一事务连接，故障点 ${failure}`, async () => {
    const events = []
    const proc = { exitCode: 0, exit(code) { this.exitCode = code } }
    const pairs = [{ product_id: 1, warehouse_id: 7 }, { product_id: 2, warehouse_id: 7 }]
    const pool = {
      async query(sql) { assert.match(sql, /UNION/); return [pairs] },
      async getConnection() {
        const conn = {
          beginTransaction: async () => events.push('begin'),
          query: async () => [[{ quantity: 5 }]],
          commit: async () => events.push('commit'),
          rollback: async () => { events.push('rollback'); if (failure === 'rollback') throw Error('rollback') },
          release: () => events.push('release'),
          destroy: () => events.push('destroy'),
        }
        return conn
      },
      end: async () => events.push('end'),
    }
    let locked
    const engine = {
      async lockStockDimension(conn, product, warehouse) {
        assert.equal(warehouse, 7)
        locked = conn
        events.push(`lock:${product}`)
      },
      async syncStockFromContainers(conn, product) {
        assert.equal(conn, locked)
        events.push(`sync:${product}`)
        if (failure !== 'none') throw Error('sync')
        return 5
      },
    }
    await script.runInNewContext({
      console: { log() {}, error() {} }, process: proc,
      require(name) {
        if (name === 'dotenv') return { config() {} }
        if (name === '../src/config/db') return { pool }
        if (name === '../src/engine/containerEngine') return engine
        throw Error(name)
      },
    })
    const first = ['begin', 'lock:1', 'sync:1']
    const tail = failure === 'none'
      ? ['commit', 'release', 'begin', 'lock:2', 'sync:2', 'commit', 'release']
      : ['rollback', failure === 'sync' ? 'release' : 'destroy']
    assert.deepEqual(events, [...first, ...tail, 'end'])
    assert.equal(proc.exitCode, failure === 'none' ? 0 : 1)
  })
}
