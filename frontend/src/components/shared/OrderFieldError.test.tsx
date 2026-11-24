// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, test } from 'vitest'
import { OrderFieldError } from './OrderFieldError'
import { focusOrderEntryField, handleEntryKeyDown } from '@/lib/orderEntryNavigation'
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
test('普通销售单式字段提示按 id 关联，并在纠正后清除', () => {
  const host = document.body.appendChild(document.createElement('div'))
  const root = createRoot(host)
  const render = (error: string) => act(() => root.render(<OrderFieldError id="field-error">{error}</OrderFieldError>))
  try {
    render('请选择客户')
    expect(host.querySelector('#field-error[role="alert"]')?.textContent).toBe('请选择客户')
    render('')
    expect(host.querySelector('[role="alert"]')).toBeNull()
  } finally { act(() => root.unmount()); host.remove() }
})
test('Enter连续录入、Shift反向、跳过禁用控件、末行只聚焦添加，不影响IME或其他表单', () => {
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host)
 act(()=>root.render(<><div data-order-entry><input data-entry-input /></div><div data-order-entry onKeyDown={handleEntryKeyDown}><input data-entry-input aria-label="数量1" /><input data-entry-input disabled aria-label="价格1" /><input data-entry-input aria-label="数量2" /><input data-entry-input aria-label="价格2" /><button data-entry-add>添加商品</button></div></>))
 const inputs=host.querySelectorAll('input');const key=(el:HTMLElement,opts:KeyboardEventInit={})=>act(()=>el.dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,cancelable:true,key:'Enter',...opts})))
 try {inputs[1].focus();key(inputs[1]);expect(document.activeElement).toBe(inputs[3]);key(inputs[3],{shiftKey:true});expect(document.activeElement).toBe(inputs[1]);key(inputs[1],{isComposing:true});expect(document.activeElement).toBe(inputs[1]);key(inputs[1],{ctrlKey:true});expect(document.activeElement).toBe(inputs[1]);inputs[4].focus();key(inputs[4]);expect(document.activeElement).toBe(host.querySelector('button'))}finally{act(()=>root.unmount());host.remove()}
})
test('改单只读折扣仍可定位查看，不擅自开放编辑', () => {
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host)
 act(()=>root.render(<div data-order-entry><span data-entry-field="discount" tabIndex={-1}>原单折扣 10</span></div>))
 try {expect(focusOrderEntryField(host, 'discount')).toBe(true);expect(document.activeElement).toBe(host.querySelector('span'))}finally{act(()=>root.unmount());host.remove()}
})
