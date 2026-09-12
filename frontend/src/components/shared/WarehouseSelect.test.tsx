// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { WarehouseSelect } from './WarehouseSelect'
vi.mock('@/hooks/useWarehouses', () => ({ useWarehousesActive: () => ({ data: [{ id: 1, name: '北京主仓' }] }) }))
let host: HTMLDivElement, root: ReturnType<typeof createRoot>
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); host = document.createElement('div'); document.body.append(host); root = createRoot(host) })
afterEach(async () => { await act(async () => root.unmount()); host.remove() })
test('必选仓库未选择时显示提示，已有值清空后恢复提示', async () => {
  const render = async (value: number | null) => act(async () => root.render(<WarehouseSelect value={value} onChange={() => {}} placeholder="选择仓库" />))
  await render(null); expect(host.querySelector('[role="combobox"]')!.textContent).toContain('选择仓库')
  await render(1); expect(host.querySelector('[role="combobox"]')!.textContent).toContain('北京主仓')
  await render(null); expect(host.querySelector('[role="combobox"]')!.textContent).toContain('选择仓库')
})
test('查询筛选的全部仓库选项保持原有显示', async () => {
  await act(async () => root.render(<WarehouseSelect value={null} onChange={() => {}} allowClear clearLabel="全部仓库" />))
  expect(host.querySelector('[role="combobox"]')!.textContent).toContain('全部仓库')
})
