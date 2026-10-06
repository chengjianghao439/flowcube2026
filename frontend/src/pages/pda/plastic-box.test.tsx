// @vitest-environment jsdom
import { act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { InternalAxiosRequestConfig } from 'axios'
import api, { setApiClientBaseURL } from '@/api/client'
import { useAuthStore } from '@/store/authStore'
import { PERMISSIONS } from '@/lib/permission-codes'
import type { User } from '@/types'
import PdaPlasticBoxPage from './plastic-box'
import PdaSplitRecoveryPage from './split-recovery'
import PdaWorkbench from './index'
import PdaFillPage from './fill'
vi.mock('@/hooks/useNetworkStatus', () => ({ useNetworkStatus: () => 'online' }))
vi.mock('@/hooks/usePdaTodoCounts', () => ({ usePdaTodoCounts: () => ({ data: {} }) }))
vi.mock('@/lib/toast', () => ({ toast: { error: vi.fn(), warning: vi.fn(), success: vi.fn() } }))
vi.mock('@/lib/pdaDeviceBinding', () => ({ getDeviceCredential: () => ({ deviceCode: 'offline-device' }), getDeviceSession: () => ({ token: 'offline-ticket' }) }))
const scans = new Set<(barcode: string) => void>()
vi.mock('@/components/pda/PdaScanner', () => ({ default: function OfflineScanner({ onScan, disabled }: { onScan: (code: string) => void; disabled?: boolean }) {
  useEffect(() => { scans.add(onScan); return () => { scans.delete(onScan) } }, [onScan])
  return <button disabled={disabled} onClick={() => onScan('I11')}>测试扫码</button>
} }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let root: Root, host: HTMLDivElement, qc: QueryClient, owner = 78900
let postResult: (() => Promise<unknown>) | null
const originalAdapter = api.defaults.adapter
const requests: InternalAxiosRequestConfig[] = []
const body = { qty: 3, printLabel: true, remark: '原载荷', targetContainerId: 12 }
const key = () => `flowcube_pda_split_v1:${owner}`
const seed = () => localStorage.setItem(key(), JSON.stringify({ version: 1, records: [{ accountId: owner, endpoint: 'https://plastic.invalid/api', sourceContainerId: 11, sourceBarcode: 'I11', productId: 3, warehouseId: 8, remaining: 10, action: 'inventory.container.split.11', requestKey: 'original-key', createdAt: new Date().toISOString(), body }] }))
beforeEach(() => {
  owner++; localStorage.clear(); requests.length = 0; scans.clear(); postResult = null
  setApiClientBaseURL('https://plastic.invalid/api')
  useAuthStore.getState().login('offline', null, { id: owner, roleId: 5, username: 'offline', permissions: [PERMISSIONS.INVENTORY_VIEW, PERMISSIONS.INVENTORY_CONTAINER_SPLIT] } as User)
  api.defaults.adapter = async config => {
    requests.push(config); let data: unknown
    if (config.url?.startsWith('/inventory/containers/barcode/')) { const box = config.url.endsWith('B12'); data = { containerId: box ? 12 : 11, barcode: box ? 'B12' : 'I11', containerKind: box ? 'plastic_box' : 'inventory', containerStatus: 'stored', productId: 3, warehouseId: 8, productName: '离线商品', productCode: 'P3', remainingQty: 10 } }
    else if (config.url?.startsWith('/system/request-status/')) data = { status: 'not_found', data: null }
    else if (config.method === 'post') data = postResult ? await postResult() : { ...body }
    else throw new Error(`禁止未stub网络端点 ${config.url}`)
    return { data: { success: true, data }, status: 200, statusText: 'OK', headers: {}, config }
  }
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } }); host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); qc.clear(); host.remove(); api.defaults.adapter = originalAdapter; useAuthStore.getState().logout(); vi.restoreAllMocks() })
const visible = (e: Element) => !e.closest('[hidden]')
async function draw(page = <PdaPlasticBoxPage />) { await act(async () => root.render(<QueryClientProvider client={qc}><MemoryRouter>{page}</MemoryRouter></QueryClientProvider>)) }
async function click(label: string) { const b = [...host.querySelectorAll('button')].find(b => visible(b) && b.textContent?.startsWith(label)); expect(b, label).toBeTruthy(); await act(async () => { b!.click() }) }
async function scan(code: string) { await act(async () => { for (const callback of [...scans]) callback(code); await new Promise(resolve => setTimeout(resolve, 10)) }) }
async function setQty(value: string) { const input = [...host.querySelectorAll<HTMLInputElement>('input[type="number"]')].find(visible)!; await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })) }) }
test('三动作固定方向，返回选择/切换保留实际实例输入；隐藏广播只发当前一次GET', async () => {
  await draw(); expect(scans.size).toBe(0); expect(requests).toHaveLength(0)
  await click('盒还原整件'); await click('← 返回'); await click('整件拆出散件盒')
  await scan('B12'); expect(host.querySelector('input[type="number"]')).toBeNull(); expect(host.textContent).toContain('须扫整件库存I码')
  const before = requests.length; await scan('I11'); expect(requests).toHaveLength(before + 1)
  const input = [...host.querySelectorAll<HTMLInputElement>('input[type="number"]')].find(visible)!; await setQty('3')
  const checkbox = [...host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find(visible)!; act(() => checkbox.click())
  await click('← 返回'); expect(host.textContent).toContain('原动作的输入和待确认记录已保留')
  await click('盒还原整件'); await scan('I11'); expect([...host.querySelectorAll('input')].filter(visible)).toHaveLength(0)
  await click('← 返回'); await click('整件拆出散件盒')
  expect([...host.querySelectorAll<HTMLInputElement>('input[type="number"]')].find(visible)).toBe(input); expect(input.value).toBe('3'); expect(checkbox.checked).toBe(true)
  expect(requests.filter(r => r.method === 'post')).toHaveLength(0)
})
test('放入盒保留整件全量与expectedQty；未完成的来源输入切换后仍是同来源', async () => {
  await draw(); await click('整件放入盒'); await scan('I11'); await click('← 返回'); await click('整件放入盒')
  expect(host.textContent).toContain('I11'); await scan('B12'); await click('确认放货')
  const submitted = requests.find(r => r.method === 'post')!
  expect(submitted.url).toBe('/plastic-boxes/12/fill'); expect(JSON.parse(submitted.data)).toEqual({ sourceContainerId: 11, expectedSourceQty: 10 })
})
test('旧fill深链无需外部render即隔离A→B→A后的原来源，不能沿旧输入提交', async () => {
  await draw(<PdaFillPage />); await scan('I11')
  act(() => { setApiClientBaseURL('https://plastic-b.invalid/api'); setApiClientBaseURL('https://plastic.invalid/api') })
  expect([...host.querySelectorAll('p')].filter(visible).map(p => p.textContent).join(' ')).toContain('账号、服务器或权限已变')
  expect([...host.querySelectorAll('button')].filter(visible).some(b => b.textContent === '测试扫码')).toBe(false)
  await scan('B12'); expect(requests.filter(r => r.method === 'post')).toHaveLength(0)
})
test('隐藏的放货实例不消费迟到成功或自动核对；回原实例后原回执继续可见', async () => {
  let resolve!: (data: unknown) => void
  postResult = () => new Promise(r => { resolve = r })
  await draw(); await click('整件放入盒'); await scan('I11'); await scan('B12')
  act(() => [...host.querySelectorAll('button')].find(b => visible(b) && b.textContent === '确认放货')!.click())
  await act(async () => { await new Promise(r => setTimeout(r, 10)) }); await click('← 返回')
  await act(async () => { resolve({ sourceBarcode: 'I11', targetBarcode: 'B12', targetQtyAfter: 10 }); await new Promise(r => setTimeout(r, 10)) })
  expect(requests.filter(r => r.url?.startsWith('/system/request-status/'))).toHaveLength(0)
  expect(host.textContent).not.toContain('已放入 I11'); await click('整件放入盒')
  expect(host.textContent).toContain('I11'); expect(host.textContent).toContain('B12')
  expect(requests.filter(r => r.method === 'post')).toHaveLength(1)
})
test('本人原拆分恢复入口撤写权仍可查；无扫码/普通表单，retry双守当前权限与完整原body', async () => {
  seed(); act(() => useAuthStore.getState().updateUser({ permissions: [] })); await draw(<PdaSplitRecoveryPage />)
  expect(scans.size).toBe(0); expect(host.querySelector('input')).toBeNull(); expect(requests).toHaveLength(0)
  await click('查询原拆分结果'); expect(requests.at(-1)?.headers.get('X-Client')).toBe('pda')
  expect(host.textContent).not.toContain('按原内容重试')
  act(() => useAuthStore.getState().updateUser({ permissions: [PERMISSIONS.INVENTORY_CONTAINER_SPLIT] })); await click('查询原拆分结果'); await click('按原内容重试')
  const submitted = requests.find(r => r.method === 'post')!
  expect(submitted.headers.get('X-Request-Key')).toBe('original-key'); expect(JSON.parse(submitted.data)).toEqual(body)
})
test('首页一个塑料盒入口；无SPLIT仅当前账号/原服务器有记录时显示独立核对入口', async () => {
  await draw(<PdaWorkbench />); await click('更多功能'); expect([...host.querySelectorAll('button')].filter(b => b.textContent?.includes('塑料盒作业'))).toHaveLength(1); expect(host.textContent).not.toContain('塑料盒放货')
  seed(); act(() => useAuthStore.getState().updateUser({ permissions: [] })); await draw(<PdaSplitRecoveryPage />); await draw(<PdaWorkbench />)
  expect(host.textContent).toContain('拆分结果待确认'); expect(host.textContent).not.toContain('塑料盒作业')
  act(() => setApiClientBaseURL('https://other.invalid/api')); expect(host.textContent).not.toContain('拆分结果待确认')
})
test('已持久化的未决拆分可返回工作台，核对入口仍可见且不封锁库存查询', async () => {
  seed()
  await act(async () => root.render(<QueryClientProvider client={qc}><MemoryRouter initialEntries={['/pda/plastic-box']}><Routes><Route path="/pda/plastic-box" element={<PdaPlasticBoxPage />} /><Route path="/pda" element={<PdaWorkbench />} /></Routes></MemoryRouter></QueryClientProvider>))
  await click('← 返回')
  expect([...host.querySelectorAll('button')].some(b => b.textContent?.startsWith('拆分结果待确认'))).toBe(true)
  expect(localStorage.getItem(key())).toBeTruthy(); await click('更多功能')
  expect(host.textContent).toContain('库存查询'); expect(requests.filter(r => r.method === 'post')).toHaveLength(0)
})
