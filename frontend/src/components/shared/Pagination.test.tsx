// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Pagination from './Pagination'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const container = document.createElement('div')
const root = createRoot(container)
afterEach(() => act(() => root.render(null)))

describe('列表分页边界', () => {
  it('单页仍显示总数且不允许翻页', () => {
    const onPageChange = vi.fn()
    act(() => root.render(<Pagination page={1} totalPages={1} total={4} unit="个" onPageChange={onPageChange} />))
    expect(container.textContent).toContain('共 4 个')
    const buttons = container.querySelectorAll('button')
    expect(buttons).toHaveLength(2)
    expect([...buttons].every(button => button.disabled)).toBe(true)
    act(() => buttons.forEach(button => button.click()))
    expect(onPageChange).not.toHaveBeenCalled()
  })
  it('中间页按方向回传目标页，末页禁用下一页', () => {
    const onPageChange = vi.fn()
    act(() => root.render(<Pagination page={2} totalPages={3} total={51} onPageChange={onPageChange} />))
    act(() => container.querySelectorAll('button').forEach(button => button.click()))
    expect(onPageChange.mock.calls).toEqual([[1], [3]])
    act(() => root.render(<Pagination page={3} totalPages={3} total={51} onPageChange={onPageChange} />))
    expect(container.querySelectorAll('button')[1].disabled).toBe(true)
  })
  it('空结果交由列表空状态展示', () => {
    act(() => root.render(<Pagination page={1} totalPages={1} total={0} onPageChange={vi.fn()} />))
    expect(container.textContent).toBe('')
  })
})
