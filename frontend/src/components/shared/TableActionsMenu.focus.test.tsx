// @vitest-environment jsdom
import { act, useState, useRef, useCallback } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import TableActionsMenu from './TableActionsMenu'
import { ConfirmDialog } from './ConfirmDialog'

let host: HTMLDivElement, root: Root
const confirm = vi.fn()
function Harness({ available, present = true }: { available: boolean; present?: boolean }) {
  const query = useRef<HTMLButtonElement>(null)
  const unavailable = useCallback(() => query.current?.focus(), [])
  const [open, setOpen] = useState(false)
  return <><button ref={query}>查询</button>{present && <TableActionsMenu onUnavailableFocus={unavailable} primaryLabel="核对原补打" primaryDisabled={!available} onPrimaryClick={() => {}}
    items={available ? [{ label: '明确另补一份', afterMenuClose: true, onClick: () => setOpen(true) }] : []} />}
    <ConfirmDialog open={open} title="明确另补一份" description="原任务可能已入队，请核对现场纸张。"
      confirmText="确认另补一份" onCancel={() => setOpen(false)} onConfirm={() => { confirm(); setOpen(false) }} /></>
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.clearAllMocks(); localStorage.clear(); host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  window.HTMLElement.prototype.scrollIntoView = vi.fn()
})
afterEach(async () => { await act(async () => root.unmount()); host.remove() })
async function settle() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)) }) }
async function render(available = true, present = true) { await act(async () => root.render(<Harness available={available} present={present} />)); await settle() }
const trigger = () => host.querySelector<HTMLButtonElement>('[aria-label="更多操作"]')!
const menu = () => document.querySelector<HTMLElement>('[role="menu"][data-state="open"]')
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"][data-state="open"]')!
async function openConfirm() {
  await render(); await act(async () => { trigger().focus(); trigger().click() }); await settle()
  await act(async () => (document.querySelector('[role="menuitem"]') as HTMLElement).click()); await settle()
}
test('真实Radix关闭菜单交接后，两个读取周期不复活菜单或隐藏确认框', async () => {
  await openConfirm(); expect(menu()).toBeNull(); expect(dialog().getAttribute('aria-hidden')).not.toBe('true')
  for (let round = 0; round < 2; round++) {
    await render(false); await render(true)
    expect(menu()).toBeNull(); expect(dialog().getAttribute('aria-hidden')).not.toBe('true')
    expect(dialog().contains(document.activeElement)).toBe(true)
  }
  expect(confirm).not.toHaveBeenCalled()
})
test('关闭后Escape回到原行按钮，可重新打开并仅确认一次', async () => {
  await openConfirm(); const original = trigger(); await render(false); await render(true)
  await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))); await settle()
  expect(dialog()).toBeNull(); expect(document.activeElement).toBe(original); expect(menu()).toBeNull()
  await act(async () => original.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))); await settle()
  await act(async () => (document.querySelector('[role="menuitem"]') as HTMLElement).click()); await settle()
  await act(async () => ([...dialog().querySelectorAll('button')].find(b => b.textContent === '确认另补一份') as HTMLButtonElement).click()); await settle()
  expect(confirm).toHaveBeenCalledOnce(); expect(dialog()).toBeNull(); expect(menu()).toBeNull()
})
test('打开菜单期间操作项暂时消失后，恢复数据也不自动重开菜单', async () => {
  await render(); await act(async () => trigger().click()); await settle(); expect(menu()).not.toBeNull()
  await render(false); await render(true)
  expect(menu()).toBeNull(); expect(trigger().getAttribute('aria-expanded')).toBe('false'); expect(confirm).not.toHaveBeenCalled()
})

test('读取期间关闭当前行菜单后回查询，恢复数据不重开或丢失焦点', async () => {
  await render(); await act(async () => { trigger().focus(); trigger().click() }); await settle()
  await act(async () => (document.querySelector('[role="menuitem"]') as HTMLElement).focus())
  await render(false)
  expect(menu()).toBeNull(); expect(document.activeElement?.textContent).toBe('查询')
  await render(true); expect(document.activeElement?.textContent).toBe('查询'); expect(menu()).toBeNull()
})
test('焦点所在的列表行消失时回查询，菜单清理后仍保留焦点', async () => {
  await render(); await act(async () => { trigger().focus(); trigger().click() }); await settle()
  await act(async () => (document.querySelector('[role="menuitem"]') as HTMLElement).focus())
  await render(true, false); expect(menu()).toBeNull(); expect(document.activeElement?.textContent).toBe('查询')
})
test('行按钮暂时禁用时回查询，未持有焦点的后台刷新不抢焦点', async () => {
  await render(); await act(async () => trigger().focus()); await render(false)
  expect(document.activeElement?.textContent).toBe('查询')
  await render(true); const external = document.createElement('button'); external.textContent='外部'; document.body.append(external)
  try { await act(async () => external.focus()); await render(false); expect(document.activeElement).toBe(external) } finally { external.remove() }
})
