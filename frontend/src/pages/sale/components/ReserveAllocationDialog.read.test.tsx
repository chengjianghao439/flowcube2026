// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AxiosError, type AxiosAdapter } from 'axios'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import client from '@/api/client'
import ReserveAllocationDialog from './ReserveAllocationDialog'
import type { ReservePreview } from '@/types/sale'

vi.mock('@/hooks/useProductQtyPolicies', () => ({ useProductQtyPolicies: () => () => true }))
vi.mock('@/components/shared/WarehouseSelect', () => ({ WarehouseSelect: (props: { id?: string; value: number; disabled?: boolean; onChange: (id: number, name: string) => void }) => <select id={props.id} disabled={props.disabled} value={props.value} onChange={e => props.onChange(Number(e.target.value), '合成仓库')}><option value={1}>合成仓库</option><option value={2}>第二仓库</option></select> }))
const preview: ReservePreview = { orderId: 7, warehouseId: 1, warehouseName: '合成仓库', items: [{ itemId: 17, productId: 27, productCode: 'SYNTHETIC-P', productName: '合成商品', unit: '个', quantity: 2, reservedQty: 0, remainToReserve: 2, currentWarehouseId: 1, currentWarehouseName: '合成仓库', warehouses: [{ warehouseId: 1, warehouseName: '合成仓库', available: 2 }, { warehouseId: 2, warehouseName: '第二仓库', available: 2 }] }] }
let host: HTMLDivElement, root: Root, qc: QueryClient, originalAdapter: typeof client.defaults.adapter, reads: string[]
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); reads = []; originalAdapter = client.defaults.adapter
  qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); qc.clear(); client.defaults.adapter = originalAdapter; host.remove() })
async function mount() { await act(async () => root.render(<QueryClientProvider client={qc}><ReserveAllocationDialog open orderId={7} onClose={vi.fn()} onShortage={vi.fn()} /></QueryClientProvider>)) }
const button = (name: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent?.trim() === name)!
function validateRead(config: Parameters<AxiosAdapter>[0]) { expect(config.method).toBe('get'); expect(config.url).toBe('/sale/7/reserve-preview'); reads.push(String(config.url)) }
function success(config: Parameters<AxiosAdapter>[0], data = preview) { return { status: 200, statusText: 'OK', headers: {}, config, data: { success: true, data } } }
async function flush() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 15)) }) }

test('预览失败显示真实错误/重试，不冒充空表与0量，不提供可写来源；重试走原GET', async () => {
  let fail = true
  client.defaults.adapter = (async config => { validateRead(config); if (fail) throw new AxiosError('本批占库预览读取中断', 'ERR_NETWORK', config); return success(config) }) satisfies AxiosAdapter
  await mount(); await flush()
  expect(document.body.textContent).toContain('加载失败')
  // 真实 API client 将 ERR_NETWORK 统一为现行员工可读错误。
  expect(document.body.textContent).toContain('无法连接服务器')
  expect(document.body.textContent).not.toContain('没有可占用库存的商品明细')
  expect(document.body.textContent).not.toContain('0 行')
  expect(document.querySelector('[role="dialog"] table')).toBeNull()
  expect(button('确认占用（0 项）').disabled).toBe(true)
  fail = false; await act(async () => button('重试').click()); await flush()
  expect(reads).toEqual(['/sale/7/reserve-preview', '/sale/7/reserve-preview'])
  expect(document.body.textContent).not.toContain('加载失败')
  expect(document.querySelector<HTMLInputElement>('input[type="number"]')?.value).toBe('2')
  expect(button('确认占用（1 项）').disabled).toBe(false)
})

test('缓存读取失败封住表格，重试成功后保留原数量/仓库选择并按新来源校验', async () => {
  qc.setQueryData(['sale-reserve-preview', 7], preview)
  let reject!: (e: Error) => void, retry = false
  client.defaults.adapter = (async config => { validateRead(config); if (!retry) return await new Promise((_resolve, fail) => { reject = fail }); return success(config, { ...preview, items: preview.items.map(i => ({ ...i, warehouses: i.warehouses.map(w => ({ ...w, available: 1 })) })) }) }) satisfies AxiosAdapter
  await mount()
  await act(async () => {
    const qty = document.querySelector<HTMLInputElement>('input[type="number"]')!
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(qty, '1.25'); qty.dispatchEvent(new Event('input', { bubbles: true }))
    const warehouse = document.querySelector<HTMLSelectElement>('select')!; warehouse.value = '2'; warehouse.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await act(async () => reject(new AxiosError('本批刷新失败', 'ERR_NETWORK'))); await flush()
  expect(document.body.textContent).toContain('加载失败')
  expect(document.querySelector('[role="dialog"] table')).toBeNull()
  retry = true; await act(async () => button('重试').click()); await flush()
  expect(document.querySelector<HTMLInputElement>('input[type="number"]')!.value).toBe('1.25')
  expect(document.querySelector<HTMLSelectElement>('select')!.value).toBe('2')
  expect(button('确认占用（1 项）').disabled).toBe(true)
  expect(document.body.textContent).toContain('库存不足')
})

test('占库仓库标签关联这一商品行的真实选择控件', async () => {
  client.defaults.adapter = (async config => { validateRead(config); return success(config) }) satisfies AxiosAdapter
  await mount(); await flush()
  const label = [...document.querySelectorAll('label')].find(label => label.textContent?.includes('选择库存所在仓库'))
  expect(label).toBeTruthy(); expect(label!.htmlFor).not.toBe('')
  expect(document.getElementById(label!.htmlFor)).toBe(document.querySelector('select'))
})

test('首次正在读取不展示0量/空分配表', async () => {
  client.defaults.adapter = (async config => { validateRead(config); return await new Promise(() => {}) }) satisfies AxiosAdapter
  await mount()
  expect(document.body.textContent).toContain('加载商品与库存信息')
  expect(document.body.textContent).not.toContain('0 行')
  expect(document.querySelector('[role="dialog"] table')).toBeNull()
})
