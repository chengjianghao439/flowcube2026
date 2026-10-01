import { expect, test } from 'vitest'
import { routeRegistry } from './routeDefinitions'
import { PERMISSIONS } from '@/lib/permission-codes'
test('成套配件沿商品资料导航和原查看权限，菜单/标签标题一致', () => {
  const entry = routeRegistry.find(r => r.path === '/kits')
  expect(entry).toMatchObject({ title: '成套配件', permission: PERMISSIONS.PRODUCT_VIEW, componentKey: 'KitsPage', keepAlive: true, tabIdentity: { kind: 'pathname' }, nav: { kind: 'menu', group: '库存', section: '商品资料', order: 55 } })
})
