// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { fireEvent, getByRole } from '@testing-library/dom'
import { expect, test, vi } from 'vitest'
import { getContainerByBarcodeApi, getContainerLogsApi } from '@/api/inventory'
import TracePage from './trace'

vi.mock('@/api/inventory', () => ({
  getContainerByBarcodeApi: vi.fn(),
  getContainerLogsApi: vi.fn(),
}))

test('流水读取失败保留容器并重试原条码，不把失败显示为零条或应用新输入', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.mocked(getContainerByBarcodeApi).mockResolvedValue({
    barcode: 'I-ORIGINAL', containerId: 8, productId: 12, productName: '合成商品', productCode: 'SKU12',
    warehouseId: 1, warehouseName: '合成仓', locationId: null, locationCode: null, remainingQty: 2, unit: '个',
  })
  vi.mocked(getContainerLogsApi).mockRejectedValueOnce(Error('合成流水读取失败')).mockResolvedValueOnce([])
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  try {
    await act(async () => root.render(<TracePage />))
    const input = getByRole(host, 'textbox', { name: '库存或塑料盒条码' }) as HTMLInputElement
    await act(async () => { fireEvent.input(input, { target: { value: 'I-ORIGINAL' } }) })
    await act(async () => getByRole(host, 'button', { name: '查询' }).click())
    expect(host.textContent).toContain('合成商品')
    expect(host.textContent).toContain('条码流水读取失败')
    expect(host.textContent).not.toContain('条码流水（0 条）')
    expect(host.textContent).not.toContain('该条码暂无流水记录')

    await act(async () => { fireEvent.input(input, { target: { value: 'B-DRAFT' } }) })
    await act(async () => getByRole(host, 'button', { name: '重试' }).click())
    expect(vi.mocked(getContainerByBarcodeApi).mock.calls).toEqual([['I-ORIGINAL'], ['I-ORIGINAL']])
    expect(getContainerLogsApi).toHaveBeenCalledTimes(2)
    expect(host.textContent).toContain('条码流水（0 条）')
    expect(input.value).toBe('B-DRAFT')
  } finally {
    await act(async () => root.unmount())
    host.remove()
  }
})
