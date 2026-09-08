// @vitest-environment jsdom
import { act, forwardRef, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import TableActionsMenu from './TableActionsMenu'
import { SectionVisibilityContext } from '../layout/SectionVisibilityContext'

const mounts = vi.hoisted(() => vi.fn())
vi.mock('@/components/ui/dropdown-menu', async importOriginal => {
  const actual = await importOriginal<typeof import('@/components/ui/dropdown-menu')>()
  return { ...actual, DropdownMenu: (props: React.ComponentProps<typeof actual.DropdownMenu>) => {
    useEffect(() => { mounts() }, [])
    return <actual.DropdownMenu {...props} />
  },
  // jsdom 无排版，跳过 Floating UI 的 Portal 定位；保留真实 Root/Trigger 与可见性 hook。
  // 菜单项点击、Escape 与焦点归还在真实开发浏览器验证。
  DropdownMenuContent: forwardRef(() => null) }
})
let host: HTMLDivElement, root: Root
const primary = vi.fn(), secondary = vi.fn()
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.clearAllMocks()
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })
async function render(active = true, disabled = false) {
  await act(async () => root.render(<SectionVisibilityContext.Provider value={active}>
    <TableActionsMenu primaryLabel="编辑" onPrimaryClick={primary} primaryDisabled={disabled}
      items={[{ label: '打印标签', onClick: secondary }]} />
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
