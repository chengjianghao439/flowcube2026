// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, expect, test, vi } from 'vitest'
import { SaleOrderHeaderFields } from './SaleOrderHeaderFields'
vi.mock('@/hooks/useWarehouses', () => ({ useWarehousesActive: () => ({ data: [] }) }))
vi.mock('@/pages/sale/components/AddressBookDialog', () => ({ default: () => null }))
let cleanup: (() => Promise<void>) | undefined
afterEach(async () => { await cleanup?.() })
test('多标签同时保留承运商发货产品字段时，标签对应各自实例', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host)
  cleanup = async () => { await act(async () => root.unmount()); host.remove() }
  const change = vi.fn()
  const fields = ['sf', 'deppon'].map((platform, index) => <SaleOrderHeaderFields key={platform} customerId="" customerName="" customerError={false} setCustomerFinderOpen={change} warehouseId="" setWarehouseId={change} setWarehouseName={change} warehouseError={false} setWarehouseError={change} carrierId={String(index + 1)} setCarrierId={change} carrierOptions={[{ id: index + 1, name: '合成承运商', code: platform, platformCode: platform }]} shippingProduct="" setShippingProduct={change} freightType="" setFreightType={change} receiverName="" setReceiverName={change} receiverPhone="" setReceiverPhone={change} receiverAddress="" setReceiverAddress={change} remark="" setRemark={change} />)
  await act(async () => root.render(<MemoryRouter>{fields}</MemoryRouter>))
  const labels = [...host.querySelectorAll('label')].filter(node => node.textContent === '本单发货产品')
  expect(labels).toHaveLength(2)
  expect(new Set(labels.map(label => label.htmlFor)).size).toBe(2)
  for (const label of labels) expect(document.getElementById(label.htmlFor)?.parentElement).toBe(label.parentElement)
})
test('销售表头的每个可见字段标签对应具体控件，选择器不依靠占位文字充当名称', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host)
  cleanup = async () => { await act(async () => root.unmount()); host.remove() }
  const change = vi.fn()
  await act(async () => root.render(<MemoryRouter><SaleOrderHeaderFields customerId="" customerName="" customerError={false} setCustomerFinderOpen={change} warehouseId="" setWarehouseId={change} setWarehouseName={change} warehouseError={false} setWarehouseError={change} carrierId="" setCarrierId={change} carrierOptions={[]} shippingProduct="" setShippingProduct={change} freightType="" setFreightType={change} receiverName="" setReceiverName={change} receiverPhone="" setReceiverPhone={change} receiverAddress="" setReceiverAddress={change} remark="" setRemark={change} /></MemoryRouter>))
  for (const name of ['客户', '出库仓库', '承运商', '运费方式', '收货人', '联系电话', '收货地址', '备注']) {
    const label = [...host.querySelectorAll('label')].find(node => node.textContent?.includes(name))!
    expect(label, name).toBeDefined(); expect(label.htmlFor, name).not.toBe('')
    expect(host.querySelector(`[id="${label.htmlFor}"]`), name).not.toBeNull()
  }
})
