// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, test, vi } from 'vitest'
import { FinderTable } from './FinderTable'
let cleanup: (() => Promise<void>) | undefined
async function render() {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host), select = vi.fn(), confirm = vi.fn()
  const rows = [{ id: 1, name: '长商品名称及供应商型号保持完整' }, { id: 2, name: '第二项' }]
  await act(async () => root.render(<FinderTable columns={[{ key: 'name', title: '商品身份' }]} data={rows} selected={rows[0]} onSelect={select} onDoubleClickRow={confirm} getRowKey={row => row.id} />))
  cleanup = async () => { await act(async () => root.unmount()); host.remove() }
  return { host, rows, select, confirm }
}
afterEach(async () => { await cleanup?.(); cleanup = undefined })
test('选择结果具有合法grid、列头、单元格与选中行结构', async () => {
  const { host } = await render()
  const grid = host.querySelector('[role="grid"]')!
  expect(grid).not.toBeNull()
  expect(grid.querySelectorAll('[role="columnheader"]')).toHaveLength(1)
  expect(grid.querySelectorAll('[role="gridcell"]')).toHaveLength(2)
  expect(grid.querySelector('[aria-selected="true"]')!.textContent).toContain('长商品名称及供应商型号保持完整')
})
test('方向键移动焦点而不提交选择，Enter选择与Space确认仍沿原动作', async () => {
  const { host, rows, select, confirm } = await render()
  const first = host.querySelector<HTMLElement>('[role="row"][aria-selected]')!
  first.focus()
  await act(async () => first.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })))
  const focused = document.activeElement as HTMLElement
  expect(focused.textContent).toContain('第二项')
  expect(select).not.toHaveBeenCalled(); expect(confirm).not.toHaveBeenCalled()
  await act(async () => focused.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
  expect(select).toHaveBeenCalledWith(rows[1])
  await act(async () => focused.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true })))
  expect(confirm).toHaveBeenCalledWith(rows[1])
})
