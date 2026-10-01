// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query'
import { beforeEach, afterEach, test, vi, expect } from 'vitest'
import { TabPathContext } from '@/components/layout/TabPathContext'
import { buildWorkspaceTabRegistration } from '@/router/workspaceRouteMeta'
import { SectionVisibilityContext } from '@/components/layout/SectionVisibilityContext'
import type { SaleOrder, SaleOrderTask } from '@/types/sale'
import { getSaleDetailApi } from '@/api/sale'
import SaleFormPage from './index'
vi.mock('@/api/sale', async original => ({ ...await original<typeof import('@/api/sale')>(), getSaleDetailApi: vi.fn() }))
vi.mock('@/hooks/usePermission', () => ({ usePermission: () => ({ can: () => false }) }))
let root: Root, host: HTMLDivElement, qc: QueryClient
const task = (id: number, patch: Partial<SaleOrderTask> = {}): SaleOrderTask => ({ taskId: id, taskNo: `WT-${id}`, warehouseId: id, warehouseName: `仓库${id}`, status: 2, statusName: '拣货中', sortingBinId: null, cancelRequestedAt: '2026-10-01', ...patch })
const order = (tasks = [task(91)]): SaleOrder => ({ id: 12, orderNo: 'XS-12', customerId: 1, customerName: '示例客户', warehouseId: 1, warehouseName: '示例仓库', status: 3, statusName: '执行中', totalAmount: 0, operatorId: 1, operatorName: '经办人', createdAt: '2026-10-01', items: [], tasks, taskNo: tasks[0]?.taskNo, warehouseTaskStatus: tasks[0]?.status })
beforeEach(() => { onlineManager.setOnline(true); Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); vi.mocked(getSaleDetailApi).mockReset(); vi.mocked(getSaleDetailApi).mockResolvedValue(order()); host = document.createElement('div'); document.body.append(host); root = createRoot(host); qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } }); qc.setQueryData(['sale', 12], order()) })
afterEach(() => { act(() => root.unmount()); qc.clear(); host.remove(); onlineManager.setOnline(true) })
function path(search = '?focus=progress&taskId=91') { return buildWorkspaceTabRegistration('/sale/12', search).path }
async function render(tabPath = path(), active = true) { await act(async () => root.render(<MemoryRouter initialEntries={[tabPath]}><QueryClientProvider client={qc}><SectionVisibilityContext.Provider value={active}><TabPathContext.Provider value={tabPath}><SaleFormPage /></TabPathContext.Provider></SectionVisibilityContext.Provider></QueryClientProvider></MemoryRouter>)); await act(async () => { await new Promise(r => setTimeout(r, 5)) }) }
const tab = (label: string) => [...host.querySelectorAll('button[aria-pressed]')].find(b => b.textContent === label)
test('实际详情hook重新读取本单，逐仓说明逆向并定位原任务', async () => { vi.mocked(getSaleDetailApi).mockResolvedValue(order([task(91), task(92, { cancelRequestedAt: null, adjustmentRequestedAt: 'now' })])); await render(path('?focus=progress&taskId=92')); expect(getSaleDetailApi).toHaveBeenCalledWith(12); expect(tab('作业进度')?.getAttribute('aria-pressed')).toBe('true'); expect(host.querySelector('[data-reverse-task="92"]')?.getAttribute('data-handoff-target')).toBe('true'); expect(host.textContent).toContain('WT-91'); expect(host.textContent).toContain('WT-92'); expect(host.textContent).toContain('PDA → 拣货退回'); expect(host.textContent).toContain('PDA → 改单确认'); expect(host.querySelector('a[href*="/pda/"]')).toBeNull() })
test.each([[], [task(91, { status: 8 })], [task(91, { status: 7 })], [task(91, { cancelRequestedAt: null })], [task(99)]].map(tasks => [tasks]))('最新任务不存在、结束或已解除逆向标志时不伪造待归还', async tasks => { vi.mocked(getSaleDetailApi).mockResolvedValue(order(tasks)); await render(); expect(host.textContent).toContain('原任务已不在本单待处理范围内'); expect(host.querySelector('[data-handoff-target="true"]')).toBeNull() })
test.each(['?focus=progress&taskId=', '?focus=progress&taskId=91&taskId=', '?focus=progress&focus=&taskId=91', '?focus=progress&taskId=0', '?focus=progress&taskId=9007199254740992', '?focus=fulfillment&taskId=91', '?taskId=91', '?focus=progress&taskId=91%0A'])('真实注册链保留并拒绝无效交接 %s', async search => { await render(path(search)); expect(host.textContent).toContain('交接参数无效'); expect(tab('订单信息')?.getAttribute('aria-pressed')).toBe('true'); expect(host.querySelector('[data-handoff-target="true"]')).toBeNull() })
test('重读期间隐藏旧缓存逆向说明，失败后不能称为最新待处理', async () => { let reject!: (error: Error) => void; vi.mocked(getSaleDetailApi).mockImplementation(() => new Promise((_, fail) => { reject = fail })); await render(); expect(host.textContent).toContain('正在重新读取原单任务'); expect(host.textContent).not.toContain('PDA → 拣货退回'); await act(async () => reject(new Error('网络故障'))); await act(async () => { await new Promise(r => setTimeout(r, 5)) }); expect(host.textContent).toContain('原单读取失败'); expect(host.textContent).not.toContain('PDA → 拣货退回') })
test('隐藏后再进入相同交接会重读并撤去已解除的原任务提示', async () => { await render(); expect(host.textContent).toContain('PDA → 拣货退回'); await render(path(), false); vi.mocked(getSaleDetailApi).mockResolvedValue(order([task(91, { cancelRequestedAt: null })])); const before = vi.mocked(getSaleDetailApi).mock.calls.length; await render(); expect(vi.mocked(getSaleDetailApi).mock.calls.length).toBeGreaterThan(before); expect(host.textContent).toContain('原任务已不在本单待处理范围内'); expect(host.textContent).not.toContain('PDA → 拣货退回') })
test('无缓存的原单读取失败说明读取问题，不误报单据已删除', async () => { qc.removeQueries({ queryKey: ['sale', 12] }); vi.mocked(getSaleDetailApi).mockRejectedValue(new Error('网络故障')); await render(); expect(host.textContent).toContain('原单读取失败'); expect(host.textContent).not.toContain('销售单不存在或已删除') })

test('已核对的销售逆向交接再次离线暂停时撤去旧说明，恢复后显示最新结果', async () => {
  await render(); expect(host.textContent).toContain('PDA → 拣货退回')
  vi.mocked(getSaleDetailApi).mockResolvedValue(order([task(91, { cancelRequestedAt: null })]))
  onlineManager.setOnline(false)
  await act(async () => { void qc.invalidateQueries({ queryKey: ['sale', 12] }) })
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)) })
  expect(qc.getQueryState(['sale', 12])?.fetchStatus).toBe('paused')
  expect(host.textContent).toContain('网络已暂停，等待恢复后重新读取原单任务')
  expect(host.textContent).not.toContain('PDA → 拣货退回')
  await act(async () => onlineManager.setOnline(true)); await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)) })
  expect(host.textContent).toContain('原任务已不在本单待处理范围内')
  expect(host.textContent).not.toContain('PDA → 拣货退回')
})
