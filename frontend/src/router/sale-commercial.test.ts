import { expect, test } from 'vitest'
import { routeRegistry, resolveRouteTitle } from './routeDefinitions'
import { buildWorkspaceTabRegistration } from './workspaceRouteMeta'
import { PERMISSIONS } from '@/lib/permission-codes'
test('explicit kit sale route shares menu/tab/title and protects sale.create while ordinary new remains unchanged', () => {
  expect(routeRegistry.find((r) => r.path === '/sale/new-kit')).toMatchObject({
    title: '新建套销售',
    componentKey: 'SaleFormPage',
    permission: PERMISSIONS.SALE_ORDER_CREATE,
    nav: { group: '销售' }
  })
  expect(resolveRouteTitle('/sale/new-kit')).toBe('新建套销售')
  expect(resolveRouteTitle('/sale/new')).toBe('新建销售单')
  expect(buildWorkspaceTabRegistration('/sale/new-kit', '')).toMatchObject({
    key: '/sale/new-kit',
    path: '/sale/new-kit'
  })
  expect(buildWorkspaceTabRegistration('/sale/new', '')).toMatchObject({ key: '/sale/new', path: '/sale/new' })
})
