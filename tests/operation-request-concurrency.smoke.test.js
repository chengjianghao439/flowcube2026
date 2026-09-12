'use strict'

const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { configureTestEnvironment, validateTestEnvironment } = require('./helpers/testEnvironment')
configureTestEnvironment()
const operations = require('../backend/src/utils/operationRequest')

// 只控制真实 SQL 完成后的调度，不替换任何数据库结果。超时防止测试自身挂起。
function createBarrier(parties) {
  let arrived = 0, release, timer
  const ready = new Promise((resolve, reject) => {
    release = resolve
    timer = setTimeout(() => reject(new Error('并发测试未到达同步屏障')), 5000)
  })
  return {
    async wait() {
      arrived++
      if (arrived === parties) { clearTimeout(timer); release() }
      await ready
    },
    get arrived() { return arrived },
    close() { clearTimeout(timer) },
  }
}

async function runOperationRequestConcurrencyChecks(pool) {
  validateTestEnvironment()
  const keys = []
  const failures = []
  let passed = 0
  const key = () => { const value = `OP-CONC-${randomUUID()}`; keys.push(value); return value }
  const context = requestKey => ({ requestKey, action: 'test.operation.101', userId: 910001 })
  const transaction = async (work, isolation = 'REPEATABLE READ') => {
    const conn = await pool.getConnection()
    try {
      await conn.query(`SET TRANSACTION ISOLATION LEVEL ${isolation}`)
      await conn.beginTransaction()
      const result = await work(conn)
      await conn.commit()
      return result
    } catch (e) { await conn.rollback(); throw e } finally { conn.release() }
  }
  // RC 避免重复INSERT回滚遗留的主键gap锁阻挡第二INSERT，专门锁定唯一键S→X升级问题。
  const duplicateTransaction = work => transaction(work, 'READ COMMITTED')
  const seed = async (request, status = operations.STATUS.SUCCESS) => transaction(async conn => {
    const state = await operations.beginOperationRequest(conn, request)
    if (status === operations.STATUS.SUCCESS) await operations.completeOperationRequest(conn, state, {
      data: { id: 101, confirmed: true }, message: '原始回执', resourceType: 'test_resource', resourceId: 101,
    })
    if (status === operations.STATUS.FAILED) await operations.failOperationRequest({ ...request, conn, errorMessage: '原始失败' })
    return state
  })
  const test = async (name, fn) => {
    try { await fn(); passed++; console.log(`PASS ${name}`) } catch (e) {
      failures.push({ name, error: e })
      console.error(`FAIL ${name}: ${e.message}`)
    }
  }
  try {
    await test('两个已成功请求并发重放：重复INSERT共享锁不升级死锁', async () => {
      const request = context(key())
      const seeded = await seed(request)
      const barrier = createBarrier(2)
      const ready = createBarrier(2)
      try {
        const results = await Promise.allSettled([1, 2].map(() => duplicateTransaction(async conn => {
          await ready.wait()
          const scheduledConn = { async query(sql, params) {
            try { return await conn.query(sql, params) } catch (e) {
              // 两事务各自的重复INSERT都已在InnoDB持有S锁后，才继续helper查回执。
              if (e.code === 'ER_DUP_ENTRY' && /^\s*INSERT INTO operation_requests/.test(sql)) await barrier.wait()
              throw e
            }
          } }
          return operations.beginOperationRequest(scheduledConn, request)
        })))
        assert.equal(barrier.arrived, 2)
        assert.deepEqual(results.map(r => r.status === 'rejected' ? r.reason.code || r.reason.message : 'replayed'), ['replayed', 'replayed'])
        for (const result of results) {
          assert.equal(result.value.replay, true)
          assert.equal(result.value.id, seeded.id)
          assert.equal(result.value.responseMessage, '原始回执')
          assert.deepEqual(result.value.responseData, { id: 101, confirmed: true })
        }
      } finally { barrier.close(); ready.close() }
    })
    await test('RR旧快照未见记录时仍以当前读取得后来提交的成功回执', async () => {
      const request = context(key())
      await transaction(async reader => {
        const sql = 'SELECT id FROM operation_requests WHERE request_key=?'
        assert.equal((await reader.query(sql, [request.requestKey]))[0].length, 0)
        await seed(request)
        assert.equal((await reader.query(sql, [request.requestKey]))[0].length, 0, '测试连接必须仍持有旧快照')
        const replay = await operations.beginOperationRequest(reader, request)
        assert.equal(replay.replay, true)
        assert.deepEqual(replay.responseData, { id: 101, confirmed: true })
      })
    })
    for (const [status, message] of [[operations.STATUS.PENDING, '结果仍待确认'], [operations.STATUS.FAILED, '原始失败']]) {
      await test(`已有状态${status}并发检查均返回原409且不死锁`, async () => {
        const request = context(key())
        await seed(request, status)
        const barrier = createBarrier(2)
        const ready = createBarrier(2)
        try {
          const results = await Promise.allSettled([1, 2].map(() => duplicateTransaction(async conn => {
            await ready.wait()
            const scheduledConn = { async query(sql, params) {
              try { return await conn.query(sql, params) } catch (e) {
                if (e.code === 'ER_DUP_ENTRY' && /^\s*INSERT INTO operation_requests/.test(sql)) await barrier.wait()
                throw e
              }
            } }
            return operations.beginOperationRequest(scheduledConn, request)
          })))
          assert.equal(barrier.arrived, 2)
          for (const result of results) {
            assert.equal(result.status, 'rejected')
            assert.equal(result.reason.statusCode, 409, result.reason.code || result.reason.message)
            assert.ok(result.reason.message.includes(message))
          }
          const [[stored]] = await pool.query('SELECT status FROM operation_requests WHERE request_key=?', [request.requestKey])
          assert.equal(Number(stored.status), status)
        } finally { barrier.close(); ready.close() }
      })
    }
    await test('并发首次提交只有一个执行者，另一个等待提交后重放', async () => {
      const request = context(key())
      const barrier = createBarrier(2)
      let executions = 0
      try {
        const results = await Promise.all([1, 2].map(() => transaction(async conn => {
          await barrier.wait()
          const state = await operations.beginOperationRequest(conn, request)
          if (!state.replay) {
            executions++
            await operations.completeOperationRequest(conn, state, { data: { executions: 1 } })
          }
          return state
        })))
        assert.equal(executions, 1)
        assert.equal(results.filter(r => r.replay).length, 1)
        assert.deepEqual(results.find(r => r.replay).responseData, { executions: 1 })
        assert.equal((await pool.query('SELECT id FROM operation_requests WHERE request_key=?', [request.requestKey]))[0].length, 1)
      } finally { barrier.close() }
    })
    await test('相同请求键的用户、动作和资源action隔离，回执保留资源身份', async () => {
      const requestKey = key()
      const variants = [
        { requestKey, userId: 910001, action: 'test.resource.101' },
        { requestKey, userId: 910002, action: 'test.resource.101' },
        { requestKey, userId: 910001, action: 'test.resource.102' },
        { requestKey, userId: 910001, action: 'test.other.101' },
      ]
      for (let i = 0; i < variants.length; i++) {
        await transaction(async conn => {
          const state = await operations.beginOperationRequest(conn, variants[i])
          assert.equal(state.replay, false)
          await operations.completeOperationRequest(conn, state, { data: { variant: i }, resourceType: 'test_resource', resourceId: i + 101 })
        })
      }
      for (let i = 0; i < variants.length; i++) {
        const replay = await transaction(conn => operations.beginOperationRequest(conn, variants[i]))
        assert.equal(replay.replay, true)
        assert.deepEqual(replay.responseData, { variant: i })
        const status = await operations.getOperationRequestStatus(variants[i])
        assert.equal(status.resourceType, 'test_resource')
        assert.equal(status.resourceId, i + 101)
      }
    })
    await test('回滚不保存幂等回执，成功回执不被失败通知覆盖', async () => {
      const request = context(key())
      await assert.rejects(transaction(async conn => {
        const state = await operations.beginOperationRequest(conn, request)
        await operations.completeOperationRequest(conn, state, { data: { rollback: true } })
        throw new Error('测试主动回滚')
      }), /测试主动回滚/)
      assert.equal((await operations.getOperationRequestStatus(request)).status, 'not_found')
      await seed(request)
      await operations.failOperationRequest({ ...request, errorMessage: '迟到的失败通知' })
      const result = await operations.getOperationRequestStatus(request)
      assert.equal(result.status, 'success')
      assert.deepEqual(result.data, { id: 101, confirmed: true })
    })
  } finally {
    if (keys.length) await pool.query('DELETE FROM operation_requests WHERE request_key IN (?)', [keys])
  }
  console.log(`Operation request concurrency: ${passed} passed, ${failures.length} failed`)
  if (failures.length) throw new AggregateError(failures.map(f => f.error), `${failures.length} 项操作幂等并发回归失败`)
  return { passed, failed: 0 }
}

module.exports = { runOperationRequestConcurrencyChecks }

if (require.main === module) {
  const { pool } = require('../backend/src/config/db')
  runOperationRequestConcurrencyChecks(pool)
    .catch(e => { console.error(e.message); process.exitCode = 1 })
    .finally(() => pool.end())
}
