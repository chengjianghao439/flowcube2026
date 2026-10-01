// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, afterEach, expect, test, vi } from 'vitest'
import { FulfillmentTodos } from './FulfillmentTodos'
import type { FulfillmentIssue } from '@/api/fulfillment'
import { PERMISSIONS } from '@/lib/permission-codes'
const state = vi.hoisted(() => ({ rows: [] as FulfillmentIssue[], purchase: true, credit: false, print: true }))
vi.mock('@/hooks/usePermission', () => ({ usePermission: () => ({ can: (code: string) => code === PERMISSIONS.PURCHASE_ORDER_VIEW ? state.purchase : code === PERMISSIONS.SALE_CREDIT_OVERRIDE_VIEW ? state.credit : code === PERMISSIONS.PRINT_JOB_VIEW ? state.print : true }) }))
vi.mock('@/api/fulfillment', () => ({ getFulfillmentIssues: () => Promise.resolve({ list: state.rows, pagination: { total: state.rows.length }, summary: { mine: 0, unassigned: 0, overdue: 0 } }) }))
let root: Root, host: HTMLDivElement, qc: QueryClient
const issue = (key: string, patch: Partial<FulfillmentIssue> = {}): FulfillmentIssue => ({ id: 1, document_type: 'sale', document_id: 123, documentNo: 'XS-123', source: 'auto', source_key: key, title: '历史标题', reason: '历史原因', action_path: 'https://evil.example', status: 'open', owner_id: null, ownerName: null, due_at: null, result: null, version: 1, overdue: 0, dueSoon: 0, ...patch })
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); state.purchase = true; state.credit = false; state.print = true; host = document.createElement('div'); document.body.append(host); root = createRoot(host); qc = new QueryClient({ defaultOptions: { queries: { retry: false } } }) })
afterEach(() => { act(() => root.unmount()); qc.clear(); host.remove(); localStorage.clear() })
async function render(row: FulfillmentIssue) { state.rows = [row]; await act(async () => root.render(<MemoryRouter><QueryClientProvider client={qc}><FulfillmentTodos /></QueryClientProvider></MemoryRouter>)); await act(async () => { await new Promise(r => setTimeout(r, 10)) }) }
const link = (text: string) => [...host.querySelectorAll('a')].find(a => a.textContent === text)
test('采购延期操作指向来源采购，关联单据仍指向原销售', async () => { await render(issue('purchase-delay:8:42')); expect(link('核对采购到货日期')?.getAttribute('href')).toBe('#/purchase/42?focus=fulfillment'); expect(link('XS-123')?.getAttribute('href')).toBe('#/sale/123?focus=fulfillment') })
test('无采购查看权留在原销售安排并说明采购核对', async () => { state.purchase = false; await render(issue('purchase-delay:8:42')); expect(link('查看发货安排')?.getAttribute('href')).toBe('#/sale/123?focus=fulfillment'); expect(host.textContent).toContain('需有采购查看权限的同事核对到货日期'); expect(host.querySelector('a[href*="/purchase/"]')).toBeNull() })
test.each([['shortage:8', '安排缺少的货源', '#/sale/123?focus=fulfillment'], ['delay:8', '核对发货日期', '#/sale/123?focus=fulfillment'], ['return:91', '查看拣货退回任务', '#/sale/123?focus=progress&taskId=91'], ['adjust:92', '查看改单确认任务', '#/sale/123?focus=progress&taskId=92']])('系统键 %s 给出准确动作', async (key, label, href) => { await render(issue(key)); expect(link(label)?.getAttribute('href')).toBe(href) })
test.each(['purchase-delay:8:42:9', 'purchase-delay:8:0', 'return:9007199254740992', 'return:91evil', 'unknown'])('未知或非法键 %s 安全回原单', async key => { await render(issue(key)); expect(link('查看原单事项')?.getAttribute('href')).toBe('#/sale/123?focus=fulfillment'); expect(host.querySelector('a[href*="evil"]')).toBeNull() })
test('人工事项不根据标题或action_path改变去向', async () => { await render(issue('return:91', { source: 'manual', title: '取消等待实物归还', action_path: '/sale/999?focus=progress&taskId=91' })); expect(link('查看原单事项')?.getAttribute('href')).toBe('#/sale/123?focus=fulfillment') })
test('已知授信入口受查看权限限制', async () => { await render(issue('credit:5')); expect(host.querySelector('a[href="#/credit-overrides"]')).toBeNull(); expect(host.textContent).toContain('需有超额放行查看权限的同事处理') })
test.each([['putaway:8', '查看待上架条码', 'waiting-putaway'], ['print:9', '查看打印记录', 'print']])('收货 %s 只提供PC查看入口', async (key, label, focus) => { await render(issue(key, { document_type: 'inbound' })); expect(link(label)?.getAttribute('href')).toBe(focus === 'print' ? '#/settings/barcode-print-query?category=inbound&inboundTaskId=123' : `#/inbound-tasks/123?focus=${focus}`); expect(host.textContent).not.toContain('去扫码上架') })

test('没有打印查看权时回原收货进度并提示打印岗位', async () => { state.print = false; await render(issue('print:9', { document_type: 'inbound' })); expect(link('查看收货进度')?.getAttribute('href')).toBe('#/inbound-tasks/123?focus=fulfillment'); expect(host.textContent).toContain('需有打印查看权限的同事核对打印记录') })
