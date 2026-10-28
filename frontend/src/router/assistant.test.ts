// @vitest-environment jsdom
import { expect, test } from 'vitest'
import { buildTopNavSections, routeRegistry, resolveRouteTitle } from './routeDefinitions'
import { buildWorkspaceTabRegistrationFromPath } from './workspaceRouteMeta'
import { PERMISSIONS } from '@/lib/permission-codes'
import { HOME_TAB, useWorkspaceStore } from '@/store/workspaceStore'

test('小满替换待办顶栏，名称与工作区一致；原待办路径和权限保留', () => {
  const nav = buildTopNavSections().filter(s => s.kind === 'link')
  expect(nav.map(s => s.label)).toContain('小满')
  expect(nav.map(s => s.label)).not.toContain('待办中心')
  const assistant = routeRegistry.find(r => r.path === '/assistant')
  expect(assistant?.keepAlive).toBe(true)
  expect(resolveRouteTitle('/assistant')).toBe('小满')
  useWorkspaceStore.setState({ tabs: [HOME_TAB], activeKey: HOME_TAB.key, recentKeys: [] })
  useWorkspaceStore.getState().addTab({ ...buildWorkspaceTabRegistrationFromPath('/assistant'), title: '旧名称' })
  expect(useWorkspaceStore.getState().tabs.find(t => t.path === '/assistant')?.title).toBe('小满')
  const todo = routeRegistry.find(r => r.path === '/reports/role-workbench')
  expect(todo?.permission).toBe(PERMISSIONS.REPORT_VIEW)
  expect(todo?.aliases).toContain('/reports/exception-workbench')
  expect(todo?.nav).toBeUndefined()
})
