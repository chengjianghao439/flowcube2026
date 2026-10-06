// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { AxiosAdapter } from 'axios'
import client, { setApiClientBaseURL } from '@/api/client'
import { _registerConfirmFn, type ConfirmOptions } from '@/lib/confirm'
import { SectionVisibilityContext } from '@/components/layout/SectionVisibilityContext'
import { useAuthStore } from '@/store/authStore'
import { PERMISSIONS as P } from '@/lib/permission-codes'
import type { DisposalOrder } from '@/types/disposal'
import Detail from './components/DisposalDetailDialog'
import Page from './index'
import Suggestions from './components/CreateDisposalDialog'
import { useWorkspaceStore } from '@/store/workspaceStore'
vi.mock('@/components/shared/OrderDetailSections', () => ({ OrderDetailSections: ({ children }: { children: React.ReactNode }) => children }))
// jsdom只替换低层Select浮层定位，保留真实处置页、表单状态、路由与所有API adapter。
vi.mock('@/components/ui/select', async () => {
  const React = await import('react'), Context = React.createContext<(value: string) => void>(() => {})
  return { Select: ({ children, onValueChange }: { children: React.ReactNode; onValueChange: (value: string) => void }) => <Context.Provider value={onValueChange}>{children}</Context.Provider>, SelectTrigger: () => null, SelectValue: () => null, SelectContent: ({ children }: { children: React.ReactNode }) => children, SelectItem: ({ children, value }: { children: React.ReactNode; value: string }) => { const choose = React.useContext(Context); return <button role="option" onClick={() => choose(value)}>{children}</button> } }
})
const oldAdapter = client.defaults.adapter
let root: Root, host: HTMLDivElement
const requests: string[] = []
const confirms: ConfirmOptions[] = []
const detail = (type: 1 | 2 | 3, status: DisposalOrder['status'] = 2): DisposalOrder => ({ id: 11, disposalNo: 'DP11', warehouseId: 8, warehouseName: 'fixture', status, statusName: '待审批', totalValue: 10, operatorId: 7, operatorName: 'fixture', approvedBy: null, approvedByName: null, approvedAt: null, rejectReason: null, disposedAt: null, createdAt: '2026-10-04T00:00:00Z', items: [{ id: 1, productId: 3, productCode: 'P3', productName: 'fixture', unit: '个', articleNumber: null, spec: null, color: null, quantity: 2, unitValue: 5, value: 10, disposeType: type, disposeTypeName: 'fixture' }] })
async function draw(children: React.ReactNode) { await act(async () => { root.render(<MemoryRouter initialEntries={['/disposals']}><QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>{children}</QueryClientProvider></MemoryRouter>); await new Promise(resolve => setTimeout(resolve, 15)) }) }
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); host = document.createElement('div'); document.body.append(host); root = createRoot(host); requests.length = 0; useAuthStore.setState({ token: 'offline', user: { id: 9, username: 'fixture', realName: 'fixture', roleId: 2, roleName: 'fixture', permissions: [P.INVENTORY_DISPOSAL_VIEW, P.INVENTORY_DISPOSAL_APPROVE, P.INVENTORY_DISPOSAL_CREATE, P.INVENTORY_DISPOSAL_EXECUTE] } }); client.defaults.adapter = (async config => { const path = config.url || ''; requests.push(path); if (!['/warehouses/active', '/disposals'].includes(path)) throw Error(`Unexpected offline API: ${path}`); return { status: 200, statusText: 'OK', headers: {}, config, data: { success: true, data: path === '/warehouses/active' ? [] : { list: [], pagination: { total: 0, page: 1, pageSize: 20 } } } } }) satisfies AxiosAdapter })
afterEach(async () => { await act(async () => root.unmount()); host.remove(); document.body.innerHTML = ''; client.defaults.adapter = oldAdapter; localStorage.clear(); useAuthStore.setState({ token: null, user: null }) })
it('历史1/2待审保留驳回取消，但不再批准直接扣库', async () => { await draw(<Detail open id={11} initialDetail={detail(1)} onClose={() => {}} />); const labels = [...document.querySelectorAll('button')].map(b => b.textContent); expect(labels).toContain('驳回'); expect(labels).toContain('取消'); expect(labels).not.toContain('审批通过'); expect(labels).not.toContain('执行报废') })
it.each([1, 2] as const)('历史已批准类型%s明确待签认且无执行/取消假出口，历史价保持', async type => { await draw(<Detail open id={11} initialDetail={detail(type, 3)} onClose={() => {}} />); expect(document.querySelector('[role="dialog"] h2')?.textContent).toContain('待签认'); expect([...document.querySelectorAll('button')].some(b => /执行|审批通过|取消/.test(b.textContent || ''))).toBe(false); expect(document.body.textContent).toContain('历史参考价') })
it.each([[1, '草稿'], [2, '待审批'], [3, '已批准']] as const)('报废类型status%s使用标准状态而不因错误API文案展示待签认', async (status, label) => { await draw(<Detail open id={11} initialDetail={detail(3, status)} onClose={() => {}} />); const title = document.querySelector('[role="dialog"] h2')?.textContent; expect(title).toContain(label); expect(title).not.toContain('待签认') })
it('VIEW-only可达建议入口，无报废创建按钮/自动建议读取', async () => { useAuthStore.setState(s => ({ user: { ...s.user!, permissions: [P.INVENTORY_DISPOSAL_VIEW] } })); await draw(<Page />); expect(document.body.textContent).toContain('滞销建议'); expect(document.body.textContent).not.toContain('新建报废单'); expect(requests).not.toContain('/disposals/suggestions') })
it.each(['hidden', 'close', 'id', 'serverABA', 'permission'])('真正详情的旧确认回调在%s后不POST，也不关闭新详情', async change => {
  confirms.length = 0; _registerConfirmFn(options => confirms.push(options))
  let closes = 0, active = true, open = true, value = detail(3, 3)
  const render = () => draw(<SectionVisibilityContext.Provider value={active}><Detail open={open} id={value.id} initialDetail={value} onClose={() => { closes++ }} /></SectionVisibilityContext.Provider>)
  await render(); await act(async () => [...document.querySelectorAll('button')].find(button => button.textContent === '执行报废')!.click())
  const oldConfirm = confirms.at(-1)!.onConfirm
  if (change === 'hidden') { active = false; await render(); active = true }
  if (change === 'close') { open = false; await render(); open = true }
  if (change === 'id') value = { ...detail(3, 3), id: 12, disposalNo: 'DP12' }
  if (change === 'serverABA') await act(async () => { setApiClientBaseURL('/b'); setApiClientBaseURL('/a') })
  if (change === 'permission') await act(async () => useAuthStore.setState(s => ({ user: { ...s.user!, permissions: [P.INVENTORY_DISPOSAL_VIEW] } })))
  await render(); await act(async () => { await oldConfirm() })
  expect(requests.filter(path => path.endsWith('/dispose'))).toHaveLength(0); expect(closes).toBe(0)
})
it('执行ACK晚到另一单详情时保留原请求，不能关闭或显示另一单成功', async () => {
  confirms.length = 0; _registerConfirmFn(options => confirms.push(options))
  let release: (() => void) | undefined, closes = 0, value = detail(3, 3)
  client.defaults.adapter = (async config => { requests.push(config.url!); if (config.method !== 'post' || config.url !== '/disposals/11/dispose') throw Error('Only original frozen POST allowed'); await new Promise<void>(resolve => { release = resolve }); return { status: 200, statusText: 'OK', headers: {}, config, data: { success: true, data: { id: 11, disposalNo: 'DP11', disposedValue: 10 } } } }) satisfies AxiosAdapter
  const render = () => draw(<Detail open id={value.id} initialDetail={value} onClose={() => { closes++ }} />)
  await render(); await act(async () => [...document.querySelectorAll('button')].find(button => button.textContent === '执行报废')!.click())
  let pending: unknown; await act(async () => { pending = confirms.at(-1)!.onConfirm(); await new Promise(resolve => setTimeout(resolve, 5)) })
  value = { ...detail(3, 3), id: 12, disposalNo: 'DP12' }; await render()
  await act(async () => { release!(); await pending }); expect(closes).toBe(0); expect(document.body.textContent).toContain('DP12'); expect(document.body.textContent).not.toContain('报废已确认完成')
  expect(localStorage.getItem('flowcube-disposal-execution-v1')).toContain('disposal.dispose.11')
})
it('VIEW建议经真实API展示单位参考价、零参考量不圈选；正常入口沿用已有草稿query并保留圈选', async () => {
  useAuthStore.setState(s => ({ user: { ...s.user!, permissions: [P.INVENTORY_DISPOSAL_VIEW, P.SALE_ORDER_CREATE] } }))
  const existing = { key: '/sale/new', path: '/sale/new?draft=keep', title: '新建销售', closable: true }
  useWorkspaceStore.setState({ tabs: [existing], activeKey: '/sale/new' })
  client.defaults.adapter = (async config => { requests.push(config.url!); const suggestion = { productId: 3, productCode: 'P3', productName: 'positive', unit: '个', warehouseId: 8, totalQty: 18, onHandQty: 30, reservedQty: 12, unitValue: 5, totalValue: 150, valuationBasis: 'avg_cost', lastOutboundAt: null }
    const value = config.url === '/warehouses/active' ? [{ id: 8, name: 'fixture' }] : config.url === '/disposals/suggestions' ? { list: [suggestion, { ...suggestion, productId: 4, productCode: 'P4', productName: 'zero', totalQty: 0 }], pagination: { total: 2, page: 1, pageSize: 50 } } : config.url === '/products/qty-policies' ? [{ id: 3, allowDecimal: false }] : undefined
    if (value === undefined) throw Error(`Forbidden suggestion API ${config.url}`); return { status: 200, statusText: 'OK', headers: {}, config, data: { success: true, data: value } }
  }) satisfies AxiosAdapter
  let closes = 0, location = ''; function Location() { const value = useLocation(); location = value.pathname + value.search; return null }
  await draw(<><Suggestions mode="suggestions" open onClose={() => { closes++ }} /><Location /></>)
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 15)) })
  expect(requests).toContain('/warehouses/active'); expect([...document.querySelectorAll('[role="option"]')].map(node => node.textContent)).toContain('fixture')
  await act(async () => [...document.querySelectorAll('[role="option"]')].find(node => node.textContent === 'fixture')!.dispatchEvent(new MouseEvent('click', { bubbles: true })))
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 15)) })
  expect(requests).toContain('/disposals/suggestions'); expect(document.body.textContent).toContain('30个／18个'); expect(document.body.textContent).toContain('平均成本 ¥5.00')
  const add = [...document.querySelectorAll('button')].filter(button => button.textContent === '加入'); expect(add).toHaveLength(2); expect(add[1].disabled).toBe(true)
  await act(async () => add[0].click()); expect(document.body.textContent).toContain('处置明细（1 项）'); expect(document.body.textContent).toContain('选中数量参考估值：¥90.00')
  const full = Array.from({ length: 30 }, (_, index) => ({ key: `/sale/${index + 1}`, path: `/sale/${index + 1}`, title: `销售${index + 1}`, closable: true }))
  useWorkspaceStore.setState({ tabs: full, activeKey: full[0].key }); await act(async () => [...document.querySelectorAll('button')].find(button => button.textContent === '正常销售')!.click())
  expect(closes).toBe(0); expect(useWorkspaceStore.getState().tabs).toEqual(full); expect(document.body.textContent).toContain('处置明细（1 项）')
  useWorkspaceStore.setState({ tabs: [existing], activeKey: existing.key })
  await act(async () => [...document.querySelectorAll('button')].find(button => button.textContent === '正常销售')!.click())
  expect(location).toBe('/sale/new?draft=keep'); expect(useWorkspaceStore.getState().tabs).toHaveLength(1); expect(closes).toBe(1); expect(document.body.textContent).toContain('处置明细（1 项）')
  expect(document.body.textContent).not.toContain('创建报废草稿'); expect(requests.every(path => ['/warehouses/active', '/disposals/suggestions', '/products/qty-policies'].includes(path))).toBe(true)
  expect(requests).not.toContain('/products/qty-policies')
})

