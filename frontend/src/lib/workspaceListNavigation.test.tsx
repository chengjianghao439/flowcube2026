// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, useLocation, useNavigate, type NavigateFunction } from 'react-router-dom'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { getWorkspaceListPath } from './workspaceListNavigation'
import { HOME_TAB, useWorkspaceStore } from '@/store/workspaceStore'
import { useDirtyGuardStore } from '@/store/dirtyGuardStore'
import { buildWorkspaceTabRegistrationFromPath } from '@/router/workspaceRouteMeta'
import { buildTopNavSections, routeRegistry, routePatterns, resolveRouteTitle } from '@/router/routeDefinitions'
import { MERGED_PAGE_GROUPS } from '@/router/mergedPageGroups'
import { WorkspaceTabs } from '@/components/layout/WorkspaceTabs'
import { TopNav } from '@/components/layout/TopNav'
import { KeepAliveOutlet } from '@/components/layout/KeepAliveOutlet'
import { disposeWorkspaceHistoryGuard } from '@/router/workspaceHistoryGuard'

vi.mock('@/hooks/usePermission', () => ({ usePermission: () => ({ can: () => true }) }))
vi.mock('@/router/routeRegistry', async original => ({ ...await original<typeof import('@/router/routeRegistry')>(), resolveRouteComponent: () => null }))
let host: HTMLDivElement, root: Root, navigate: NavigateFunction
const suffix = '?endDate=2026-10-08&keyword=synthetic&startDate=2026-10-08&status=1&warehouseId=10'
const save = (path: string) => useWorkspaceStore.getState().syncFromLocation(path, resolveRouteTitle(path.split('?')[0]) ?? path)
function Harness() { const location = useLocation(); navigate = useNavigate(); return <><output data-location>{location.pathname + location.search}</output><TopNav /><WorkspaceTabs /><KeepAliveOutlet /></> }
async function render(path: string) { await act(async () => root.render(<MemoryRouter initialEntries={[path]}><Harness /></MemoryRouter>)) }
async function go(path: string) { await act(async () => navigate(path)) }
const current = () => host.querySelector('[data-location]')!.textContent
beforeEach(() => {
 Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); Element.prototype.scrollIntoView = vi.fn()
 useWorkspaceStore.setState({ tabs: [HOME_TAB], activeKey: HOME_TAB.key }); useDirtyGuardStore.setState({dirtyTabs:{},pendingConfirm:null,bypassNextBlock:false})
 host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); disposeWorkspaceHistoryGuard(); useWorkspaceStore.setState({ tabs: [HOME_TAB], activeKey: HOME_TAB.key }) })

