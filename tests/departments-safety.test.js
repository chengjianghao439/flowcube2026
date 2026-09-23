'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const dbPath = require.resolve('../backend/src/config/db')
const pool = { query: async () => { throw new Error('未配置测试查询') } }
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { pool } }
const service = require('../backend/src/modules/departments/departments.service')

test('新增和修改不能指定已禁用的负责人', async () => {
  const writes = []
  pool.query = async (sql) => {
    if (sql.includes('FROM sys_users WHERE id=')) return [[{ id: 12, is_active: 0 }]]
    if (sql.includes('FROM sys_departments WHERE id=')) return [[{ id: 4, parent_id: 0, name: '采购部' }]]
    writes.push(sql)
    return [{ insertId: 9 }]
  }
  await assert.rejects(service.create({ name: '采购部', managerId: 12 }), /负责人.*启用/)
  await assert.rejects(service.update(4, { managerId: 12 }), /负责人.*启用/)
  assert.deepEqual(writes, [])
})

test('删除仍被审批流引用的部门时给出引用数量且不写入', async () => {
  const writes = []
  pool.query = async (sql) => {
    if (sql.includes('FROM sys_departments WHERE id=')) return [[{ id: 4 }]]
    if (sql.includes('AS sub')) return [[{ sub: 0 }]]
    if (sql.includes('AS members')) return [[{ members: 0 }]]
    if (sql.includes('approval_flow_steps')) return [[{ flow_count: 2 }]]
    writes.push(sql)
    return [{}]
  }
  await assert.rejects(service.remove(4), error => error.statusCode === 409 && /2.*审批流/.test(error.message))
  assert.deepEqual(writes, [])
})

test('部门列表返回负责人有效性和引用审批流数', async () => {
  pool.query = async sql => {
    if (sql.includes('GROUP BY s.department_id')) return [[{ department_id: 4, flow_count: 2 }]]
    return [[{
      id: 4, name: '采购部', parent_id: 0, manager_id: 12, manager_name: '王主管',
      manager_is_active: 0, sort_order: 0, remark: null, created_at: '2026-09-23 09:00:00',
      member_count: 3,
    }]]
  }
  const [row] = await service.findAll()
  assert.equal(row.managerIsActive, false)
  assert.equal(row.approvalFlowCount, 2)
  assert.equal(row.memberCount, 3)
})

test('开发账号担任负责人时不向部门列表返回姓名', async () => {
  let listSql = ''
  pool.query = async sql => {
    if (sql.includes('GROUP BY s.department_id')) return [[]]
    listSql = sql
    return [[{
      id: 4, name: '采购部', parent_id: 0, manager_id: 12, manager_name: 'Smoke申请人',
      manager_is_active: 0, manager_is_development: 1, sort_order: 0, remark: null,
      created_at: '2026-09-23 09:00:00', member_count: 0,
    }]]
  }
  const [row] = await service.findAll()
  assert.equal(row.managerId, 12)
  assert.equal(row.managerName, null)
  assert.equal(row.managerIsDevelopment, true)
  assert.match(listSql, /su\.username NOT REGEXP/)
})