function rejectionDialog() { return [...document.querySelectorAll<HTMLElement>('[role="dialog"]')].find(node => node.textContent?.includes('驳回处置单'))! }
async function clickReject() { await act(async () => [...document.querySelectorAll('button')].find(button => button.textContent === '驳回')!.click()) }
async function enterReason(value: string) {
  const input = rejectionDialog().querySelector<HTMLTextAreaElement>('textarea')!
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })) })
  expect(input.value).toBe(value)
}
async function cancelReject() { await act(async () => [...rejectionDialog().querySelectorAll('button')].find(button => button.textContent === '取消')!.click()) }
it('真实详情驳回草稿按原单保留；切B空白、回A恢复并提交A准确payload', async () => {
  const submissions: { path: string; body: unknown }[] = []
  client.defaults.adapter = (async config => {
    if (config.method !== 'post' || !/^\/disposals\/(11|12)\/reject$/.test(config.url!)) throw Error(`Forbidden rejection API ${config.url}`)
    submissions.push({ path: config.url!, body: JSON.parse(config.data) })
    return { status: 200, statusText: 'OK', headers: {}, config, data: { success: true, data: null } }
  }) satisfies AxiosAdapter
  let value = detail(3), open = true
  const render = () => draw(<Detail open={open} id={value.id} initialDetail={value} onClose={() => {}} />)
  await render(); await clickReject(); await enterReason('A原单原因'); await cancelReject()
  open = false; await render(); value = { ...detail(3), id: 12, disposalNo: 'DP12' }; open = true; await render(); await clickReject()
  expect(rejectionDialog().querySelector('textarea')!.value).toBe('')
  await enterReason('B原单原因'); await cancelReject(); value = detail(3); await render(); await clickReject()
  expect(rejectionDialog().querySelector('textarea')!.value).toBe('A原单原因')
  await act(async () => [...rejectionDialog().querySelectorAll('button')].find(button => button.textContent === '确认驳回')!.click())
  expect(submissions).toEqual([{ path: '/disposals/11/reject', body: { reason: 'A原单原因' } }])
  value = { ...detail(3), id: 12, disposalNo: 'DP12' }; await render(); await clickReject()
  expect(rejectionDialog().querySelector('textarea')!.value).toBe('B原单原因')
})
it.each(['actor', 'serverABA', 'withdraw'])('驳回草稿在%s归属变化后不显示或提交旧原因，当前合法草稿单独保存', async change => {
  setApiClientBaseURL('/a')
  const submissions: { path: string; body: unknown }[] = []
  client.defaults.adapter = (async config => {
    if (config.method === 'get' && config.url === '/disposals/11') return { status: 200, statusText: 'OK', headers: {}, config, data: { success: true, data: detail(3) } }
    if (config.method !== 'post' || config.url !== '/disposals/11/reject') throw Error(`Forbidden rejection API ${config.url}`)
    submissions.push({ path: config.url!, body: JSON.parse(config.data) }); return { status: 200, statusText: 'OK', headers: {}, config, data: { success: true, data: null } }
  }) satisfies AxiosAdapter
  let value = detail(3)
  const render = () => draw(<Detail open id={11} initialDetail={value} onClose={() => {}} />)
  await render(); await clickReject(); await enterReason('旧归属原因'); await cancelReject()
  await act(async () => {
    if (change === 'actor') useAuthStore.setState(s => ({ user: { ...s.user!, id: 10 } }))
    if (change === 'serverABA') { setApiClientBaseURL('/b'); setApiClientBaseURL('/a') }
    if (change === 'withdraw') { const original = useAuthStore.getState().user!; useAuthStore.setState({ user: { ...original, permissions: [P.INVENTORY_DISPOSAL_VIEW] } }); useAuthStore.setState({ user: original }) }
  })
  value = detail(3); await render(); await clickReject()
  expect(rejectionDialog().querySelector('textarea')!.value).toBe('')
  expect([...rejectionDialog().querySelectorAll('button')].find(button => button.textContent === '确认驳回')!.disabled).toBe(true)
  expect(submissions).toEqual([])
  await enterReason('当前归属原因')
  await act(async () => [...rejectionDialog().querySelectorAll('button')].find(button => button.textContent === '确认驳回')!.click())
  expect(submissions).toEqual([{ path: '/disposals/11/reject', body: { reason: '当前归属原因' } }])
})
