// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, test, vi } from 'vitest'
import { getByRole, queryByRole } from '@testing-library/dom'
import CategoryTreeSelect from './CategoryTreeSelect'

vi.mock('@/hooks/useCategories', () => ({ useCategoryTree: () => ({ data: [{ id: 1, name: '五金', status: 1, children: [{ id: 11, name: '缓冲铰链', status: 1 }] }] }) }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const host = document.createElement('div')
let root: ReturnType<typeof createRoot>
afterEach(() => { act(() => root.unmount()); host.remove() })

test('分类父节点明确展开状态且不提交，叶节点选择保留原分类ID', () => {
  document.body.append(host); root = createRoot(host)
  const change = vi.fn()
  act(() => root.render(<CategoryTreeSelect value={null} onChange={change} />))
  act(() => {
    const trigger = getByRole(host, 'button', { name: '请选择分类' })
    trigger.focus()
    trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  })
  const parent = getByRole(document.body, 'button', { name: '五金', expanded: false })
  expect(queryByRole(document.body, 'button', { name: '缓冲铰链' })).toBeNull()
  act(() => parent.click())
  expect(getByRole(document.body, 'button', { name: '五金', expanded: true })).toBe(parent)
  expect(change).not.toHaveBeenCalled()
  act(() => getByRole(document.body, 'button', { name: '缓冲铰链' }).click())
  expect(change).toHaveBeenCalledExactlyOnceWith(11)
})