test.each(routeRegistry.filter(route => route.tabIdentity.kind === 'pathname'))('已登记页 $path 沿用其已应用路径（共享定位层）', route => {
 save(route.path + suffix); expect(getWorkspaceListPath(route.path)).toBe(route.path + suffix)
 expect(getWorkspaceListPath(route.path + '?range=all')).toBe(route.path + '?range=all')
})
const menuCases = buildTopNavSections().flatMap(section => section.kind === 'link' ? [{group: '', label: section.label, path: section.path}] : section.children.map(child => ({group: section.children.length === 1 ? '' : section.label, ...child, label: section.children.length === 1 ? section.label : child.label})))
test.each(menuCases)('真实菜单 $path 恢复当前列表路径（共享组件层）', async item => {
 save(item.path + suffix); await render(item.path === '/dashboard' ? '/settings' : '/dashboard');
 if (item.group) await act(async () => { [...host.querySelectorAll('button')].find(b => b.textContent?.trim() === item.group)!.dispatchEvent(new MouseEvent('mouseover',{bubbles:true})) })
 const selector = item.group ? '[role="menuitem"]' : 'a'
 const button = [...host.querySelectorAll<HTMLButtonElement>(selector)].find(b => b.textContent?.trim() === item.label)!
 expect(button).toBeDefined(); await act(async () => button.click()); expect(current()).toBe(item.path === '/settings/barcode-print-query' ? item.path : item.path + suffix)
})
const patternCases = routePatterns.filter(route => route.listPath).flatMap(route => {
 const paths = ['logistics/42','products/new','products/42','sale/new','sale/42','purchase/new','purchase/42','procurement/42','purchase-requisitions/new','purchase-requisitions/42','transfer/new','transfer/42','returns/purchase/new','returns/purchase/42','returns/sale/new','returns/sale/42','inbound-tasks/new','inbound-tasks/42/edit','inbound-tasks/42','settings/print-templates/new','settings/print-templates/42']
 return paths.filter(p => route.pattern.test('/'+p)).map(p => ({path:'/'+p,list:route.listPath!,title:route.title('/'+p)}))
})
test.each(patternCases.flatMap(item => [item, { ...item, path: item.path + '?focus=readOnly&keyword=detail' }]))('关闭 $path 返回其 $list 完整筛选（共享组件层）', async item => {
 save(item.list + suffix); await render(item.path)
 const close = host.querySelector<HTMLButtonElement>(`button[aria-label="关闭 ${item.title}"]`)!
 expect(close).toBeDefined(); await act(async () => close.click()); expect(current()).toBe(item.list + suffix)
})
test.each(MERGED_PAGE_GROUPS)('合并页 $key 分开恢复子视图查询，不替换成另一视图', group => {
 for(const view of group.views) save(view.path + '?keyword=' + encodeURIComponent(view.path))
 for(const view of group.views) expect(getWorkspaceListPath(view.path)).toBe(view.path + '?keyword=' + encodeURIComponent(view.path))
})
test('明确新建上下文、无原列表、错误来源和显式清空沿用指定目标', () => {
 expect(getWorkspaceListPath('/purchase')).toBe('/purchase')
 save('/sale/new?sourceId=7'); save('/sale/new?sourceId=8')
 expect(getWorkspaceListPath('/sale/new?sourceId=9')).toBe('/sale/new?sourceId=9')
 expect(getWorkspaceListPath('/sale/new')).toBe('/sale/new')
 expect(getWorkspaceListPath('/purchase?')).toBe('/purchase?')
 useWorkspaceStore.setState({tabs:[HOME_TAB,{key:'/purchase',path:'/sale?keyword=wrong',title:'invalid',closable:true}]})
 expect(getWorkspaceListPath('/purchase')).toBe('/purchase')
})
test('关闭非活动详情不改变另一详情；脏草稿取消关闭后仍保留，可确认关闭回原筛选', async () => {
 save('/purchase'+suffix); save('/purchase/41'); await render('/purchase/42')
 await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="关闭 采购订单 #41"]')!.click()); expect(current()).toBe('/purchase/42')
 await go('/purchase/new?sourceId=7'); const key=buildWorkspaceTabRegistrationFromPath('/purchase/new?sourceId=7').key
 await act(async () => useDirtyGuardStore.getState().setDirty(key,true))
 await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="关闭 新建采购单"]')!.click()); expect(useDirtyGuardStore.getState().pendingConfirm).not.toBeNull()
 await act(async () => useDirtyGuardStore.getState().resolveConfirm(false)); expect(current()).toBe('/purchase/new?sourceId=7')
 await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="关闭 新建采购单"]')!.click()); await act(async () => useDirtyGuardStore.getState().resolveConfirm(true)); expect(current()).toBe('/purchase'+suffix)
})
test.each(routeRegistry.filter(route => route.tabIdentity.kind !== 'pathname'))('独立来源页 $path 尊重显式上下文，裸入口不合并其他来源', route => {
 save(route.path + '?focus=one&waveId=7&sourceId=7&handlingSourceId=7&purchaseReturnId=7&keyword=ORIGINAL')
 expect(getWorkspaceListPath(route.path + '?sourceId=8&keyword=EXPLICIT')).toBe(route.path + '?sourceId=8&keyword=EXPLICIT')
 expect(getWorkspaceListPath(route.path)).toBe(route.path)
})
test.each(['customer','supplier'])('无固定列表归属的往来详情 %s 关闭后保留原相邻页完整路径',async side=>{
 save('/payments/receivable'+suffix);const detail='/payments/ledger/'+side+'/42';await render(detail)
 const title=resolveRouteTitle(detail)!
 await act(async()=>host.querySelector<HTMLButtonElement>(`button[aria-label="关闭 ${title}"]`)!.click());expect(current()).toBe('/payments/receivable'+suffix)
})
