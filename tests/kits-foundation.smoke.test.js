'use strict'
const { issueFixtureAccessToken, cleanupFixtureSessionFamilies } = require('./helpers/fixtureAuthSession')

// This suite owns unique rows only. No prepareSmokeContext, table-wide DELETE, or stock writes.
const assert = require('node:assert/strict')
require('./helpers/testEnvironment').validateTestEnvironment()
const { pool } = require('../backend/src/config/db')
const app = require('../backend/src/app')
const { PERMISSIONS: P } = require('../backend/src/constants/permissions')
const { randomUUID } = require('node:crypto')
const suffix = randomUUID().slice(0, 8)
let server
const own = { users: [], roles: [], warehouses: [], products: [], customers: [], kits: [] }
let passed = 0
const q = async (sql, params = []) => (await pool.query(sql, params))[0]
const insert = async (table, sql, params) => { const r = await q(sql, params); own[table].push(Number(r.insertId)); return Number(r.insertId) }
function sign(userId) { return issueFixtureAccessToken(pool, userId, { expiresIn: '10m' }) }
async function main() {
  try {
    // Re-run the new migration's actual SQL, then inspect ordered metadata (not only names).
    const migration = require('node:fs').readFileSync(require('node:path').resolve(__dirname, '../backend/src/database/269_kit_definitions.sql'), 'utf8')
    for (const statement of require('../backend/src/database/sqlStatements').splitSqlStatements(migration)) await q(statement)
    const indexes = await q("SELECT TABLE_NAME,INDEX_NAME,GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX SEPARATOR ',') cols FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('kit_definitions','kit_definition_versions','kit_definition_components') GROUP BY TABLE_NAME,INDEX_NAME")
    assert.equal(indexes.find(i => i.INDEX_NAME === 'uk_kit_code_active')?.cols, 'code,active_unique_guard')
    assert.equal(indexes.find(i => i.INDEX_NAME === 'uk_kit_component_product')?.cols, 'version_id,product_id')
    const fks = await q("SELECT CONSTRAINT_NAME,GROUP_CONCAT(CONCAT(COLUMN_NAME,':',REFERENCED_TABLE_NAME,':',REFERENCED_COLUMN_NAME) ORDER BY ORDINAL_POSITION SEPARATOR ',') cols FROM information_schema.KEY_COLUMN_USAGE WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME IN ('kit_definitions','kit_definition_versions','kit_definition_components') AND REFERENCED_TABLE_NAME IS NOT NULL GROUP BY CONSTRAINT_NAME")
    assert.equal(fks.length, 5)
    assert.equal(fks.find(f => f.CONSTRAINT_NAME === 'fk_kit_current_version')?.cols, 'id:kit_definition_versions:kit_id,current_version_id:kit_definition_versions:id')
    console.log('[PASS] 269 SQL重跑幂等、information_schema索引/FK名字与列序一致')
    passed++
    const role = await insert('roles', 'INSERT INTO sys_roles (code,name,is_system) VALUES (?,?,0)', [`KIT-${suffix}`, `kit-${suffix}`])
    await q('INSERT INTO sys_role_permissions (role_id,permission) VALUES ?', [[P.PRODUCT_VIEW, P.PRODUCT_CREATE, P.PRODUCT_UPDATE, P.PRODUCT_DELETE, P.SALE_ORDER_CREATE].map(p => [role, p])])
    const user = await insert('users', 'INSERT INTO sys_users (username,password,real_name,role_id,role_name,is_active) VALUES (?,\'!\',?,?,?,1)', [`kit_${suffix}`, '套件测试', role, '套件测试'])
    const token = await sign(user)
    const warehouse = await insert('warehouses', 'INSERT INTO inventory_warehouses (code,name) VALUES (?,?)', [`KIT-${suffix}`, `套件仓-${suffix}`])
    const otherWarehouse = await insert('warehouses', 'INSERT INTO inventory_warehouses (code,name) VALUES (?,?)', [`KIT-O-${suffix}`, `套件外仓-${suffix}`])
    await q('INSERT INTO user_warehouse_scope (user_id,warehouse_id) VALUES (?,?)', [user, warehouse])
    const customer = await insert('customers', 'INSERT INTO sale_customers (code,name) VALUES (?,?)', [`KIT-${suffix}`, `套件客户-${suffix}`])
    const hinge = await insert('products', 'INSERT INTO product_items (code,name,sale_price_a,allow_decimal_qty) VALUES (?,?,80,0)', [`KIT-H-${suffix}`, `铰链-${suffix}`])
    const screw = await insert('products', 'INSERT INTO product_items (code,name,sale_price_a,allow_decimal_qty) VALUES (?,?,5,0)', [`KIT-S-${suffix}`, `螺钉-${suffix}`])
    const zero = await insert('products', 'INSERT INTO product_items (code,name,sale_price_a,allow_decimal_qty) VALUES (?,?,0,1)', [`KIT-Z-${suffix}`, `零价-${suffix}`])
    server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)) })
    async function request(method, path, json, key = randomUUID()) {
      const res = await fetch(`http://127.0.0.1:${server.address().port}/api/kits${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(key === null ? {} : { 'X-Request-Key': key }) }, ...(json === undefined ? {} : { body: JSON.stringify(json) }), signal: AbortSignal.timeout(20000) })
      const data = await res.json()
      // Register creation immediately, even if a subsequent assertion fails.
      if (method === 'POST' && path === '' && res.status === 201 && data.data?.id && !own.kits.includes(data.data.id)) own.kits.push(data.data.id)
      return { status: res.status, ...data }
    }
    function expect(res, status, code) { assert.equal(res.status, status, JSON.stringify(res)); if (code) assert.equal(res.code, code); return res.data }
    const check = async (name, fn) => { await fn(); passed++; console.log(`[PASS] ${name}`) }
    // Collect both real responses before asserting, so red evidence covers list and finder.
    const [overflowList, overflowFinder] = await Promise.all([
      request('GET', '?page=1e308&pageSize=100'),
      request('GET', `/finder?warehouseId=${warehouse}&page=1e308&pageSize=100`),
    ])
    await check('列表拒绝超大page，400而非offset溢出500', async () => expect(overflowList, 400))
    await check('finder拒绝超大page，400而非offset溢出500', async () => expect(overflowFinder, 400))
    const body = { code: `KIT-A-${suffix}`, name: 'A套', referenceUnitPrice: 100, components: [{ productId: hinge, baseQty: 1 }, { productId: screw, baseQty: 4 }] }
    let a, b
    const stable = randomUUID()
    await check('真实HTTP创建 + A价80:20快照 + 原键重放只有一个主档/版本', async () => {
      a = expect(await request('POST', '', body, stable), 201)
      assert.equal(a.revision, 1)
      assert.deepEqual(a.version.components.map(c => [c.referencePrice, Number(c.amountWeight), c.weightSource]), [[80, 80, 'product_a'], [5, 20, 'product_a']])
      const again = expect(await request('POST', '', body, stable), 201)
      assert.deepEqual(again, a)
      const [[count]] = await pool.query('SELECT COUNT(*) n FROM kit_definition_versions WHERE kit_id=?', [a.id])
      assert.equal(Number(count.n), 1)
    })
    await check('同requestKey不同创建载荷不误回A套回执', async () => {
      b = expect(await request('POST', '', { ...body, code: `KIT-B-${suffix}`, name: 'B套', referenceUnitPrice: 200 }, stable), 201)
      assert.notEqual(b.id, a.id)
    })
    await check('缺稳定key拒绝；活跃code唯一', async () => {
      expect(await request('POST', '', body, null), 400, 'REQUEST_KEY_REQUIRED')
      expect(await request('POST', '', body), 409, 'KIT_CODE_EXISTS')
    })
    await check('重复组件、整数策略、原始超精度、零权重与过界拒绝且零新版本', async () => {
      for (const [components, code] of [
        [[{ productId: hinge, baseQty: 1 }, { productId: hinge, baseQty: 2 }], 'KIT_COMPONENT_DUPLICATE'],
        [[{ productId: hinge, baseQty: 1.5 }], 'QTY_INTEGER_REQUIRED'],
        [[{ productId: hinge, baseQty: 1.001 }], 'QTY_DECIMALS_EXCEEDED'],
        [[{ productId: zero, baseQty: 1 }], 'KIT_WEIGHTS_ZERO'],
        [[{ productId: zero, baseQty: 1, amountWeight: 0 }], 'KIT_WEIGHTS_ZERO'],
        [[{ productId: zero, baseQty: 1, amountWeight: -1 }], 'KIT_PRICE_INVALID'],
        [Array.from({ length: 51 }, () => ({ productId: hinge, baseQty: 1 })), 'KIT_COMPONENT_LIMIT'],
      ]) expect(await request('POST', '', { ...body, code: randomUUID(), components }), 400, code)
      const explicit = expect(await request('POST', '', { ...body, code: `KIT-Z-${suffix}`, components: [{ productId: zero, baseQty: 1, amountWeight: 1 }] }), 201)
      assert.equal(explicit.version.components[0].weightSource, 'explicit')
    })
    await check('微权重/大权重DB往返精确；修改商品A价不改已发布版本参考', async () => {
      await q('UPDATE product_items SET sale_price_a=0.0001 WHERE id=?', [zero])
      const tiny = expect(await request('POST', '', { ...body, code: `KIT-M-${suffix}`, components: [{ productId: zero, baseQty: 0.01 }] }), 201)
      assert.equal(tiny.version.components[0].amountWeight, '0.000001')
      await q('UPDATE product_items SET sale_price_a=99999999.9999 WHERE id=?', [zero])
      const large = expect(await request('POST', '', { ...body, code: `KIT-L-${suffix}`, components: [{ productId: zero, baseQty: 999999.99 }] }), 201)
      assert.equal(large.version.components[0].amountWeight, '99999998999900.000001')
      const reread = expect(await request('GET', `/${tiny.id}`), 200)
      assert.equal(reread.version.components[0].amountWeight, '0.000001')
      assert.equal(reread.version.components[0].referencePrice, 0.0001)
      assert.equal(reread.version.referenceSnapshotAt, null)
      assert.ok(reread.version.createdAt)
      assert.ok(reread.version.referenceBasisExplanation.includes('沿用'))
      const [[row]] = await pool.query('SELECT amount_weight FROM kit_definition_components WHERE version_id=?', [large.currentVersionId])
      assert.equal(row.amount_weight, '99999998999900.000001')
      await q('UPDATE product_items SET sale_price_a=0 WHERE id=?', [zero])
      await assert.rejects(q('UPDATE kit_definitions SET current_version_id=? WHERE id=?', [b.currentVersionId, a.id]), e => e.code === 'ER_NO_REFERENCED_ROW_2')
    })
    const groups = () => [{ kind: 'kit', lineKey: 'A', kitVersionId: a.currentVersionId, quantity: 1, priceSource: 'kit_default' }, { kind: 'kit', lineKey: 'B', kitVersionId: b.currentVersionId, quantity: 1, priceSource: 'kit_default' }, { kind: 'ordinary', lineKey: 'O', productId: hinge, quantity: 1, unitPrice: 30, priceSource: 'manual' }]
    const preview = (items = groups(), wh = warehouse) => request('POST', '/preview', { customerId: customer, warehouseId: wh, groups: items })
    let baseline
    const snapshot = async () => {
      const result = {}
      for (const sql of [
        'SELECT id,product_id,warehouse_id,quantity,reserved FROM inventory_stock WHERE product_id IN (?) ORDER BY id',
        'SELECT id,remaining_qty,status,locked_by_task_id FROM inventory_containers WHERE product_id IN (?) ORDER BY id',
        'SELECT * FROM stock_reservations WHERE product_id IN (?) ORDER BY id',
        'SELECT id,total_amount,status FROM sale_orders WHERE customer_id=? ORDER BY id',
        'SELECT type,COUNT(*) n,COALESCE(SUM(total_amount),0) total,COALESCE(SUM(paid_amount),0) paid FROM payment_records GROUP BY type ORDER BY type',
        'SELECT * FROM inventory_logs WHERE product_id IN (?) ORDER BY id',
      ]) result[sql] = await q(sql, sql.includes('product_id IN') ? [own.products] : sql.includes('customer_id=?') ? [customer] : [])
      return result
    }
    await check('共享预览330守恒；商业独立、物理聚合、缺件按整个向量；库存与销售应收未写', async () => {
      baseline = await snapshot()
      const p = expect(await preview(), 200)
      assert.equal(p.amount, 330)
      assert.deepEqual(p.commercialGroups.map(g => g.components.map(c => c.amount)), [[80, 20], [160, 40], [30]])
      assert.deepEqual(p.physicalItems.map(i => [i.productId, i.quantity, i.amount]), [[hinge, 3, 270], [screw, 8, 60]])
      assert.equal(p.inventoryBasis, 'current_physical_available')
      assert.equal(p.canFulfillEntireVector, false)
      assert.equal(p.readyDate, null)
      assert.deepEqual(await snapshot(), baseline)
    })
    await check('普通行default权威等级价不采信客户端传价', async () => {
      const p = expect(await preview([{ kind: 'ordinary', lineKey: 'P', productId: hinge, quantity: 1, unitPrice: 0.01, priceSource: 'default' }]), 200)
      assert.equal(p.amount, 80)
      await q('UPDATE product_items SET sale_price_b=60 WHERE id=?', [hinge])
      await q("UPDATE sale_customers SET price_level='B' WHERE id=?", [customer])
      const ordinaryTierB = expect(await preview([{ kind: 'ordinary', lineKey: 'P', productId: hinge, quantity: 1, unitPrice: 0.01, priceSource: 'default' }]), 200)
      assert.equal(ordinaryTierB.amount, 60)
      const kitStillDefault = expect(await preview([{ ...groups()[0], unitPrice: 0.01 }]), 200)
      assert.equal(kitStillDefault.amount, 100, '套价不受客户等级价改变或客户端误传价影响')
      await q("UPDATE sale_customers SET price_level='A' WHERE id=?", [customer])
    })
    await check('API套手工价父金额按price4×qty2定点half-up并守分摊', async () => {
      for (const [unitPrice, quantity, amount] of [[1.005, 1, 1.01], [0.0049, 2, 0.01], [0.0067, 3, 0.02]]) {
        const p = expect(await preview([{ ...groups()[0], unitPrice, quantity, priceSource: 'manual' }]), 200)
        assert.equal(p.amount, amount)
        assert.equal(p.commercialGroups[0].unitPrice, unitPrice)
        assert.equal(p.commercialGroups[0].components.reduce((sum, c) => sum + Math.round(c.amount * 100), 0), Math.round(amount * 100))
      }
    })
    await check('API新预览拒绝不可持久化金额，边界值可解释且总额同样有界', async () => {
      const large = { ...groups()[0], quantity: 1000, unitPrice: 10000000, priceSource: 'manual' }
      expect(await preview([large]), 400, 'KIT_AMOUNT_OVERFLOW')
      const max = expect(await preview([{ ...large, quantity: 100, unitPrice: 99999999.9999 }]), 200)
      assert.equal(max.amount, 9999999999.99)
      expect(await preview([{ ...large, unitPrice: 6000000, lineKey: 'A' }, { ...large, unitPrice: 6000000, lineKey: 'B' }]), 400, 'KIT_AMOUNT_OVERFLOW')
    })
    await check('finder与preview范围校验；客户/仓库/组件禁用拒绝', async () => {
      expect(await request('GET', `/finder?warehouseId=${otherWarehouse}`), 403, 'WAREHOUSE_SCOPE_DENIED')
      expect(await preview(groups(), otherWarehouse), 403, 'WAREHOUSE_SCOPE_DENIED')
      await q('UPDATE sale_customers SET is_active=0 WHERE id=?', [customer])
      expect(await preview(), 400, 'KIT_CUSTOMER_UNAVAILABLE')
      await q('UPDATE sale_customers SET is_active=1 WHERE id=?', [customer])
      await q('UPDATE product_items SET is_active=0 WHERE id=?', [screw])
      const finder = expect(await request('GET', `/finder?warehouseId=${warehouse}&keyword=${suffix}`), 200)
      const disabled = finder.list.find(k => k.id === a.id)
      assert.equal(disabled.selectable, false)
      assert.ok(disabled.disabledReasons.some(r => r.code === 'KIT_COMPONENT_UNAVAILABLE'))
      expect(await preview(), 400, 'KIT_COMPONENT_UNAVAILABLE')
      await q('UPDATE product_items SET is_active=1,deleted_at=NOW() WHERE id=?', [screw])
      expect(await preview(), 400, 'KIT_COMPONENT_UNAVAILABLE')
      assert.equal(expect(await request('GET', `/${a.id}`), 200).version.components[1].productActive, false)
      await q('UPDATE product_items SET deleted_at=NULL WHERE id=?', [screw])
      await q('UPDATE inventory_warehouses SET is_active=0 WHERE id=?', [warehouse])
      expect(await preview(), 400, 'KIT_WAREHOUSE_UNAVAILABLE')
      await q('UPDATE inventory_warehouses SET is_active=1 WHERE id=?', [warehouse])
    })
    await check('preview要求sale.create与product.view；CRUD复用现权限', async () => {
      for (const permission of [P.PRODUCT_VIEW, P.SALE_ORDER_CREATE]) {
        await q('DELETE FROM sys_role_permissions WHERE role_id=? AND permission=?', [role, permission])
        expect(await preview(), 403, 'PERMISSION_DENIED')
        if (permission === P.PRODUCT_VIEW) for (const path of ['', `/${a.id}`, `/finder?warehouseId=${warehouse}`]) expect(await request('GET', path), 403, 'PERMISSION_DENIED')
        await q('INSERT INTO sys_role_permissions (role_id,permission) VALUES (?,?)', [role, permission])
      }
      for (const [permission, method, path, payload] of [[P.PRODUCT_CREATE, 'POST', '', body], [P.PRODUCT_UPDATE, 'PUT', `/${a.id}`, { revision: a.revision, name: '无权' }], [P.PRODUCT_DELETE, 'DELETE', `/${a.id}`, { revision: a.revision }]]) {
        await q('DELETE FROM sys_role_permissions WHERE role_id=? AND permission=?', [role, permission])
        expect(await request(method, path, payload), 403, 'PERMISSION_DENIED')
        await q('INSERT INTO sys_role_permissions (role_id,permission) VALUES (?,?)', [role, permission])
      }
    })
    await check('回执写入故障会回滚新版本/主档；原key重试只生效一次', async () => {
      const key = randomUUID(), payload = { revision: a.revision, referenceUnitPrice: 101 }
      const before = await q('SELECT * FROM kit_definition_versions WHERE kit_id=? ORDER BY id', [a.id])
      await q('UPDATE product_items SET sale_price_a=120 WHERE id=?', [hinge])
      const originalAcquire = pool.getConnection.bind(pool)
      let injected = false
      pool.getConnection = async function () {
        const conn = await originalAcquire(), originalQuery = conn.query, originalRelease = conn.release
        conn.query = async function (sql, values) {
          if (!injected && String(sql).includes('UPDATE operation_requests') && values?.[4] === a.id) { injected = true; throw new Error('KIT_TEST_RECEIPT_WRITE_FAILURE') }
          return originalQuery.call(this, sql, values)
        }
        conn.release = function () { conn.query = originalQuery; conn.release = originalRelease; return originalRelease.call(this) }
        return conn
      }
      try { expect(await request('PUT', `/${a.id}`, payload, key), 500) } finally { pool.getConnection = originalAcquire }
      assert.equal(injected, true)
      assert.deepEqual(await q('SELECT * FROM kit_definition_versions WHERE kit_id=? ORDER BY id', [a.id]), before)
      assert.equal(expect(await request('GET', `/${a.id}`), 200).revision, a.revision)
      assert.equal((await q('SELECT id FROM operation_requests WHERE request_key=? AND user_id=?', [key, user])).length, 0)
      const retried = expect(await request('PUT', `/${a.id}`, payload, key), 200)
      assert.deepEqual(expect(await request('PUT', `/${a.id}`, payload, key), 200), retried)
      assert.equal((await q('SELECT id FROM kit_definition_versions WHERE kit_id=?', [a.id])).length, before.length + 1)
      assert.equal(retried.version.components[0].referencePrice, 80, '未提交组成时仅修改套报价须沿用原依据')
      assert.equal(retried.version.referenceSnapshotAt, null)
      assert.ok(retried.version.referenceBasisExplanation.includes('沿用'))
      await q('UPDATE product_items SET sale_price_a=80 WHERE id=?', [hinge])
      a = retried
    })
    const oldVersion = a.currentVersionId
    await check('修改新版本、stale revision409、旧版本原快照可读，原键重放不增版本', async () => {
      const key = randomUUID(), payload = { revision: a.revision, referenceUnitPrice: 120, components: body.components }
      const updated = expect(await request('PUT', `/${a.id}`, payload, key), 200)
      assert.notEqual(updated.currentVersionId, oldVersion)
      assert.equal(updated.revision, a.revision + 1)
      assert.deepEqual(expect(await request('PUT', `/${a.id}`, payload, key), 200), updated)
      expect(await request('PUT', `/${a.id}`, payload), 409, 'KIT_REVISION_CONFLICT')
      const history = expect(await request('GET', `/${a.id}?versionId=${oldVersion}`), 200)
      assert.equal(history.version.referenceUnitPrice, 101)
      assert.equal(history.version.components[0].baseQty, 1)
      const staleGroups = groups()
      expect(await preview(staleGroups), 409, 'KIT_VERSION_CHANGED')
      a = updated
    })
    await check('改组成新版本，旧版本数量/分摊依据不被原地改写', async () => {
      const old = a.currentVersionId
      a = expect(await request('PUT', `/${a.id}`, { revision: a.revision, components: [{ productId: hinge, baseQty: 2 }, { productId: screw, baseQty: 4 }] }), 200)
      assert.notEqual(a.currentVersionId, old)
      assert.equal(a.version.components[0].baseQty, 2)
      assert.equal(a.version.components[0].amountWeight, '160.000000')
      const previous = expect(await request('GET', `/${a.id}?versionId=${old}`), 200)
      assert.equal(previous.version.components[0].baseQty, 1)
      assert.equal(previous.version.components[0].amountWeight, '80.000000')
    })
    await check('并发同revision编辑只能一成一冲突', async () => {
      const payload = { revision: a.revision, referenceUnitPrice: 130 }
      const responses = await Promise.all([request('PUT', `/${a.id}`, payload), request('PUT', `/${a.id}`, { ...payload, referenceUnitPrice: 140 })])
      assert.deepEqual(responses.map(r => r.status).sort(), [200, 409])
      a = responses.find(r => r.status === 200).data
    })
    await check('停用/软删递增revision、不增版本；历史仍可读且只能新选启用套', async () => {
      const version = a.currentVersionId
      a = expect(await request('PUT', `/${a.id}`, { revision: a.revision, isActive: false }), 200)
      assert.equal(a.currentVersionId, version)
      expect(await preview(), 400, 'KIT_UNAVAILABLE')
      assert.equal(expect(await request('GET', `/${a.id}?versionId=${oldVersion}`), 200).version.referenceUnitPrice, 101)
      const delKey = randomUUID(), payload = { revision: a.revision }
      const deleted = expect(await request('DELETE', `/${a.id}`, payload, delKey), 200)
      assert.deepEqual(expect(await request('DELETE', `/${a.id}`, payload, delKey), 200), deleted)
      expect(await request('DELETE', `/${a.id}`, payload), 409, 'KIT_REVISION_CONFLICT')
      assert.equal(expect(await request('GET', `/${a.id}?versionId=${oldVersion}`), 200).version.referenceUnitPrice, 101)
      expect(await request('POST', '', body), 201)
    })
    await check('只读预览和主档维护全过程未写库存/预占/销售/应收', async () => assert.deepEqual(await snapshot(), baseline))
  } finally {
    try {
    // FK-safe exact-ID cleanup. These rows were created only by this run; retain all other rows.
    if (own.kits.length) {
      await q('UPDATE kit_definitions SET current_version_id=NULL WHERE id IN (?)', [own.kits])
      await q('DELETE c FROM kit_definition_components c JOIN kit_definition_versions v ON v.id=c.version_id WHERE v.kit_id IN (?)', [own.kits])
      await q('DELETE FROM kit_definition_versions WHERE kit_id IN (?)', [own.kits])
      await q('DELETE FROM kit_definitions WHERE id IN (?)', [own.kits])
    }
    if (own.users.length) {
      await q('DELETE FROM operation_requests WHERE user_id IN (?)', [own.users])
      await q('DELETE FROM user_warehouse_scope WHERE user_id IN (?)', [own.users])
      await q('DELETE FROM sys_users WHERE id IN (?)', [own.users])
    }
    if (own.roles.length) { await q('DELETE FROM sys_role_permissions WHERE role_id IN (?)', [own.roles]); await q('DELETE FROM sys_roles WHERE id IN (?)', [own.roles]) }
    if (own.products.length) await q('DELETE FROM product_items WHERE id IN (?)', [own.products])
    if (own.customers.length) await q('DELETE FROM sale_customers WHERE id IN (?)', [own.customers])
    if (own.warehouses.length) await q('DELETE FROM inventory_warehouses WHERE id IN (?)', [own.warehouses])
    } finally {
      try { if (server) await new Promise((resolve, reject) => server.close(e => e ? reject(e) : resolve())) } finally { try { await cleanupFixtureSessionFamilies(pool) } finally { await pool.end() } }
    }
  }
  console.log(`${passed} passed; owned fixtures cleaned; server/pool closed`)
}
main().catch(e => { console.error(e); process.exitCode = 1 })
