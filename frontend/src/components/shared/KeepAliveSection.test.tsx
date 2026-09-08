// @vitest-environment jsdom
import { act, useEffect, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import KeepAliveSection from './KeepAliveSection'
import { useSectionActive } from '../layout/SectionVisibilityContext'
import { Dialog, DialogContent, DialogTitle } from '../ui/dialog'
import { AppDialog } from './AppDialog'

let host: HTMLDivElement, root: Root
beforeEach(() => {
  Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true})
  host=document.createElement('div');document.body.append(host);root=createRoot(host)
})
afterEach(() => { act(()=>root.unmount());host.remove() })
const mounted=vi.fn(), unmounted=vi.fn()
function Draft({name}:{name:string}) {
  const [value,setValue]=useState('初始')
  const active=useSectionActive()
  useEffect(()=>{mounted(name);return()=>{unmounted(name)}},[name])
  return <div data-active={active}><input aria-label={name} value={value} onChange={e=>setValue(e.target.value)}/><button onClick={()=>setValue('已修改')}>修改{name}</button></div>
}
function render(active:string, pageKey='page') {
  act(()=>root.render(<div key={pageKey}><KeepAliveSection active={active==='a'} data-section="a"><Draft name="a"/></KeepAliveSection><KeepAliveSection active={active==='b'} data-section="b"><Draft name="b"/></KeepAliveSection></div>))
}
test('首次才挂载；切回保持草稿、DOM与滚动；关闭大页重开重置',()=>{
  mounted.mockClear();unmounted.mockClear()
  render('a')
  expect(mounted.mock.calls).toEqual([['a']])
  const input=host.querySelector('input')!
  act(()=>(host.querySelector('button') as HTMLButtonElement).click())
  const section=host.querySelector('[data-section="a"]') as HTMLElement
  section.scrollTop=160
  render('b')
  expect(section.hidden).toBe(true)
  expect(section.querySelector('[data-active]')?.getAttribute('data-active')).toBe('false')
  expect(unmounted).not.toHaveBeenCalled()
  render('a')
  expect(host.querySelector('input')).toBe(input)
  expect(input.value).toBe('已修改')
  expect(section.scrollTop).toBe(160)
  render('a','reopened')
  expect(host.querySelector('input')?.value).toBe('初始')
  expect(unmounted.mock.calls).toEqual([['a'],['b']])
})
test('父视图隐藏时子页非活动，首次隐藏的子页不提前挂载',()=>{
  mounted.mockClear()
  const view=(active:boolean)=> <KeepAliveSection active={active}><KeepAliveSection active><Draft name="nested"/></KeepAliveSection></KeepAliveSection>
  act(()=>root.render(view(false)))
  expect(mounted).not.toHaveBeenCalled()
  act(()=>root.render(view(true)))
  expect(host.querySelector('[data-active]')?.getAttribute('data-active')).toBe('true')
  act(()=>root.render(view(false)))
  expect(host.querySelector('[data-active]')?.getAttribute('data-active')).toBe('false')
})
test('共用大页面滚动容器时，每个子页恢复自己的位置',()=>{
  const view=(tab:string)=><div data-workspace-scroll><KeepAliveSection active={tab==='a'}><Draft name="a"/></KeepAliveSection><KeepAliveSection active={tab==='b'}><Draft name="b"/></KeepAliveSection></div>
  act(()=>root.render(view('a')))
  const container=host.querySelector('[data-workspace-scroll]') as HTMLElement
  container.scrollTop=200;container.dispatchEvent(new Event('scroll'))
  act(()=>root.render(view('b')))
  expect(container.scrollTop).toBe(0)
  container.scrollTop=70;container.dispatchEvent(new Event('scroll'))
  act(()=>root.render(view('a')))
  expect(container.scrollTop).toBe(200)
  act(()=>root.render(view('b')))
  expect(container.scrollTop).toBe(70)
})
test('隐藏页面弹窗不留在body，不调用业务关闭回调，切回保留打开状态',async()=>{
  const changed=vi.fn()
  const view=(active:boolean)=><KeepAliveSection active={active}><Dialog open onOpenChange={changed}><DialogContent aria-describedby={undefined}><DialogTitle>保留弹窗</DialogTitle></DialogContent></Dialog></KeepAliveSection>
  await act(async()=>root.render(view(true)))
  expect(document.querySelector('[role="dialog"]')).not.toBeNull()
  await act(async()=>root.render(view(false)))
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  expect(changed).not.toHaveBeenCalled()
  await act(async()=>root.render(view(true)))
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain('保留弹窗')
})
test('旧 AppDialog 同样跟随所属页面隐藏，不丢调用方打开状态',async()=>{
  const changed=vi.fn()
  const view=(active:boolean)=><KeepAliveSection active={active}><AppDialog open onOpenChange={changed} dialogId="retention-test" title="旧查询窗口"><p>查询草稿</p></AppDialog></KeepAliveSection>
  await act(async()=>root.render(view(true)))
  expect(document.querySelector('[role="dialog"]')).not.toBeNull()
  await act(async()=>root.render(view(false)))
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  expect(changed).not.toHaveBeenCalled()
  await act(async()=>root.render(view(true)))
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain('查询草稿')
})
