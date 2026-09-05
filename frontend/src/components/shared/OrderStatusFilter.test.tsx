// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { OrderStatusFilter } from './OrderStatusFilter'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
it('保留筛选值和选中语义，未提供计数时不伪造数量', () => {
  const host = document.createElement('div')
  const root = createRoot(host)
  const onChange = vi.fn()
  act(() => root.render(<OrderStatusFilter label="采购状态分类" value="1" options={[{value:'',label:'全部订单'}, {value:'1',label:'草稿'}, {value:'2',label:'已提交',count:0}]} onChange={onChange} />))
  const buttons = host.querySelectorAll('button')
  expect(buttons[1].getAttribute('aria-pressed')).toBe('true')
  expect(buttons[1].textContent).toBe('草稿')
  expect(buttons[2].textContent).toBe('已提交0')
  act(() => buttons[0].click())
  expect(onChange).toHaveBeenCalledWith('')
  act(() => root.unmount())
})
