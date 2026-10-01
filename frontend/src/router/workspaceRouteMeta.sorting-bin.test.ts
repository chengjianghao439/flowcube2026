import { expect, test } from 'vitest'
import { buildWorkspaceTabRegistration } from './workspaceRouteMeta'
import { readSortingBinHandoff } from '@/pages/sorting-bins/handoff'

test('正常分拣格交接经过真实工作区注册后仍按稳定顺序规范化', () => {
  const registered = buildWorkspaceTabRegistration('/sorting-bins', '?warehouseId=8&keyword=&taskId=91')
  expect(registered).toEqual({ key: '/sorting-bins', path: '/sorting-bins?taskId=91&warehouseId=8' })
  expect(readSortingBinHandoff(registered.path)).toEqual({ taskId: 91, warehouseId: 8 })
})

test.each([
  '?taskId=91&taskId=&warehouseId=8',
  '?taskId=91&warehouseId=8&warehouseId=',
  '?taskId=&warehouseId=8',
  '?taskId=91&warehouseId=',
  '?taskId=&warehouseId=',
  '?taskId=91&taskId=92&warehouseId=8',
  '?taskId=91&warehouseId=8&warehouseId=9',
])('非法交接经过真实工作区注册仍保留无效信息：%s', search => {
  const registered = buildWorkspaceTabRegistration('/sorting-bins', search)
  expect(readSortingBinHandoff(registered.path)).toBe('invalid')
  const original = new URLSearchParams(search)
  const canonical = new URLSearchParams(registered.path.split('?')[1])
  for (const key of ['taskId', 'warehouseId']) {
    expect(canonical.getAll(key).sort()).toEqual(original.getAll(key).sort())
  }
})

test.each(['/sale', '/products', '/reports/role-workbench'])('其他路由仍丢弃空筛选与空上下文：%s', path => {
  const registered = buildWorkspaceTabRegistration(path, '?taskId=&warehouseId=&keyword=&status=2')
  expect(registered.path).toBe(`${path}?status=2`)
})
