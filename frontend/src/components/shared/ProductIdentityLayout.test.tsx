// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, test } from 'vitest'
import DataTable from './DataTable'
import { productIdentityColumns } from './productIdentityColumns'
let host: HTMLDivElement, root: ReturnType<typeof createRoot>
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); localStorage.clear(); host = document.createElement('div'); document.body.append(host); root = createRoot(host) })
afterEach(() => { act(() => root.unmount()); host.remove(); localStorage.clear() })
test('旧五列布局迁移到原身份位置，新商品宽度独立且业务列宽保持', () => {
  localStorage.setItem('flowcube:table-columns:product-layout', JSON.stringify({ order: ['unit', 'productCode', 'articleNumber', 'spec', 'productName', 'color', 'quantity'], widths: { unit: 94, productName: 128, quantity: 147 }, widthUnit: 'px' }))
  act(() => root.render(<DataTable columnStorageKey="product-layout" columns={[...productIdentityColumns(), { key: 'unit', title: '单位', width: 80 }, { key: 'quantity', title: '数量', width: 100 }]} data={[{ productCode: 'SKU0001', productName: '测试商品1', unit: '个', quantity: 2 }]} />))
  expect([...host.querySelectorAll('thead th')].map(cell => cell.textContent)).toEqual(['单位', '商品', '数量'])
  expect([...host.querySelectorAll('col')].map(col => col.style.width)).toEqual(['94px', '360px', '147px'])
  expect(host.querySelectorAll('tbody td')[1].textContent).toBe('SKU0001测试商品1')
})
