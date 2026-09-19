// @vitest-environment jsdom
import { beforeEach, expect, test } from 'vitest'
import { HOME_TAB, useWorkspaceStore } from './workspaceStore'
import { resolveRouteTitle } from '@/router/routeDefinitions'

/**
 * 详情页标签名（2026-09-19）。
 *
 * 直接访问或刷新 `/#/sale/3260` 时，标签只能取 `routePatterns` 的兜底名「销售单 #3260」
 * ——那是数据库主键，用户认不出是哪张单，也与「从列表点进来」时显示的业务单号不一致。
 * 详情页数据到位后用 `useWorkspaceTabTitle` → `updateTabTitle` 换成单号；本组用例守住这条链，
 * 尤其是「父组件的路由兜底名不得把子组件设的单号覆盖回去」这一点（KeepAliveOutlet 的 effect
 * 晚于子组件执行，不挡就会在数据已缓存时把标签打回主键）。
 */

/** 复刻 KeepAliveOutlet:187-188 的真实调用形态：路由变化时会带上兜底名。 */
function syncLikeRouter(path: string) {
  useWorkspaceStore.getState().syncFromLocation(path, resolveRouteTitle(path) ?? path)
}

beforeEach(() => {
  useWorkspaceStore.setState({ tabs: [HOME_TAB], activeKey: HOME_TAB.key })
})

test('详情页数据到位后标签换成业务单号，且不把用户从别的标签拽回来', () => {
  syncLikeRouter('/sale/3260')
  expect(useWorkspaceStore.getState().tabs[1].title).toBe('销售单 #3260')

  // 用户已经切到别的标签，销售单数据这时才回来
  useWorkspaceStore.getState().addTab({ key: '/products', path: '/products', title: '商品管理' })
  useWorkspaceStore.getState().updateTabTitle('/sale/3260', 'SO20260919001')

  const state = useWorkspaceStore.getState()
  expect(state.tabs.find(tab => tab.path === '/sale/3260')?.title).toBe('SO20260919001')
  expect(state.activeKey).toBe('/products')
})

test('路由兜底名不得覆盖页面已设的单号（切走再切回、刷新都靠这条）', () => {
  syncLikeRouter('/sale/3260')
  useWorkspaceStore.getState().updateTabTitle('/sale/3260', 'SO20260919001')
  syncLikeRouter('/sale/3260')
  expect(useWorkspaceStore.getState().tabs[1].title).toBe('SO20260919001')
})

test('查询串变化（focus=fulfillment）不影响已设的单号', () => {
  syncLikeRouter('/sale/3260')
  useWorkspaceStore.getState().updateTabTitle('/sale/3260', 'SO20260919001')
  syncLikeRouter('/sale/3260?focus=fulfillment')
  expect(useWorkspaceStore.getState().tabs[1].title).toBe('SO20260919001')
})

test('打开另一张单是新标签，各自标题互不串台', () => {
  syncLikeRouter('/sale/3260')
  useWorkspaceStore.getState().updateTabTitle('/sale/3260', 'SO20260919001')
  syncLikeRouter('/sale/3261')
  const tabs = useWorkspaceStore.getState().tabs
  expect(tabs.find(tab => tab.path === '/sale/3260')?.title).toBe('SO20260919001')
  expect(tabs.find(tab => tab.path === '/sale/3261')?.title).toBe('销售单 #3261')
})

test('列表页标题不受影响，仍用路由定义名', () => {
  syncLikeRouter('/sale')
  expect(useWorkspaceStore.getState().tabs[1].title).toBe('销售订单')
})
