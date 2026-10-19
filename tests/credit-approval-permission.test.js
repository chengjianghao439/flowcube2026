const { test } = require('node:test')
const assert = require('node:assert/strict')
const policy = require('../backend/src/modules/credit-overrides/credit-overrides.policy')

test('财务只持查看、待办及独立审批权即可审批，无需申请权', () => {
  const actor = { userId: 8, roleId: 10, allowSelfApprove: false, permissions: ['sale.credit.override.view', 'approval.task.view', 'sale.credit.override.approve'] }
  assert.equal(policy.canAct(actor, 7), true)
  policy.assertAction(actor, 7, '')
})

test('销售的申请权和自批开关均不能代替独立审批权', () => {
  const actor = { userId: 7, roleId: 4, allowSelfApprove: true, permissions: ['sale.credit.override.view', 'approval.task.view', 'sale.credit.override.apply'] }
  assert.equal(policy.canAct(actor, 7), false)
  assert.equal(policy.canAct(actor, 9), false)
  assert.throws(() => policy.assertAction(actor, 7, '申请人本人确认'), { code: 'CREDIT_APPROVAL_DENIED' })
})

test('独立审批权仍需查看、待办和有效自批设置', () => {
  const permissions = ['sale.credit.override.view', 'approval.task.view', 'sale.credit.override.approve']
  const actor = { userId: 7, roleId: 10, allowSelfApprove: true, permissions }
  assert.equal(policy.canAct(actor, 7), true)
  for (const absent of permissions) assert.equal(policy.canAct({ ...actor, permissions: permissions.filter(p => p !== absent) }, 7), false, absent)
  assert.equal(policy.canAct({ ...actor, allowSelfApprove: false }, 7), false)
})
