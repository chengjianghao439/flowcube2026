// @vitest-environment jsdom
import { act, forwardRef, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import TableActionsMenu, { type TableActionItem } from './TableActionsMenu'
import { SectionVisibilityContext } from '../layout/SectionVisibilityContext'

const mounts = vi.hoisted(() => vi.fn())
const content = vi.hoisted(() => vi.fn())
vi.mock('@/components/ui/dropdown-menu', async importOriginal => {
  const actual = await importOriginal<typeof import('@/components/ui/dropdown-menu')>()
  return { ...actual, DropdownMenu: (props: React.ComponentProps<typeof actual.DropdownMenu>) => {
    useEffect(() => { mounts() }, [])
    return <actual.DropdownMenu {...props} />
  },
  // jsdom 无排版，跳过 Floating UI 的 Portal 定位；保留真实 Root/Trigger 与可见性 hook。
  // 菜单项点击、Escape 与焦点归还在真实开发浏览器验证。
  DropdownMenuContent: forwardRef((props, ref) => { void ref; content(props); return null }) }
})
let host: HTMLDivElement, root: Root
const primary = vi.fn(), secondary = vi.fn()
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.clearAllMocks()
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })
async function render(active = true, disabled = false, items: TableActionItem[] = [{ label: '打印标签', onClick: secondary }]) {
  await act(async () => root.render(<SectionVisibilityContext.Provider value={active}>
    <TableActionsMenu primaryLabel="编辑" onPrimaryClick={primary} primaryDisabled={disabled}
      items={items} />
  </SectionVisibilityContext.Provider>))
}
test('未操作的行不初始化菜单；主操作仍直接可用', async () => {
  await render()
  expect(mounts).not.toHaveBeenCalled()
  act(() => (host.querySelector('button') as HTMLButtonElement).click())
  expect(primary).toHaveBeenCalledOnce()
  expect(mounts).not.toHaveBeenCalled()
})
test('首次点击展开，页面隐藏不丢打开状态且不重复挂载菜单', async () => {
  await render()
  await act(async () => (host.querySelector('[aria-label="更多操作"]') as HTMLButtonElement).click())
  expect(host.querySelector('[aria-expanded="true"]')).not.toBeNull()
  await render(false)
  expect(host.querySelector('[aria-expanded="true"]')).toBeNull()
  await render(true)
  expect(host.querySelector('[aria-expanded="true"]')).not.toBeNull()
  expect(mounts).toHaveBeenCalledOnce()
})
test('向下方向键可以首次展开，禁用行不会展开', async () => {
  await render(true, true)
  act(() => (host.querySelector('[aria-label="更多操作"]') as HTMLButtonElement).click())
  expect(mounts).not.toHaveBeenCalled()
  await render()
  await act(async () => host.querySelector('[aria-label="更多操作"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })))
  expect(host.querySelector('[aria-expanded="true"]')).not.toBeNull()
})

// 只隔离无布局的菜单内容定位；下面检查 TableActionsMenu 交给真实 Radix 的关闭生命周期与业务回调顺序。
function menuCallbacks() {
  const props=content.mock.lastCall![0] as {onCloseAutoFocus:(event:Event)=>void;children:React.ReactElement<{children:React.ReactElement<{onClick:()=>void}>[]}>[]}
  return {select:props.children[0].props.children[1].props.onClick,close:props.onCloseAutoFocus}
}
async function openMenu(items:TableActionItem[]) {
  await render(true,false,items)
  await act(async()=>{(host.querySelector('[aria-label="更多操作"]') as HTMLButtonElement).click()})
}
test('弹窗交接显式等待 Radix 关闭，回调一次消费；连续选择各自等待',async()=>{
  await openMenu([{label:'明细',afterMenuClose:true,onClick:secondary}])
  const callbacks=menuCallbacks()
  act(()=>callbacks.select());expect(secondary).not.toHaveBeenCalled()
  const first=new Event('closeAutoFocus',{cancelable:true})
  act(()=>callbacks.close(first));expect(secondary).toHaveBeenCalledTimes(1);expect(first.defaultPrevented).toBe(true)
  act(()=>callbacks.close(new Event('closeAutoFocus',{cancelable:true})));expect(secondary).toHaveBeenCalledTimes(1)
  act(()=>callbacks.select());expect(secondary).toHaveBeenCalledTimes(1)
  act(()=>callbacks.close(new Event('closeAutoFocus',{cancelable:true})));expect(secondary).toHaveBeenCalledTimes(2)
})
test('未启用交接的原动作保持即时执行和默认焦点归还',async()=>{
  await openMenu([{label:'打印',onClick:secondary}])
  const callbacks=menuCallbacks()
  act(()=>callbacks.select());expect(secondary).toHaveBeenCalledOnce()
  const event=new Event('closeAutoFocus',{cancelable:true})
  act(()=>callbacks.close(event));expect(secondary).toHaveBeenCalledOnce();expect(event.defaultPrevented).toBe(false)
})
test('等待菜单关闭时切走页面不打开隐藏详情，重新激活不执行旧交接',async()=>{
  const items=[{label:'明细',afterMenuClose:true,onClick:secondary}]
  await openMenu(items);const callbacks=menuCallbacks()
  act(()=>callbacks.select());await render(false,false,items)
  act(()=>callbacks.close(new Event('closeAutoFocus',{cancelable:true})));expect(secondary).not.toHaveBeenCalled()
  await render(true,false,items)
  act(()=>callbacks.close(new Event('closeAutoFocus',{cancelable:true})));expect(secondary).not.toHaveBeenCalled()
})
test('隐藏后重新激活，再到达的原菜单关闭回调不能恢复旧交接',async()=>{
  const items=[{label:'明细',afterMenuClose:true,onClick:secondary}]
  await openMenu(items);const callbacks=menuCallbacks()
  act(()=>callbacks.select());await render(false,false,items)
  await render(true,false,items)
  act(()=>callbacks.close(new Event('closeAutoFocus',{cancelable:true})))
  expect(secondary).not.toHaveBeenCalled()
})
test('菜单组件卸载取消尚未执行的只读详情交接',async()=>{
  await openMenu([{label:'明细',afterMenuClose:true,onClick:secondary}]);const callbacks=menuCallbacks()
  act(()=>callbacks.select());act(()=>root.render(<span>页面已关闭</span>))
  act(()=>callbacks.close(new Event('closeAutoFocus',{cancelable:true})));expect(secondary).not.toHaveBeenCalled()
})
