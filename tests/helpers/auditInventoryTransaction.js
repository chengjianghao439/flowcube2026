/** Audit-only adapter: service transactions remain inside the rollback-owned fixture. */
const assert = require('node:assert/strict')

function createAuditInventoryTransaction(conn) {
  let fixtureIsolation = null, serviceActive = false
  const serviceConn = {
    query: (sql, ...args) => {
      if (sql === 'SET TRANSACTION ISOLATION LEVEL READ COMMITTED') {
        // MySQL cannot change the active outer transaction. Select its isolation before BEGIN.
        assert.equal(fixtureIsolation, 'READ COMMITTED', 'RC service requires an explicitly RC outer fixture')
        assert.equal(serviceActive, false, 'service isolation must precede its savepoint')
        return Promise.resolve([{}])
      }
      return conn.query(sql, ...args)
    },
    async beginTransaction() {
      assert.equal(serviceActive, false, 'unexpected nested service transaction')
      await conn.query('SAVEPOINT service_transaction'); serviceActive = true
    },
    async commit() {
      assert.equal(serviceActive, true, 'service commit requires its own savepoint')
      await conn.query('RELEASE SAVEPOINT service_transaction'); serviceActive = false
    },
    async rollback() {
      if (!serviceActive) return // A pre-BEGIN error must not roll back the outer fixture or mask itself.
      await conn.query('ROLLBACK TO SAVEPOINT service_transaction')
      await conn.query('RELEASE SAVEPOINT service_transaction'); serviceActive = false
    },
    release() {},
  }
  async function beginFixture(isolation = 'REPEATABLE READ') {
    assert.equal(serviceActive, false)
    assert.ok(['REPEATABLE READ', 'READ COMMITTED'].includes(isolation))
    await conn.query(isolation === 'READ COMMITTED'
      ? 'SET TRANSACTION ISOLATION LEVEL READ COMMITTED'
      : 'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ')
    await conn.beginTransaction(); fixtureIsolation = isolation
  }
  return { serviceConn, beginFixture }
}

module.exports = { createAuditInventoryTransaction }
