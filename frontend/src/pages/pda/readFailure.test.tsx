// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AxiosError, type AxiosAdapter } from 'axios'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import client from '@/api/client'
import Receive from './receive'
import TransferOut from './transfer-out'
import TransferIn from './transfer-in'
import ReturnReceive from './sale-return-receive'
import ReturnPutaway from './sale-return-putaway'
import Stockcheck from './stockcheck'
import Sort from './sort'
import Task from './task'
import Pack from './pack'

const scenario = vi.hoisted(() => ({ pendingPack: false, pendingTransfer: false }))
// 本组只验证真实查询失败后的页面，不发离线写入或恢复请求。
vi.mock('@/hooks/usePendingRequests', () => ({ usePendingRequests: () => ({ records: [], addPending: vi.fn(), claimPending: vi.fn(() => true), removePending: vi.fn() }) }))
vi.mock('@/hooks/useOfflineScan', () => ({ useOfflineScan: () => ({ submitScan: vi.fn(), logError: vi.fn(), logUndo: vi.fn() }) }))
vi.mock('@/hooks/useCriticalPdaAction', () => ({ useCriticalPdaAction: (options: { action?: string }) => {
  const pending = (scenario.pendingPack && options.action === 'package.add') || (scenario.pendingTransfer && options.action?.startsWith('transfer.scan'))
  return { networkStatus: 'online', submitBlocked: pending, blockedReason: pending ? '上次装箱结果待确认' : null, pendingRecord: pending ? { action: 'package.add', requestKey: 'original-request-key', label: '装箱', metadata: { taskId: 7, packageId: 17 } } : null, confirming: false, phase: pending ? 'unconfirmed' : 'idle', phaseMessage: null, lastErrorMessage: null, run: vi.fn(), confirmPending: vi.fn(), clearPending: vi.fn(), clearError: vi.fn() }
} }))

let host: HTMLDivElement
let root: Root
let qc: QueryClient
let originalAdapter: typeof client.defaults.adapter
let reads: string[]

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  reads = []
  scenario.pendingPack = false
  scenario.pendingTransfer = false
  originalAdapter = client.defaults.adapter
  client.defaults.adapter = (async config => {
    expect(config.method).toBe('get')
    reads.push(String(config.url))
    throw new AxiosError('本批模拟读取中断', 'ERR_NETWORK', config)
  }) satisfies AxiosAdapter
  qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

test('打包读取失败仍保留原装箱待确认入口', async () => {
  scenario.pendingPack = true
  await act(async () => { root.render(<QueryClientProvider client={qc}><MemoryRouter initialEntries={['/pda/pack/7']}><Routes><Route path="/pda/pack/:id" element={<Pack />} /></Routes></MemoryRouter></QueryClientProvider>) })
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)) })
  expect(host.textContent).toContain('加载失败')
  expect(host.textContent).toContain('上次装箱结果待确认')
  expect(host.textContent).toContain('确认上次结果')
})

test('箱子读取失败不能当成零箱，创建入口冻结', async () => {
  client.defaults.adapter = (async config => {
    expect(config.method).toBe('get')
    if (config.url === '/warehouse-tasks/7') return { status: 200, statusText: 'OK', headers: {}, config, data: { success: true, data: { id: 7, taskNo: 'SYNTHETIC-TASK', status: 5, statusName: '待打包', items: [] } } }
    throw new AxiosError('箱子读取中断', 'ERR_NETWORK', config)
  }) satisfies AxiosAdapter
  await act(async () => { root.render(<QueryClientProvider client={qc}><MemoryRouter initialEntries={['/pda/pack/7']}><Routes><Route path="/pda/pack/:id" element={<Pack />} /></Routes></MemoryRouter></QueryClientProvider>) })
  for (let i = 0; i < 3; i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)) })
  expect(host.textContent).toContain('加载失败')
  expect(host.textContent).not.toContain('点击下方「新建箱子」开始打包')
  const create = [...host.querySelectorAll('button')].find(button => button.textContent?.includes('新建箱子'))!
  expect(create.disabled).toBe(true)
  expect(host.textContent).toContain('箱子暂不可读取')
})

