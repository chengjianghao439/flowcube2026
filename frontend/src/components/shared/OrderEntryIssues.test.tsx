// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, test } from 'vitest'
import { OrderEntryIssues } from './OrderEntryIssues'
import { handleEntryKeyDown } from '@/lib/orderEntryNavigation'
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
test('错误定位只在当前表单内查找，修正后清空提示', () => {
 const host=document.createElement('div'); document.body.append(host); const root=createRoot(host)
 const render=(issues:{target:string;message:string}[])=>act(()=>root.render(<><div data-order-entry><input data-entry-field="party" /></div><div data-order-entry><OrderEntryIssues issues={issues} /><input data-entry-field="party" /></div></>))
 try { render([{target:'party',message:'请选择客户'}]); act(()=>host.querySelector('button')!.click()); expect(document.activeElement).toBe(host.querySelectorAll('input')[1]); render([]); expect(host.querySelector('[role="alert"]')).toBeNull() } finally {act(()=>root.unmount());host.remove()}
})
test('Enter连续录入、Shift反向、跳过禁用控件、末行只聚焦添加，不影响IME或其他表单', () => {
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host)
 act(()=>root.render(<><div data-order-entry><input data-entry-input /></div><div data-order-entry onKeyDown={handleEntryKeyDown}><input data-entry-input aria-label="数量1" /><input data-entry-input disabled aria-label="价格1" /><input data-entry-input aria-label="数量2" /><input data-entry-input aria-label="价格2" /><button data-entry-add>添加商品</button></div></>))
 const inputs=host.querySelectorAll('input');const key=(el:HTMLElement,opts:KeyboardEventInit={})=>act(()=>el.dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,cancelable:true,key:'Enter',...opts})))
 try {inputs[1].focus();key(inputs[1]);expect(document.activeElement).toBe(inputs[3]);key(inputs[3],{shiftKey:true});expect(document.activeElement).toBe(inputs[1]);key(inputs[1],{isComposing:true});expect(document.activeElement).toBe(inputs[1]);key(inputs[1],{ctrlKey:true});expect(document.activeElement).toBe(inputs[1]);inputs[4].focus();key(inputs[4]);expect(document.activeElement).toBe(host.querySelector('button'))}finally{act(()=>root.unmount());host.remove()}
})
test('改单只读折扣仍可定位查看，不擅自开放编辑', () => {
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host)
 act(()=>root.render(<div data-order-entry><OrderEntryIssues issues={[{target:'discount',message:'折扣超过当前合计'}]}/><span data-entry-field="discount" tabIndex={-1}>原单折扣 10</span></div>))
 try {act(()=>host.querySelector('button')!.click());expect(document.activeElement).toBe(host.querySelector('span'))}finally{act(()=>root.unmount());host.remove()}
})
