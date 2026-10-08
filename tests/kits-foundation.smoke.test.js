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
const own = { users: [], roles: [], warehouses: [], products: [], customers: [], kits: [], categories: [], suppliers: [] }
let passed = 0
const q = async (sql, params = []) => (await pool.query(sql, params))[0]
const insert = async (table, sql, params) => { const r = await q(sql, params); own[table].push(Number(r.insertId)); return Number(r.insertId) }
function sign(userId) { return issueFixtureAccessToken(pool, userId, { expiresIn: '10m' }) }
async function main() {
  try {
    // Re-run the new migration's actual SQL, then inspect ordered metadata (not only names).
    for (const file of ['269_kit_definitions.sql', '282_kit_product_profile.sql']) {
      const migration = require('node:fs').readFileSync(require('node:path').resolve(__dirname, '../backend/src/database', file), 'utf8')
      for (let repeat = 0; repeat < 2; repeat++) for (const statement of require('../backend/src/database/sqlStatements').splitSqlStatements(migration)) await q(statement)
    }
    const indexes = await q("SELECT TABLE_NAME,INDEX_NAME,GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX SEPARATOR ',') cols FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('kit_definitions','kit_definition_versions','kit_definition_components') GROUP BY TABLE_NAME,INDEX_NAME")
    assert.equal(indexes.find(i => i.INDEX_NAME === 'uk_kit_code_active')?.cols, 'code,active_unique_guard')
    assert.equal(indexes.find(i => i.INDEX_NAME === 'uk_kit_component_product')?.cols, 'version_id,product_id')
    const fks = await q("SELECT CONSTRAINT_NAME,GROUP_CONCAT(CONCAT(COLUMN_NAME,':',REFERENCED_TABLE_NAME,':',REFERENCED_COLUMN_NAME) ORDER BY ORDINAL_POSITION SEPARATOR ',') cols FROM information_schema.KEY_COLUMN_USAGE WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME IN ('kit_definitions','kit_definition_versions','kit_definition_components') AND REFERENCED_TABLE_NAME IS NOT NULL GROUP BY CONSTRAINT_NAME")
    assert.equal(fks.length, 7)
    assert.equal(fks.find(f => f.CONSTRAINT_NAME === 'fk_kit_current_version')?.cols, 'id:kit_definition_versions:kit_id,current_version_id:kit_definition_versions:id')
    assert.equal(fks.find(f => f.CONSTRAINT_NAME === 'fk_kit_category')?.cols, 'category_id:product_categories:id')
    assert.equal(fks.find(f => f.CONSTRAINT_NAME === 'fk_kit_supplier')?.cols, 'supplier_id:supply_suppliers:id')
    const fkRules = await q("SELECT k.CONSTRAINT_NAME,k.REFERENCED_TABLE_SCHEMA,k.ORDINAL_POSITION,k.POSITION_IN_UNIQUE_CONSTRAINT,r.UNIQUE_CONSTRAINT_SCHEMA,r.UNIQUE_CONSTRAINT_NAME,r.MATCH_OPTION,r.UPDATE_RULE,r.DELETE_RULE FROM information_schema.KEY_COLUMN_USAGE k JOIN information_schema.REFERENTIAL_CONSTRAINTS r ON r.CONSTRAINT_SCHEMA=k.CONSTRAINT_SCHEMA AND r.CONSTRAINT_NAME=k.CONSTRAINT_NAME AND r.TABLE_NAME=k.TABLE_NAME WHERE k.CONSTRAINT_SCHEMA=DATABASE() AND k.TABLE_NAME='kit_definitions' AND k.CONSTRAINT_NAME IN ('fk_kit_category','fk_kit_supplier')")
    assert.equal(fkRules.length, 2)
    for (const r of fkRules) { assert.equal(r.REFERENCED_TABLE_SCHEMA, process.env.DB_NAME); assert.equal(r.UNIQUE_CONSTRAINT_SCHEMA, process.env.DB_NAME); assert.equal(r.UNIQUE_CONSTRAINT_NAME, 'PRIMARY'); assert.equal(r.ORDINAL_POSITION, 1); assert.equal(r.POSITION_IN_UNIQUE_CONSTRAINT, 1); assert.equal(r.MATCH_OPTION, 'NONE'); assert.ok(['NO ACTION', 'RESTRICT'].includes(r.UPDATE_RULE)); assert.ok(['NO ACTION', 'RESTRICT'].includes(r.DELETE_RULE)) }
    const columns = await q("SELECT TABLE_NAME,COLUMN_NAME,DATA_TYPE,COLUMN_TYPE,IS_NULLABLE,COLUMN_DEFAULT,CHARACTER_MAXIMUM_LENGTH,CHARACTER_SET_NAME,COLLATION_NAME,NUMERIC_PRECISION,NUMERIC_SCALE,EXTRA,GENERATION_EXPRESSION FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('kit_definitions','kit_definition_versions')")
    for (const [table, name, type, size] of [
      ['kit_definitions', 'category_id', 'bigint'], ['kit_definitions', 'supplier_id', 'bigint'],
      ...[['unit', 20], ['spec', 200], ['color', 60], ['article_number', 100], ['remark', 30]].map(([name, size]) => ['kit_definitions', name, 'varchar', size]),
      ['kit_definitions', 'cost_price', 'decimal'], ...['b', 'c', 'd'].map(t => ['kit_definition_versions', `sale_price_${t}`, 'decimal']),
    ]) {
      const c = columns.find(c => c.TABLE_NAME === table && c.COLUMN_NAME === name)
      assert.ok(c, `${table}.${name}`); assert.equal(c.DATA_TYPE, type); assert.equal(c.IS_NULLABLE, 'YES'); assert.equal(c.COLUMN_DEFAULT, null); assert.equal(c.EXTRA, ''); assert.equal(c.GENERATION_EXPRESSION, '')
      if (type === 'varchar') { assert.equal(c.CHARACTER_MAXIMUM_LENGTH, size); assert.equal(c.CHARACTER_SET_NAME, 'utf8mb4'); assert.equal(c.COLLATION_NAME, 'utf8mb4_unicode_ci') }
      if (type === 'decimal') { assert.equal(c.COLUMN_TYPE, 'decimal(12,4)'); assert.equal(c.NUMERIC_PRECISION, 12); assert.equal(c.NUMERIC_SCALE, 4) }
      if (type === 'bigint') assert.equal(c.COLUMN_TYPE, 'bigint unsigned')
    }
    console.log('[PASS] 269/282 SQL重复执行幂等、字段完整形状与索引/FK名字/列序/引用schema/规则一致')
    passed++
    const role = await insert('roles', 'INSERT INTO sys_roles (code,name,is_system) VALUES (?,?,0)', [`KIT-${suffix}`, `kit-${suffix}`])
    await q('INSERT INTO sys_role_permissions (role_id,permission) VALUES ?', [[P.PRODUCT_VIEW, P.PRODUCT_CREATE, P.PRODUCT_UPDATE, P.PRODUCT_DELETE, P.SALE_ORDER_CREATE].map(p => [role, p])])
    const user = await insert('users', 'INSERT INTO sys_users (username,password,real_name,role_id,role_name,is_active) VALUES (?,\'!\',?,?,?,1)', [`kit_${suffix}`, '套件测试', role, '套件测试'])
    const token = await sign(user)
    const warehouse = await insert('warehouses', 'INSERT INTO inventory_warehouses (code,name) VALUES (?,?)', [`KIT-${suffix}`, `套件仓-${suffix}`])
    const otherWarehouse = await insert('warehouses', 'INSERT INTO inventory_warehouses (code,name) VALUES (?,?)', [`KIT-O-${suffix}`, `套件外仓-${suffix}`])
    await q('INSERT INTO user_warehouse_scope (user_id,warehouse_id) VALUES (?,?)', [user, warehouse])
    const customer = await insert('customers', 'INSERT INTO sale_customers (code,name) VALUES (?,?)', [`KIT-${suffix}`, `套件客户-${suffix}`])
    const category = await insert('categories', 'INSERT INTO product_categories (code,name,status) VALUES (?,?,1)', [`KIT-${suffix}`, `套件分类-${suffix}`])
    const supplier = await insert('suppliers', 'INSERT INTO supply_suppliers (code,name,is_active) VALUES (?,?,1)', [`KIT-${suffix}`, `套件供应商-${suffix}`])
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
      assert.match(a.code, /^K\d{6}$/)
      assert.notEqual(a.code, body.code)
      assert.equal(a.unit, '套')
      assert.equal(a.salePriceB, 100)
      assert.equal(a.version.salePriceB, null)
      assert.equal(a.revision, 1)
      assert.deepEqual(a.version.components.map(c => [c.referencePrice, Number(c.amountWeight), c.weightSource]), [[80, 80, 'product_a'], [5, 20, 'product_a']])
      const again = expect(await request('POST', '', body, stable), 201)
      assert.deepEqual(again, a)
      assert.deepEqual(expect(await request('POST', '', { ...body, code: 'IGNORED-OTHER' }, stable), 201), a)
      const [[count]] = await pool.query('SELECT COUNT(*) n FROM kit_definition_versions WHERE kit_id=?', [a.id])
      assert.equal(Number(count.n), 1)
    })
    await check('同requestKey不同创建载荷不误回A套回执', async () => {
      b = expect(await request('POST', '', { ...body, code: `KIT-B-${suffix}`, name: 'B套', referenceUnitPrice: 200 }, stable), 201)
      assert.notEqual(b.id, a.id)
    })
    await check('缺稳定key拒绝；重复旧client code仍取得新的服务端编码', async () => {
      expect(await request('POST', '', body, null), 400, 'REQUEST_KEY_REQUIRED')
      const other = expect(await request('POST', '', body), 201)
      assert.notEqual(other.code, a.code)
      assert.match(other.code, /^K\d{6}$/)
    })
    const profileBody = { name: `完整资料-${suffix}`, categoryId: category, supplierId: supplier, unit: '组', spec: `型号-${suffix}`, color: `银色-${suffix}`, articleNumber: `供应商型-${suffix}`, costPrice: 10, remark: '独立资料', components: body.components }
    let profiled
    await check('无code完整资料创建，当前系统率生成四档；名称/分类/供应商/单位/规格/颜色/备注往返', async () => {
      const auto = require('../backend/src/utils/priceLevels').computeTierPrices(10, await require('../backend/src/utils/priceLevels').loadPriceRates(pool))
      profiled = expect(await request('POST', '', profileBody), 201)
      for (const field of ['name', 'categoryId', 'supplierId', 'unit', 'spec', 'color', 'articleNumber', 'costPrice', 'remark']) assert.equal(profiled[field], profileBody[field])
      assert.equal(profiled.categoryName, `套件分类-${suffix}`); assert.equal(profiled.supplierName, `套件供应商-${suffix}`)
      for (const field of ['salePriceA', 'salePriceB', 'salePriceC', 'salePriceD']) { assert.equal(profiled[field], auto[field]); assert.equal(profiled.version[field], auto[field]) }
      assert.equal(profiled.version.referenceUnitPrice, auto.salePriceA)
      for (const keyword of [profileBody.spec, profileBody.color, profileBody.articleNumber]) {
        const list = expect(await request('GET', `?keyword=${encodeURIComponent(keyword)}`), 200)
        assert.ok(list.list.some(k => k.id === profiled.id))
        assert.equal(list.list.find(k => k.id === profiled.id).supplierName, profiled.supplierName)
      }
      assert.deepEqual(expect(await request('GET', `/${profiled.id}`), 200), profiled)
    })
    await check('资料编辑只增revision且code不可编辑；独立BCD更改新版本，未提交组成不重新采A参考', async () => {
      const previous = profiled, count = (await q('SELECT id FROM kit_definition_versions WHERE kit_id=?', [profiled.id])).length
      profiled = expect(await request('PUT', `/${profiled.id}`, { revision: profiled.revision, code: 'FORGED-EDIT', spec: '新型号', costPrice: 20, articleNumber: '', remark: '' }), 200)
      assert.equal(profiled.code, previous.code); assert.equal(profiled.currentVersionId, previous.currentVersionId); assert.equal(profiled.revision, previous.revision + 1)
      assert.equal(profiled.articleNumber, null); assert.equal(profiled.remark, null)
      assert.equal((await q('SELECT id FROM kit_definition_versions WHERE kit_id=?', [profiled.id])).length, count)
      await q('UPDATE product_items SET sale_price_a=120 WHERE id=?', [hinge])
      profiled = expect(await request('PUT', `/${profiled.id}`, { revision: profiled.revision, salePriceB: 0, salePriceC: 13.1234, salePriceD: 24 }), 200)
      assert.notEqual(profiled.currentVersionId, previous.currentVersionId)
      assert.equal(profiled.salePriceB, 0); assert.equal(profiled.salePriceC, 13.1234); assert.equal(profiled.salePriceD, 24)
      assert.equal(profiled.version.components[0].referencePrice, 80)
      const old = expect(await request('GET', `/${profiled.id}?versionId=${previous.currentVersionId}`), 200)
      assert.deepEqual(old.version, previous.version)
      const auto = require('../backend/src/utils/priceLevels').computeTierPrices(20, await require('../backend/src/utils/priceLevels').loadPriceRates(pool))
      profiled = expect(await request('PUT', `/${profiled.id}`, { revision: profiled.revision, salePriceB: null }), 200)
      assert.equal(profiled.salePriceB, auto.salePriceB); assert.equal(profiled.salePriceC, 13.1234)
      await q('UPDATE product_items SET sale_price_a=80 WHERE id=?', [hinge])
    })
    await check('旧历史编码原样保留，编辑不能改编码，旧BCD空值回退A', async () => {
      const legacy = await insert('kits', 'INSERT INTO kit_definitions (code,name) VALUES (?,?)', [`HISTORIC-${suffix}`, '历史套'])
      const version = await q('INSERT INTO kit_definition_versions (kit_id,version_no,reference_unit_price,created_by) VALUES (?,1,9,?)', [legacy, user])
      await q('INSERT INTO kit_definition_components (version_id,product_id,base_qty,reference_price,amount_weight,weight_source,sort_no) VALUES (?,?,1,80,80,\'product_a\',0)', [version.insertId, hinge])
      await q('UPDATE kit_definitions SET current_version_id=? WHERE id=?', [version.insertId, legacy])
      const edited = expect(await request('PUT', `/${legacy}`, { revision: 1, code: 'FORGED-HISTORIC', name: '历史套更新' }), 200)
      assert.equal(edited.code, `HISTORIC-${suffix}`); assert.equal(edited.salePriceA, 9); assert.equal(edited.salePriceB, 9); assert.equal(edited.version.salePriceB, null)
      assert.equal(edited.currentVersionId, version.insertId)
      const legacyPayload = { code: `HISTORIC-${suffix}`, name: '历史套', referenceUnitPrice: 9, components: [{ productId: hinge, baseQty: 1 }] }, key = randomUUID()
      const originalReceipt = { id: legacy, code: legacyPayload.code, name: legacyPayload.name, revision: 1, currentVersionId: Number(version.insertId) }
      await q('INSERT INTO operation_requests (request_key,action,user_id,status,response_json,resource_type,resource_id) VALUES (?,?,?,1,?,\'kit\',?)', [key, `kit.create.${require('../backend/src/utils/operationRequest').creationFingerprint(legacyPayload)}`, user, JSON.stringify(originalReceipt), legacy])
      assert.deepEqual(expect(await request('POST', '', legacyPayload, key), 201), originalReceipt)
      assert.equal((await q('SELECT id FROM kit_definitions WHERE code=?', [legacyPayload.code])).length, 1)
      assert.equal((await q('SELECT id FROM operation_requests WHERE user_id=? AND request_key=?', [user, key])).length, 1)
    })
    await check('强制同MAX的四个创建请求使用新事务取号，编码唯一且无失败回执残留', async () => {
      const originalAcquire = pool.getConnection.bind(pool), keys = Array.from({ length: 4 }, () => randomUUID())
      let readers = 0, releaseReaders
      const barrier = new Promise(resolve => { releaseReaders = resolve })
      pool.getConnection = async function () {
        const conn = await originalAcquire(), originalQuery = conn.query, originalRelease = conn.release
        conn.query = async function (sql, values) {
          const result = await originalQuery.call(this, sql, values)
          if (String(sql).includes('maxNum') && String(sql).includes('kit_definitions') && readers < 4) { readers++; if (readers === 4) releaseReaders(); await barrier }
          return result
        }
        conn.release = function () { conn.query = originalQuery; conn.release = originalRelease; return originalRelease.call(this) }
        return conn
      }
      let responses
      try { responses = await Promise.all(keys.map((key, i) => request('POST', '', { name: `并发-${suffix}-${i}`, referenceUnitPrice: 10, components: body.components }, key))) } finally { releaseReaders(); pool.getConnection = originalAcquire }
      assert.equal(readers, 4)
      const created = responses.map(r => expect(r, 201))
      assert.equal(new Set(created.map(k => k.code)).size, 4)
      assert.equal(new Set(created.map(k => k.id)).size, 4)
      for (let i = 0; i < created.length; i++) {
        assert.match(created[i].code, /^K\d{6}$/)
        assert.deepEqual(expect(await request('POST', '', { name: `并发-${suffix}-${i}`, referenceUnitPrice: 10, components: body.components }, keys[i]), 201), created[i])
        assert.equal((await q('SELECT id FROM operation_requests WHERE user_id=? AND request_key=? AND status=1', [user, keys[i]])).length, 1)
        assert.equal((await q('SELECT id FROM kit_definition_versions WHERE kit_id=?', [created[i].id])).length, 1)
      }
    })
    await check('带code且无旧回执：不同key与同key并发都返回成功，只落应有主档/版本/回执', async () => {
      const fingerprint = require('../backend/src/utils/operationRequest').creationFingerprint
      const runBatch = async (label, entries) => {
        const keys = [...new Set(entries.map(e => e.key))], targets = new Set(entries.map(e => `${e.key}:${fingerprint(e.payload)}`))
        assert.equal((await q('SELECT id FROM operation_requests WHERE user_id=? AND request_key IN (?)', [user, keys])).length, 0, '本批旧fingerprint和新fingerprint回执均不存在')
        const originalAcquire = pool.getConnection.bind(pool)
        let readers = 0, releaseReaders
        const barrier = new Promise(resolve => { releaseReaders = resolve })
        pool.getConnection = async function () {
          const conn = await originalAcquire(), originalQuery = conn.query, originalRelease = conn.release
          conn.query = async function (sql, values) {
            const result = await originalQuery.call(this, sql, values)
            if (String(sql).includes('FROM operation_requests') && targets.has(`${values?.[0]}:${String(values?.[1]).replace(/^kit\.create\./, '')}`) && readers < 2) {
              assert.equal(result[0].length, 0, '两请求的旧fingerprint查询必须同时读到不存在')
              readers++; if (readers === 2) releaseReaders(); await barrier
            }
            return result
          }
          conn.release = function () { conn.query = originalQuery; conn.release = originalRelease; return originalRelease.call(this) }
          return conn
        }
        let settled
        try { settled = await Promise.allSettled(entries.map(e => request('POST', '', e.payload, e.key))) } finally { releaseReaders(); pool.getConnection = originalAcquire }
        const responses = settled.map(r => r.status === 'fulfilled' ? r.value : { status: 'transport_error', message: r.reason.message })
        const receipts = await q('SELECT id,request_key,action,status,resource_type,resource_id FROM operation_requests WHERE user_id=? AND request_key IN (?) ORDER BY id', [user, keys])
        // Collect both batches before assertions: a different-key failure must not hide same-key evidence.
        console.log(`[EVIDENCE] ${label} ${JSON.stringify({ readers, responses: responses.map(r => ({ status: r.status, code: r.code, message: r.message, id: r.data?.id })), receipts })}`)
        return { readers, responses, receipts }
      }
      const keyPrefix = randomUUID(), payload = { code: `OLD-CLIENT-${suffix}`, name: `旧客户端并发-${suffix}`, referenceUnitPrice: 10, components: body.components }
      const differentEntries = [1, 2].map(i => ({ key: `${keyPrefix}-${i}`, payload: { ...payload, name: `${payload.name}-${i}` } }))
      const sameKey = randomUUID(), sameEntries = [1, 2].map(() => ({ key: sameKey, payload: { ...payload, name: `${payload.name}-同键` } }))
      const different = await runBatch('code-bearing distinct keys', differentEntries)
      const same = await runBatch('code-bearing same key and body', sameEntries)
      const issues = []
      for (const [label, batch, expectedRows] of [['different', different, 2], ['same', same, 1]]) {
        if (batch.readers !== 2) issues.push(`${label}: legacy readers=${batch.readers}`)
        if (batch.responses.some(r => r.status !== 201)) issues.push(`${label}: HTTP statuses=${batch.responses.map(r => r.status).join(',')}`)
        if (batch.receipts.length !== expectedRows || batch.receipts.some(r => Number(r.status) !== 1 || r.resource_type !== 'kit')) issues.push(`${label}: expected ${expectedRows} successful kit receipts`)
      }
      assert.deepEqual(issues, [], '两批实际响应及回执已完整收集；任一500/错误回执均为并发红灯')
      const distinctKits = different.responses.map(r => r.data), sameKit = same.responses[0].data
      assert.equal(new Set(distinctKits.map(k => k.id)).size, 2); assert.equal(new Set(distinctKits.map(k => k.code)).size, 2)
      assert.deepEqual(same.responses[1].data, sameKit)
      for (let i = 0; i < differentEntries.length; i++) {
        assert.equal(different.receipts.find(r => r.request_key === differentEntries[i].key)?.resource_id, distinctKits[i].id)
        assert.equal((await q('SELECT id FROM kit_definitions WHERE name=?', [differentEntries[i].payload.name])).length, 1)
      }
      assert.equal(same.receipts[0].resource_id, sameKit.id)
      assert.equal((await q('SELECT id FROM kit_definitions WHERE name=?', [sameEntries[0].payload.name])).length, 1)
      for (const kit of [...distinctKits, sameKit]) { assert.match(kit.code, /^K\d{6}$/); assert.equal((await q('SELECT id FROM kit_definition_versions WHERE kit_id=?', [kit.id])).length, 1) }
    })
    await check('引用停用/删除、价格别名不一致/五位/过界拒绝并回滚创建回执', async () => {
      const rejected = async (delta, code) => {
        const key = randomUUID()
        expect(await request('POST', '', { ...profileBody, ...delta }, key), 400, code)
        assert.equal((await q('SELECT id FROM operation_requests WHERE user_id=? AND request_key=?', [user, key])).length, 0)
      }
      await q('UPDATE product_categories SET status=0 WHERE id=?', [category]); await rejected({}, 'KIT_CATEGORY_UNAVAILABLE')
      await q('UPDATE product_categories SET status=1,deleted_at=NOW() WHERE id=?', [category]); await rejected({}, 'KIT_CATEGORY_UNAVAILABLE')
      await q('UPDATE product_categories SET deleted_at=NULL WHERE id=?', [category])
      await q('UPDATE supply_suppliers SET is_active=0 WHERE id=?', [supplier]); await rejected({}, 'KIT_SUPPLIER_UNAVAILABLE')
      await q('UPDATE supply_suppliers SET is_active=1,deleted_at=NOW() WHERE id=?', [supplier]); await rejected({}, 'KIT_SUPPLIER_UNAVAILABLE')
      await q('UPDATE supply_suppliers SET deleted_at=NULL WHERE id=?', [supplier])
      await rejected({ referenceUnitPrice: 7, salePriceA: 8 }, 'KIT_PRICE_ALIAS_CONFLICT')
      await rejected({ salePriceC: 1.00001 }, 'KIT_PRICE_INVALID')
      await rejected({ costPrice: 100000000 }, 'KIT_PRICE_INVALID')
    })
    await check('创建回执写入失败整事务回滚；原键重试只有一份新主档/版本', async () => {
      const key = randomUUID(), payload = { ...profileBody, name: `回滚-${suffix}` }, originalAcquire = pool.getConnection.bind(pool)
      let injected = false
      pool.getConnection = async function () {
        const conn = await originalAcquire(), originalQuery = conn.query, originalRelease = conn.release
        conn.query = async function (sql, values) {
          if (!injected && String(sql).includes('UPDATE operation_requests') && values?.[3] === 'kit') { injected = true; throw new Error('KIT_TEST_CREATE_RECEIPT_WRITE_FAILURE') }
          return originalQuery.call(this, sql, values)
        }
        conn.release = function () { conn.query = originalQuery; conn.release = originalRelease; return originalRelease.call(this) }
        return conn
      }
      try { expect(await request('POST', '', payload, key), 500) } finally { pool.getConnection = originalAcquire }
      assert.equal(injected, true)
      assert.equal((await q('SELECT id FROM kit_definitions WHERE name=?', [payload.name])).length, 0)
      assert.equal((await q('SELECT id FROM operation_requests WHERE user_id=? AND request_key=?', [user, key])).length, 0)
      const created = expect(await request('POST', '', payload, key), 201)
      assert.deepEqual(expect(await request('POST', '', payload, key), 201), created)
      assert.equal((await q('SELECT id FROM kit_definitions WHERE name=?', [payload.name])).length, 1)
      assert.equal((await q('SELECT id FROM kit_definition_versions WHERE kit_id=?', [created.id])).length, 1)
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
      assert.equal(kitStillDefault.amount, 100, '历史套版本B为NULL，等级B回退旧A；不采信客户端误传价')
      await q("UPDATE sale_customers SET price_level='A' WHERE id=?", [customer])
    })
    await check('已配置套B按客户等级权威预览，手工价保留，explicit0不会回退A', async () => {
      const group = () => ({ kind: 'kit', lineKey: 'profile', kitVersionId: profiled.currentVersionId, quantity: 1, priceSource: 'kit_default', unitPrice: 0.01 })
      await q("UPDATE sale_customers SET price_level='B' WHERE id=?", [customer])
      const byTier = expect(await preview([group()]), 200)
      assert.equal(byTier.commercialGroups[0].unitPrice, profiled.salePriceB)
      assert.equal(byTier.amount, Math.round(profiled.salePriceB * 100) / 100)
      assert.equal(expect(await preview([{ ...group(), priceSource: 'manual', unitPrice: 30 }]), 200).amount, 30)
      profiled = expect(await request('PUT', `/${profiled.id}`, { revision: profiled.revision, salePriceB: 0 }), 200)
      const zeroPrice = expect(await preview([group()]), 200)
      assert.equal(zeroPrice.commercialGroups[0].unitPrice, 0); assert.equal(zeroPrice.amount, 0)
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
      const finder = expect(await request('GET', `/finder?warehouseId=${warehouse}&keyword=${encodeURIComponent(a.code)}`), 200)
      const disabled = finder.list.find(k => k.id === a.id)
      assert.ok(disabled, '按服务端生成的真实编码查询必须返回本轮A套')
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
    if (own.categories.length) await q('DELETE FROM product_categories WHERE id IN (?)', [own.categories])
    if (own.suppliers.length) await q('DELETE FROM supply_suppliers WHERE id IN (?)', [own.suppliers])
    if (own.customers.length) await q('DELETE FROM sale_customers WHERE id IN (?)', [own.customers])
    if (own.warehouses.length) await q('DELETE FROM inventory_warehouses WHERE id IN (?)', [own.warehouses])
    } finally {
      try { if (server) await new Promise((resolve, reject) => server.close(e => e ? reject(e) : resolve())) } finally { try { await cleanupFixtureSessionFamilies(pool) } finally { await pool.end() } }
    }
  }
  console.log(`${passed} passed; owned fixtures cleaned; server/pool closed`)
}
main().catch(e => { console.error(e); process.exitCode = 1 })