test.each([
  ['/pda/transfer-out/:id', '/pda/transfer-out/7', TransferOut],
  ['/pda/transfer-in/:id', '/pda/transfer-in/7', TransferIn],
] as const)('调拨详情读取失败保留原请求核对入口：%s', async (path, entry, Page) => {
  scenario.pendingTransfer = true
  await act(async () => { root.render(<QueryClientProvider client={qc}><MemoryRouter initialEntries={[entry]}><Routes><Route path={path} element={<Page />} /></Routes></MemoryRouter></QueryClientProvider>) })
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)) })
  expect(host.textContent).toContain('加载失败')
  expect(host.textContent).toContain('确认上次结果')
})

test('收货后台读取失败保留当前数量输入且暂停登记', async () => {
  qc.setQueryData(['pda-inbound-task', 7], { id: 7, taskNo: 'SYNTHETIC-INBOUND', submittedAt: '2026-10-08T08:00:00+08:00', status: 2, statusName: '收货中', receiptStatus: { key: 'receiving', label: '收货中' }, printStatus: { key: 'queued', label: '待派发' }, putawayStatus: { key: 'not_started', label: '未开始' }, printSummary: {}, putawaySummary: {}, items: [{ id: 17, productId: 27, productCode: 'SYNTHETIC-P', productName: '合成商品', unit: '个', orderedQty: 2, receivedQty: 0, purchaseOrderNo: 'SYNTHETIC-PC' }] })
  await act(async () => { root.render(<QueryClientProvider client={qc}><MemoryRouter initialEntries={['/pda/receive/7']}><Routes><Route path="/pda/receive/:id" element={<Receive />} /></Routes></MemoryRouter></QueryClientProvider>) })
  const input = host.querySelector<HTMLInputElement>('input[aria-label="箱 1 数量"]')!
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '1'); input.dispatchEvent(new Event('input', { bubbles: true })); await new Promise(resolve => setTimeout(resolve, 30)) })
  expect(host.textContent).toContain('加载失败')
  expect(input.value).toBe('1')
  const submit = [...host.querySelectorAll('button')].find(button => button.textContent?.includes('打印并登记'))!
  expect(submit.disabled).toBe(true)
  expect(host.textContent).not.toContain('提交中…')
})

afterEach(async () => {
  await act(async () => { root.unmount(); qc.clear() })
  host.remove()
  client.defaults.adapter = originalAdapter
})

test.each([
  ['收货', '/pda/receive/:id', '/pda/receive/7', Receive],
  ['调出', '/pda/transfer-out/:id', '/pda/transfer-out/7', TransferOut],
  ['调入', '/pda/transfer-in/:id', '/pda/transfer-in/7', TransferIn],
  ['退货收货', '/pda/sale-return/:id/receive', '/pda/sale-return/7/receive', ReturnReceive],
  ['退货上架', '/pda/sale-return/:id/putaway', '/pda/sale-return/7/putaway', ReturnPutaway],
  ['盘点详情', '/pda/stockcheck/:id', '/pda/stockcheck/7', Stockcheck],
  ['分拣格', '/pda/sort', '/pda/sort', Sort],
  ['拣货详情', '/pda/task/:id', '/pda/task/7', Task],
  ['打包详情', '/pda/pack/:id', '/pda/pack/7', Pack],
] as const)('%s 读取中断显示重试，不能宣称不存在或空数据', async (_name, path, entry, Page) => {
  await act(async () => { root.render(<QueryClientProvider client={qc}><MemoryRouter initialEntries={[entry]}><Routes><Route path={path} element={<Page />} /></Routes></MemoryRouter></QueryClientProvider>) })
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)) })
  expect(reads.length).toBeGreaterThan(0)
  expect(host.textContent).toContain('加载失败')
  expect(host.textContent).not.toMatch(/不存在|暂无分拣格|新建箱子.*开始打包|任务状态：…/)
  const retry = [...host.querySelectorAll('button')].find(button => button.textContent === '重试')!
  expect(retry).toBeTruthy()
  const count = reads.length
  await act(async () => { retry.click(); await new Promise(resolve => setTimeout(resolve, 30)) })
  expect(reads.length).toBeGreaterThan(count)
})
