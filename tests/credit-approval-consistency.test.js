const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const path = require('node:path')
const root = path.resolve(__dirname, '..')
const AppError = require('../backend/src/utils/AppError')
const contracts = require('../backend/src/modules/sale/sale.contracts')

function shipping(approved = null) {
  const sandbox = { module: { exports: {} }, require: name => {
    if (name === '../../utils/AppError') return AppError
    if (name === '../../utils/creditExposure') return { getCustomerCreditUsed: async () => 0, hasCreditOverridePermission: async () => true }
    if (name === '../sale/sale.contracts') return contracts
    if (name === '../credit-overrides/credit-overrides.service') return { hasApprovedOverride: async () => approved }
    return {}
  } }
  vm.runInNewContext(fs.readFileSync(path.join(root, 'backend/src/modules/warehouse-tasks/warehouse-tasks.ship.js'), 'utf8'), sandbox)
  return sandbox.module.exports.assertCreditWithinLimit
}
const db = { query: async sql => {
  if (sql.includes('sale_customers')) return [[{ id: 7, credit_limit: 100 }]]
  if (sql.includes('payment_records')) return [[{ paid_amount: 0 }]]
  if (sql.includes('sale_orders')) return [[{ id: 11, customer_id: 7, total_amount: 120, discount_amount: 0 }]]
  throw Error('Unexpected SQL: ' + sql)
} }
test('超额出库：管理员也不能凭身份直放', async () => {
  await assert.rejects(shipping()(db, 7, 120, { userId: 1, roleId: 1 }, 11), { code: 'CREDIT_LIMIT_EXCEEDED' })
})
test('超额出库：旧直放权也必须先取得审批', async () => {
  await assert.rejects(shipping()(db, 7, 120, { userId: 9, roleId: 4 }, 11), { code: 'CREDIT_LIMIT_EXCEEDED' })
})
test('批准后的仓库作业不再要求仓管有直放权限', async () => {
  await shipping(91)(db, 7, 120, { userId: 9, roleId: 2 }, 11)
})
test('旧申请缺少版本证明时不能静默视为有效批准', () => {
  assert.equal(contracts.isApprovedOverrideApplicable({ customer_id: 7, credit_limit: 100, this_amount: 120, over_amount: 20 }, { customerId: 7, creditLimit: 100, thisAmount: 120, overAmount: 20 }), false)
})

test('商业内容证明覆盖等额换商品/改仓/改量改价，但保留占库和部分发运进度', async () => {
  const policy = require('../backend/src/modules/credit-overrides/credit-overrides.policy')
  const order = { id: 11, customer_id: 7, warehouse_id: 2, total_amount: '120.0000', discount_amount: '0.00', commercial_revision: 0 }
  const item = { id: 19, product_id: 8, warehouse_id: 2, unit: '个', quantity: '2.00', unit_price: '60.0000' }
  const basis = (head = order, row = item) => policy.orderBasis({ query: async () => [[row]] }, head)
  const original = await basis()
  assert.equal(await basis({ ...order, status: 3, task_id: 91 }, { ...item, reserved_qty: 2, shipped_qty: 1 }), original)
  for (const head of [{ ...order, customer_id: 9 }, { ...order, warehouse_id: 3 }, { ...order, commercial_revision: 1 }]) assert.notEqual(await basis(head), original)
  for (const row of [{ ...item, product_id: 9 }, { ...item, warehouse_id: 3 }, { ...item, quantity: '1.00', unit_price: '120.0000' }]) assert.notEqual(await basis(order, row), original)
})

test('自行审批豁免不会授业务权限，必须有理由，管理员也不自动获得自批豁免', () => {
  const policy = require('../backend/src/modules/credit-overrides/credit-overrides.policy')
  const actor = { userId: 7, roleId: 2, allowSelfApprove: true, permissions: policy.ACTION_PERMISSIONS }
  assert.equal(policy.canAct(actor, 7), true)
  assert.equal(policy.canAct({ ...actor, permissions: [] }, 7), false)
  assert.throws(() => policy.assertAction({ ...actor, roleId: 1, allowSelfApprove: false }, 7, '原因'), { code: 'SELF_APPROVAL_DENIED' })
  assert.throws(() => policy.assertAction(actor, 7, ''), { code: 'SELF_APPROVAL_REASON_REQUIRED' })
  policy.assertAction(actor, 7, '本人承担本次授信审核')
  policy.assertAction({ ...actor, allowSelfApprove: false }, 9, '')
})

test('审批锁后读取当前实例及节点，避免等待订单锁后仍用旧RR节点', async () => {
  const queries = []
  const sandbox = { module: { exports: {} }, require: name => name === '../utils/AppError' ? AppError : {} }
  vm.runInNewContext(fs.readFileSync(path.join(root, 'backend/src/engine/approvalEngine.js'), 'utf8'), sandbox)
  const conn = { query: async sql => { queries.push(sql); return sql.includes('FROM approval_instances') ? [[{ id: 61, current_step: 2 }]] : [[{ id: 72, step_order: 2 }]] } }
  const got = await sandbox.module.exports.getActiveInstanceByBiz(conn, { bizType: 'sale_credit_override', bizId: 11, currentRead: true })
  assert.equal(got.tasks[0].id, 72)
  assert.ok(queries.every(sql => sql.endsWith(' FOR SHARE')))
})
