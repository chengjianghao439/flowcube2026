import { expect, test } from 'vitest'
import { visibleAccountIdentity } from './visibleAccountIdentity'

test('development login identity is neutral throughout personal surfaces', () => {
  expect(visibleAccountIdentity({ username: 'smoke_app_123', realName: 'Smoke申请人', roleName: 'Smoke审批人' })).toEqual({
    name: '当前用户', account: '—', role: '—',
  })
})

test('business login retains its identity', () => {
  expect(visibleAccountIdentity({ username: 'wang', realName: '王主管', roleName: '采购员' })).toEqual({
    name: '王主管', account: 'wang', role: '采购员',
  })
})
