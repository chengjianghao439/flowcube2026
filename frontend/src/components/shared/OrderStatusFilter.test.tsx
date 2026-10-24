// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { OrderStatusFilter } from './OrderStatusFilter'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
afterEach(() => document.body.replaceChildren())
it('保留筛选值和选中语义，未提供计数时不伪造数量', () => {
  const host = document.createElement('div')
  const root = createRoot(host)
  const onChange = vi.fn()
  act(() => root.render(<OrderStatusFilter label="采购状态分类" value="1" options={[{value:'',label:'全部订单'}, {value:'1',label:'草稿'}, {value:'2',label:'已提交',count:0}]} onChange={onChange} />))
  const buttons = host.querySelectorAll('button')
  expect(buttons[1].getAttribute('aria-checked')).toBe('true')
  expect(buttons[1].textContent).toBe('草稿')
  expect(buttons[2].textContent).toBe('已提交0')
  act(() => buttons[0].click())
  expect(onChange).toHaveBeenCalledWith('')
  act(() => root.unmount())
})

it('方向键移动焦点而不提前查询，确认后保留原筛选值，全部订单仍是空字符串', async () => {
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host)
  const onChange = vi.fn()
  const user = userEvent.setup()
  act(() => root.render(<OrderStatusFilter label="销售状态分类" value="" options={[{ value: '', label: '全部订单' }, { value: '1', label: '草稿' }, { value: '2', label: '待发货' }]} onChange={onChange} />))
  const buttons = host.querySelectorAll<HTMLButtonElement>('button')
  act(() => buttons[0].focus())
  await act(async () => { await user.keyboard('{ArrowRight}') })
  expect(document.activeElement).toBe(buttons[1])
  expect(onChange).not.toHaveBeenCalled()
  await act(async () => { await user.keyboard('{Enter}') })
  expect(onChange).toHaveBeenLastCalledWith('1')
  await act(async () => { await user.click(buttons[0]) })
  expect(onChange).toHaveBeenLastCalledWith('')
  expect(buttons[0].getAttribute('aria-checked')).toBe('true')
  act(() => root.unmount())
})
