import { expect, test } from 'vitest'
import { visibleRoles } from './visibleRoles'

const roles = [
  { id: 2, code: 'warehouse_manager', is_system: 1 },
  { id: 7, code: 'smoke_scoped', is_system: 1 },
  { id: 9, code: 'smoke_approver', is_system: 0 },
]

test('all front-end role choices hide development codes even when marked as system roles', () => {
  expect(visibleRoles(roles).map(role => role.id)).toEqual([2])
})
