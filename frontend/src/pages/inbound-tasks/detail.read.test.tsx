// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, expect, test, vi } from 'vitest'
import Page from './detail'
import { TabPathContext } from '@/components/layout/TabPathContext'
import type { InboundTask } from '@/types/inbound-tasks'
const fixture = vi.hoisted(() => ({ task: undefined as InboundTask | undefined, error: null as unknown, retry: vi.fn(), write: vi.fn() }))
vi.mock('@/hooks/useInboundTasks', () => ({ useInboundTaskDetail: () => ({ data: fixture.task, error: fixture.error, isLoading: false, refetch: fixture.retry }), ...Object.fromEntries(['useSubmitInboundTask', 'useCancelInbound', 'useVoidInboundReceipt'].map(name => [name, () => ({ mutate: fixture.write })])) }))
vi.mock('@/hooks/usePermission', () => ({ usePermission: () => ({ can: () => true }) }))
vi.mock('@/hooks/useWorkspaceTabTitle', () => ({ useWorkspaceTabTitle: () => {} }))
vi.mock('@/hooks/useActiveWorkspaceTab', () => ({ useActiveWorkspaceTab: () => true }))
vi.mock('@/components/shared/OrderDetailSections', () => ({ OrderDetailSections: ({ children }: { children: React.ReactNode }) => <>{children}</> }))
vi.mock('./CloseReceivingDialog', () => ({ default: () => null }))
vi.mock('@/components/print/OrderPrintOverlay', () => ({ OrderPrintOverlay: () => null }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let cleanup: (() => Promise<void>) | undefined
afterEach(async () => { await cleanup?.(); fixture.task = undefined; fixture.error = null; expect(fixture.write).not.toHaveBeenCalled() })
async function setup() {
 const host = document.createElement('div'); document.body.append(host); const root = createRoot(host)
 const draw = () => act(async () => root.render(<MemoryRouter><TabPathContext.Provider value="/inbound-tasks/21"><Page /></TabPathContext.Provider></MemoryRouter>))
 cleanup = async () => { await act(async () => root.unmount()); host.remove() }; await draw(); return { host, draw }
}
test.each([[403, '无权查看'], [404, '不存在或已删除'], [503, '读取失败']])('详情%s结束加载并提供重试/返回；恢复可读', async (status, title) => {
 fixture.error = { status, response: { data: { message: '受控错误' } } }; const ui = await setup()
 expect(ui.host.textContent).toContain(title); expect(ui.host.textContent).not.toContain('加载中')
 expect([...ui.host.querySelectorAll('button')].some(button => button.textContent === '重试')).toBe(true)
 fixture.error = null; fixture.task = { id: 21, taskNo: '恢复单', status: 2, statusName: '收货中', items: [] } as unknown as InboundTask
 await ui.draw(); expect(ui.host.textContent).toContain('恢复单')
})
test('旧数据临时失败明确标记且暂停写操作；403/404隐藏旧敏感数据', async () => {
 fixture.task = { id: 21, taskNo: '旧收货单', status: 2, statusName: '收货中', items: [] } as unknown as InboundTask
 const ui = await setup(); fixture.error = { status: 503 }; await ui.draw()
 expect(ui.host.textContent).toContain('刷新失败，当前显示上次读取的数据'); expect(ui.host.textContent).toContain('旧收货单'); expect(ui.host.textContent).not.toContain('结束收货')
 for (const status of [403, 404]) { fixture.error = { status }; await ui.draw(); expect(ui.host.textContent).not.toContain('旧收货单') }
})
