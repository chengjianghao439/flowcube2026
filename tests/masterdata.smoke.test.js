#!/usr/bin/env node
'use strict'

const assert = require('node:assert/strict')
const { randomBytes } = require('node:crypto')
const { configureTestEnvironment } = require('./helpers/testEnvironment')
configureTestEnvironment()
// 本专项只挂载主数据 HTTP 路由，不启动调度器或外部遥测。
process.env.SENTRY_DSN = ''
process.env.LOKI_URL = ''
const { pool } = require('../backend/src/config/db')
const express = require('../backend/node_modules/express')
const jwt = require('../backend/node_modules/jsonwebtoken')
const { PERMISSIONS } = require('../backend/src/constants/permissions')
const { SETTLEMENT_TYPE } = require('../backend/src/constants/settlementType')

async function main() {
  const mark = `MD${randomBytes(5).toString('hex')}`
  const owned = new Map()
  const counts = {}
  let server, actor, reader, denied, warehouse, product
  const remember = (table, id) => { if (!owned.has(table)) owned.set(table, []); if (!owned.get(table).includes(Number(id))) owned.get(table).push(Number(id)); return Number(id) }
  const insert = async (table, data) => {
    const [r] = await pool.query(`INSERT INTO ${table} (${Object.keys(data).join(',')}) VALUES (${Object.keys(data).map(() => '?').join(',')})`, Object.values(data))
    return remember(table, r.insertId)
  }
  const check = (module, label, actual, expected = true) => {
    assert.deepEqual(actual, expected, `${module}: ${label}`)
    counts[module] = (counts[module] || 0) + 1
    console.log(`PASS [${module}] ${label}`)
  }
  let request
  try {
    const [[target]] = await pool.query('SELECT DATABASE() AS db, @@session.time_zone AS timezone')
    assert.equal(target.db, process.env.DB_NAME)
    console.log('[masterdata] target', { host: process.env.DB_HOST, port: process.env.DB_PORT, ...target })
    const [used] = await pool.query('SELECT id FROM sys_roles UNION SELECT role_id AS id FROM sys_users UNION SELECT role_id AS id FROM sys_role_permissions')
    const roleIds = Array.from({ length: 254 }, (_, i) => 255 - i).filter(id => !used.some(r => Number(r.id) === id)).slice(0, 3)
    assert.equal(roleIds.length, 3)
    const prefixes = ['CUSTOMER', 'SUPPLIER', 'DEPARTMENT', 'CATEGORY']
    const users = []
    for (const [index, id] of roleIds.entries()) {
      await insert('sys_roles', { id, code: `${mark}R${index}`, name: mark, is_system: 0 })
      // 显式主键插入的 insertId 仍为角色 ID；禁用真实密码登录，只用本次短效 JWT。
      users.push(await insert('sys_users', { username: `${mark}U${index}`, password: 'fixture-no-password-login', real_name: mark, role_id: id, role_name: mark }))
      if (index < 2) for (const prefix of prefixes) for (const action of index === 0 ? ['VIEW', 'CREATE', 'UPDATE', 'DELETE'] : ['VIEW']) {
        await pool.query('INSERT INTO sys_role_permissions (role_id,permission) VALUES (?,?)', [id, PERMISSIONS[`${prefix}_${action}`]])
      }
    }
    ;[actor, reader, denied] = users
    await pool.query('INSERT INTO sys_role_permissions (role_id,permission) VALUES (?,?)', [roleIds[0], PERMISSIONS.SALE_CREDIT_VIEW])
    warehouse = await insert('inventory_warehouses', { code: mark, name: mark })
    product = await insert('product_items', { code: mark, name: mark })
    const app = express()
    app.use(express.json())
    for (const module of ['customers', 'suppliers', 'departments', 'categories']) app.use(`/api/${module}`, require(`../backend/src/modules/${module}/${module}.routes`))
    app.use(require('../backend/src/middleware/errorHandler'))
    server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)) })
    request = async (module, path = '', method = 'GET', body, userId = actor) => {
      const headers = { 'Content-Type': 'application/json' }
      if (userId) headers.Authorization = `Bearer ${jwt.sign({ userId, tokenVersion: 0 }, process.env.JWT_SECRET, { expiresIn: '5m' })}`
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api/${module}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10000) })
      const payload = await response.json()
      // 即使未来无效创建被错误接受，也先登记回执 ID，确保失败路径能清理本次行。
      if (method === 'POST' && path === '' && payload.data?.id) remember({ customers: 'sale_customers', suppliers: 'supply_suppliers', departments: 'sys_departments', categories: 'product_categories' }[module], payload.data.id)
      return { status: response.status, body: payload }
    }
    const expectStatus = async (module, label, path, method, body, status, userId = actor) => {
      const result = await request(module, path, method, body, userId)
      check(module, `${label} HTTP ${status}`, result.status, status)
      check(module, `${label} 响应信封`, result.body.success, status < 400)
      return result.body.data
    }
    const create = async (module, table, body) => {
      const result = await request(module, '', 'POST', body)
      if (result.body.data?.id) remember(table, result.body.data.id)
      check(module, '真实 HTTP 创建', result.status, 201)
      return result.body.data
    }
    // 权限必须经过数据库当前用户、角色权限中间件，不能用超管绕过。
    for (const module of ['customers', 'suppliers', 'departments', 'categories']) {
      const path = module === 'categories' ? '/flat' : ''
      await expectStatus(module, '未登录读取', path, 'GET', undefined, 401, null)
      await expectStatus(module, '无权限读取', path, 'GET', undefined, 403, denied)
      await expectStatus(module, '只读角色读取', path, 'GET', undefined, 200, reader)
      for (const [verb, suffix] of [['POST', ''], ['PUT', '/2147483647'], ['DELETE', '/2147483647']]) {
        await expectStatus(module, `只读角色拒绝 ${verb}`, suffix, verb, {}, 403, reader)
      }
    }
    for (const module of ['customers', 'suppliers']) {
      const customer = module === 'customers'
      const table = customer ? 'sale_customers' : 'supply_suppliers'
      const name = `${mark}${customer ? 'C' : 'S'}`
      const body = { code: 'client-code-ignored', name, contact: '测试', phone: '13800000000', email: 'fixture@example.invalid', address: '测试地址', remark: mark, settlementType: SETTLEMENT_TYPE.MONTHLY, paymentTermsDays: 60, ...(customer ? { creditLimit: 1000 } : { leadTimeDays: 12 }) }
      const first = await create(module, table, body)
      const second = await create(module, table, { ...body, name: `${name}B` })
      check(module, '编码由服务端生成', first.code.startsWith(customer ? 'CUS' : 'SUP') && first.code !== body.code)
      const detail = await expectStatus(module, '详情', `/${first.id}`, 'GET', undefined, 200)
      check(module, '持久化联络/结算/专属字段', [detail.name, detail.contact, detail.phone, detail.email, detail.paymentTermsDays, customer ? detail.creditLimit : detail.leadTimeDays], [name, '测试', '13800000000', 'fixture@example.invalid', 60, customer ? 1000 : 12])
      await expectStatus(module, '重复名称创建', '', 'POST', { ...body, name: ` ${name} ` }, 400)
      await expectStatus(module, '重复名称更新', `/${second.id}`, 'PUT', { ...body, isActive: true }, 400)
      for (const invalid of [{ name: '' }, { name: '   ' }, { name: '长'.repeat(21) }, { phone: '123' }, { email: 'bad' }, { settlementType: 9 }, { paymentTermsDays: 45 }, customer ? { creditLimit: -1 } : { leadTimeDays: 366 }]) {
        await expectStatus(module, `无效输入 ${Object.keys(invalid)[0]}=${JSON.stringify(Object.values(invalid)[0])}`, '', 'POST', { ...body, name: `${name}X`, ...invalid }, 400)
      }
      // 同时间排序仍使用 ID，分页不可重复；SQL keyword 不能扩大结果。
      await pool.query(`UPDATE ${table} SET created_at='2026-09-12 10:00:00' WHERE id IN (?)`, [[first.id, second.id]])
      const page1 = await expectStatus(module, '名称筛选第一页', `?keyword=${name}&pageSize=1&page=1`, 'GET', undefined, 200)
      const page2 = await expectStatus(module, '名称筛选第二页', `?keyword=${name}&pageSize=1&page=2`, 'GET', undefined, 200)
      check(module, '稳定分页及精确总数', [page1.pagination.total, page1.list[0].id, page2.list[0].id], [2, second.id, first.id])
      const byCode = await request(module, `?keyword=${first.code}`)
      check(module, '编码筛选', byCode.body.data.list.map(r => r.id), [first.id])
      const injection = await request(module, `?keyword=${encodeURIComponent("' OR 1=1 --")}`)
      check(module, '筛选参数化', injection.body.data.pagination.total, 0)
      const bounded = await request(module, `?keyword=${name}&pageSize=999999`)
      check(module, '分页上限有界', bounded.body.data.pagination.pageSize, 500)
      await expectStatus(module, '更新及停用', `/${first.id}`, 'PUT', { ...body, code: first.code, isActive: false, settlementType: SETTLEMENT_TYPE.CASH, paymentTermsDays: 90, ...(customer ? { creditLimit: 0 } : { leadTimeDays: 365 }) }, 200)
      const updated = (await request(module, `/${first.id}`)).body.data
      check(module, '现金账期归零且编码保持', [updated.code, updated.isActive, updated.paymentTermsDays, customer ? updated.creditLimit : updated.leadTimeDays], [first.code, false, 0, customer ? 0 : 365])
      const active = (await request(module, '/active')).body.data
      check(module, '启用列表排除停用项并保留启用项', !active.some(r => r.id === first.id) && active.some(r => r.id === second.id))
      if (customer) {
        await expectStatus(module, '授信独立权限', `/${first.id}/credit`, 'GET', undefined, 403, reader)
        const credit = await expectStatus(module, '授信详情', `/${first.id}/credit`, 'GET', undefined, 200)
        check(module, '零额度合法且未用信', [credit.creditLimit, credit.used, credit.available], [0, 0, 0])
        const [[audit]] = await pool.query('SELECT old_limit,new_limit,operator_id FROM sale_customer_credit_logs WHERE customer_id=? ORDER BY id DESC LIMIT 1', [first.id])
        check(module, '授信变更实际审计归属', [Number(audit.old_limit), Number(audit.new_limit), audit.operator_id], [1000, 0, actor])
        const { creditLimit, ...withoutLimit } = body
        void creditLimit
        await expectStatus(module, '省略授信保持', `/${first.id}`, 'PUT', { ...withoutLimit, isActive: true }, 200)
        check(module, '省略授信不会关闭信控', (await request(module, `/${first.id}`)).body.data.creditLimit, 0)
        await expectStatus(module, '显式关闭信控', `/${first.id}`, 'PUT', { ...body, isActive: true, creditLimit: null }, 200)
        check(module, 'null 关闭信控', (await request(module, `/${first.id}`)).body.data.creditLimit, null)
      }
      // 三种引用各自单独存在，避免第一个引用掩盖其余守卫。
      const refs = customer ? ['sale_orders', 'sale_returns', 'warehouse_tasks'] : ['purchase_orders', 'purchase_returns', 'inventory_logs']
      for (const [index, reference] of refs.entries()) {
        let data
        if (reference === 'inventory_logs') data = { supplier_id: first.id, product_id: product, warehouse_id: warehouse }
        else {
          const noField = reference.endsWith('orders') ? 'order_no' : reference.endsWith('returns') ? 'return_no' : 'task_no'
          data = { [noField]: `${mark}${customer ? 'C' : 'S'}${index}`, [customer ? 'customer_id' : 'supplier_id']: first.id, [customer ? 'customer_name' : 'supplier_name']: name, warehouse_id: warehouse, warehouse_name: mark, ...(reference === 'warehouse_tasks' ? {} : { operator_id: actor, operator_name: mark }) }
        }
        const refId = await insert(reference, data)
        await expectStatus(module, `${reference} 引用禁止删除`, `/${first.id}`, 'DELETE', undefined, 409)
        check(module, `${reference} 拒绝后仍可读取`, (await request(module, `/${first.id}`)).status, 200)
        await expectStatus(module, `${reference} 引用保留时可停用`, `/${first.id}`, 'PUT', { ...body, isActive: false }, 200)
        check(module, `${reference} 引用保留时停用已持久化`, (await request(module, `/${first.id}`)).body.data.isActive, false)
        await pool.query(`DELETE FROM ${reference} WHERE id=?`, [refId])
      }
      await expectStatus(module, '无引用软删除', `/${first.id}`, 'DELETE', undefined, 200)
      await expectStatus(module, '已删除详情', `/${first.id}`, 'GET', undefined, 404)
      await expectStatus(module, '重复删除', `/${first.id}`, 'DELETE', undefined, 404)
      await expectStatus(module, '已删除更新', `/${first.id}`, 'PUT', { ...body, isActive: true }, 404)
      const remaining = (await request(module, `?keyword=${name}`)).body.data
      check(module, '列表排除软删除', remaining.list.map(r => r.id), [second.id])
    }

    const dep = 'departments'
    const parent = await create(dep, 'sys_departments', { name: `${mark}父`, managerId: actor, sortOrder: 2 })
    const child = await create(dep, 'sys_departments', { name: `${mark}子`, parentId: parent.id, sortOrder: 1 })
    const grandchild = await create(dep, 'sys_departments', { name: `${mark}孙`, parentId: child.id })
    for (const invalid of [{ name: '' }, { name: ' ' }, { name: mark, parentId: -1 }, { name: mark, managerId: 2147483647 }, { name: mark, parentId: 2147483647 }]) await expectStatus(dep, '创建校验', '', 'POST', invalid, 400)
    await expectStatus(dep, '拒绝自身父级', `/${parent.id}`, 'PUT', { parentId: parent.id }, 400)
    await expectStatus(dep, '拒绝子孙成环', `/${parent.id}`, 'PUT', { parentId: grandchild.id }, 400)
    const deletedParent = await create(dep, 'sys_departments', { name: `${mark}删` })
    await expectStatus(dep, '删除独立父级夹具', `/${deletedParent.id}`, 'DELETE', undefined, 200)
    await expectStatus(dep, '拒绝已删除的上级', `/${child.id}`, 'PUT', { parentId: deletedParent.id }, 400)
    await expectStatus(dep, '拒绝不存在的上级', `/${child.id}`, 'PUT', { parentId: 2147483647 }, 400)
    check(dep, '父级校验失败保持原归属', (await request(dep)).body.data.find(r => r.id === child.id).parentId, parent.id)
    await expectStatus(dep, '局部改名', `/${parent.id}`, 'PUT', { name: `${mark}改` }, 200)
    check(dep, '局部更新省略负责人保持原值', (await request(dep)).body.data.find(r => r.id === parent.id).managerId, actor)
    await expectStatus(dep, '负责人不存在更新', `/${parent.id}`, 'PUT', { managerId: 2147483647 }, 400)
    check(dep, '无效负责人失败保留原值', (await request(dep)).body.data.find(r => r.id === parent.id).managerId, actor)
    await expectStatus(dep, '显式清空负责人', `/${parent.id}`, 'PUT', { managerId: null }, 200)
    check(dep, '显式 null 清空负责人', (await request(dep)).body.data.find(r => r.id === parent.id).managerId, null)
    await expectStatus(dep, '有子部门禁止删除', `/${parent.id}`, 'DELETE', undefined, 409)
    await pool.query('UPDATE sys_users SET department_id=? WHERE id=?', [grandchild.id, denied])
    const member = (await request(dep)).body.data.find(r => r.id === grandchild.id)
    check(dep, '成员计数真实用户归属', member.memberCount, 1)
    await expectStatus(dep, '有成员禁止删除', `/${grandchild.id}`, 'DELETE', undefined, 409)
    const options = await expectStatus(dep, '无部门权限可用精简下拉契约', '/options', 'GET', undefined, 200, denied)
    check(dep, '精简下拉只含 id/name', Object.keys(options.find(r => r.id === parent.id)).sort(), ['id', 'name'])
    await pool.query('UPDATE sys_users SET department_id=NULL WHERE id=?', [denied])
    for (const id of [grandchild.id, child.id, parent.id]) await expectStatus(dep, '从叶向根删除', `/${id}`, 'DELETE', undefined, 200)
    check(dep, '列表和下拉均排除已删除部门', !(await request(dep)).body.data.some(r => r.id === parent.id) && !(await request(dep, '/options')).body.data.some(r => r.id === parent.id))
    await expectStatus(dep, '已删除更新', `/${parent.id}`, 'PUT', { name: mark }, 404)
    await expectStatus(dep, '重复删除', `/${parent.id}`, 'DELETE', undefined, 404)

    const cat = 'categories', chain = []
    for (let level = 1; level <= 4; level++) {
      const created = await create(cat, 'product_categories', { name: `${mark}L${level}`, parentId: chain.at(-1)?.id, sortOrder: level })
      const detail = await expectStatus(cat, `第${level}层详情`, `/${created.id}`, 'GET', undefined, 200)
      check(cat, `第${level}层祖先路径`, [detail.level, detail.path], [level, chain.map(c => c.id).join('/')])
      chain.push(created)
    }
    const [root] = chain, leaf = chain.at(-1)
    await expectStatus(cat, '第五层拒绝', '', 'POST', { name: mark, parentId: leaf.id }, 400)
    await expectStatus(cat, '缺失父分类拒绝', '', 'POST', { name: mark, parentId: 2147483647 }, 404)
    for (const invalid of [{ name: '' }, { name: '长'.repeat(61) }, { name: mark, parentId: -1 }, { name: mark, sortOrder: 1.5 }]) await expectStatus(cat, '输入校验', '', 'POST', invalid, 400)
    let tree = (await request(cat, '/tree')).body.data.find(r => r.id === root.id)
    for (const node of chain) { check(cat, '树形父子对应', tree.id, node.id); tree = tree.children[0] }
    const flat = (await request(cat, '/flat')).body.data.filter(r => chain.some(c => c.id === r.id))
    check(cat, '扁平层级顺序', flat.map(r => r.id), chain.map(c => c.id))
    const ownLeaves = async () => (await request(cat, '/leaves')).body.data.filter(r => chain.some(c => c.id === r.id)).map(r => r.id)
    check(cat, '叶子筛选仅末级', await ownLeaves(), [leaf.id])
    await expectStatus(cat, '只读角色拒绝状态写入', `/${leaf.id}/status`, 'PATCH', { status: false }, 403, reader)
    await expectStatus(cat, '停用叶子', `/${leaf.id}/status`, 'PATCH', { status: false }, 200)
    check(cat, '叶子筛选排除停用', await ownLeaves(), [])
    await expectStatus(cat, '更新名称排序备注并启用', `/${leaf.id}`, 'PUT', { name: `${mark}改`, status: true, sortOrder: 7, remark: mark }, 200)
    const catUpdated = (await request(cat, `/${leaf.id}`)).body.data
    check(cat, '更新持久化且层级不变', [catUpdated.name, catUpdated.status, catUpdated.sortOrder, catUpdated.remark, catUpdated.level], [`${mark}改`, 1, 7, mark, 4])
    await expectStatus(cat, '有子分类禁止删除', `/${root.id}`, 'DELETE', undefined, 400)
    await pool.query('UPDATE product_items SET category_id=? WHERE id=?', [leaf.id, product])
    await expectStatus(cat, '有商品引用禁止删除', `/${leaf.id}`, 'DELETE', undefined, 400)
    await pool.query('UPDATE product_items SET category_id=NULL WHERE id=?', [product])
    for (const node of [...chain].reverse()) await expectStatus(cat, '无引用从叶向根软删除', `/${node.id}`, 'DELETE', undefined, 200)
    await expectStatus(cat, '已删除详情', `/${leaf.id}`, 'GET', undefined, 404)
    await expectStatus(cat, '已删除状态更新', `/${leaf.id}/status`, 'PATCH', { status: true }, 404)
    check(cat, '扁平树和叶子排除软删除', !(await request(cat, '/flat')).body.data.some(r => r.id === leaf.id) && !(await request(cat, '/tree')).body.data.some(r => r.id === root.id) && (await ownLeaves()).length === 0)
  } finally {
    if (server) await new Promise(resolve => server.close(resolve))
    try {
      const ids = table => owned.get(table) || []
      if (ids('sys_users').length) await pool.query('UPDATE sys_users SET department_id=NULL WHERE id IN (?)', [ids('sys_users')])
      if (ids('product_items').length) await pool.query('UPDATE product_items SET category_id=NULL WHERE id IN (?)', [ids('product_items')])
      if (ids('sale_customers').length) await pool.query('DELETE FROM sale_customer_credit_logs WHERE customer_id IN (?)', [ids('sale_customers')])
      if (ids('sys_users').length) await pool.query('DELETE FROM auth_audit_logs WHERE user_id IN (?)', [ids('sys_users')])
      if (ids('sys_roles').length) await pool.query('DELETE FROM sys_role_permissions WHERE role_id IN (?)', [ids('sys_roles')])
      const order = ['inventory_logs', 'purchase_returns', 'purchase_orders', 'warehouse_tasks', 'sale_returns', 'sale_orders', 'sale_customers', 'supply_suppliers', 'product_items', 'product_categories', 'sys_departments', 'inventory_warehouses', 'sys_users', 'sys_roles']
      for (const table of order) if (ids(table).length) {
        for (const id of [...ids(table)].reverse()) await pool.query(`DELETE FROM ${table} WHERE id=?`, [id])
        const [[{ n }]] = await pool.query(`SELECT COUNT(*) AS n FROM ${table} WHERE id IN (?)`, [ids(table)])
        assert.equal(Number(n), 0, `cleanup ${table}`)
      }
      for (const [table, column, values] of [['sale_customer_credit_logs', 'customer_id', ids('sale_customers')], ['auth_audit_logs', 'user_id', ids('sys_users')], ['sys_role_permissions', 'role_id', ids('sys_roles')]]) if (values.length) {
        const [[{ n }]] = await pool.query(`SELECT COUNT(*) AS n FROM ${table} WHERE ${column} IN (?)`, [values])
        assert.equal(Number(n), 0, `cleanup related ${table}`)
      }
      console.log('[masterdata] cleanup verified: all owned IDs removed; no whole-table deletes')
    } finally { await pool.end() }
  }
  console.log('[masterdata] PASS assertion counts', counts)
}
main().catch(error => { console.error(error); process.exitCode = 1 })
