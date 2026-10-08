// @vitest-environment jsdom
import { act, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { SectionVisibilityContext } from '@/components/layout/SectionVisibilityContext'
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from './dialog'
import { AppDialog } from '@/components/shared/AppDialog'

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })
const button = (name: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent === name)!
async function settle() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) }) }
async function click(name: string) { act(() => { button(name).focus(); button(name).click() }); await settle() }
async function escape() { act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))); await settle() }
async function until(predicate: () => boolean) {
  for (let attempt = 0; attempt < 25 && !predicate(); attempt++) await settle()
  expect(predicate()).toBe(true)
}

function Controlled({ active = true, hidden = false, onCloseAutoFocus, app = false }: { active?: boolean; hidden?: boolean; onCloseAutoFocus?: (event: Event) => void; app?: boolean }) {
  const [open, setOpen] = useState(false)
  return <>
    <button hidden={hidden} onClick={() => setOpen(true)}>独立打开</button>
    <SectionVisibilityContext.Provider value={active}>
      {app ? <AppDialog open={open} onOpenChange={setOpen} dialogId="focus-fixture" title="受控浮层" onCloseAutoFocus={onCloseAutoFocus}>
        <input aria-label="浮层字段" />
      </AppDialog> : <Dialog open={open} onOpenChange={setOpen}><DialogContent aria-describedby={undefined} onCloseAutoFocus={onCloseAutoFocus}>
        <DialogTitle>受控浮层</DialogTitle><input aria-label="浮层字段" />
      </DialogContent></Dialog>}
    </SectionVisibilityContext.Provider>
    <button>另一页操作</button>
  </>
}

test.each([false, true])('无 DialogTrigger 的受控浮层 Escape 回到原打开按钮（AppDialog=$0）', async app => {
  act(() => root.render(<Controlled app={app} />)); await click('独立打开')
  expect(document.querySelector('[role="dialog"]')?.contains(document.activeElement)).toBe(true)
  await escape(); expect(document.querySelector('[role="dialog"]')).toBeNull()
  expect(document.activeElement).toBe(button('独立打开'))
})

test('嵌套受控浮层仅回内层打开按钮，外层退出再回原按钮', async () => {
  function Nested() {
    const [outer, setOuter] = useState(false), [inner, setInner] = useState(false)
    return <><button onClick={() => setOuter(true)}>打开外层</button>
      <Dialog open={outer} onOpenChange={setOuter}><DialogContent aria-describedby={undefined}>
        <DialogTitle>外层</DialogTitle><button onClick={() => setInner(true)}>打开内层</button>
        <Dialog open={inner} onOpenChange={setInner}><DialogContent aria-describedby={undefined}>
          <DialogTitle>内层</DialogTitle><input aria-label="内层字段" />
        </DialogContent></Dialog>
      </DialogContent></Dialog></>
  }
  act(() => root.render(<Nested />)); await click('打开外层'); await click('打开内层')
  expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(2)
  expect(document.activeElement).toBe(document.querySelector('[aria-label="内层字段"]'))
  await escape()
  await until(() => document.querySelectorAll('[role="dialog"]').length === 1 && document.activeElement === button('打开内层'))
  expect(document.activeElement).toBe(button('打开内层'))
  expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1)
  await escape()
  await until(() => !document.querySelector('[role="dialog"]') && document.activeElement === button('打开外层'))
})

test.each(['hidden', 'inactive'] as const)('关闭时原操作 %s 不抢另一页焦点', async mode => {
  act(() => root.render(<Controlled />)); await click('独立打开')
  act(() => root.render(<Controlled hidden={mode === 'hidden'} active={mode !== 'inactive'} />))
  if (mode === 'hidden') act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
  act(() => button('另一页操作').focus()); await settle()
  expect(document.activeElement).toBe(button('另一页操作'))
})

test('已有 Trigger 隐藏后退出，不把另一页焦点拉回隐藏按钮', async () => {
  function Fixture({ hidden = false }: { hidden?: boolean }) {
    return <><Dialog><div style={{ display: hidden ? 'none' : 'block' }}><DialogTrigger>隐藏前打开</DialogTrigger></div>
      <DialogContent aria-describedby={undefined}><DialogTitle>标准浮层</DialogTitle><input aria-label="字段" /></DialogContent>
    </Dialog><button>另一页操作</button></>
  }
  act(() => root.render(<Fixture />)); await click('隐藏前打开')
  act(() => root.render(<Fixture hidden />))
  act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
  act(() => button('另一页操作').focus()); await settle()
  expect(document.activeElement).toBe(button('另一页操作'))
})

test('显式 onCloseAutoFocus preventDefault 保留调用方的回焦归属', async () => {
  const custom = vi.fn((event: Event) => { event.preventDefault(); button('另一页操作').focus() })
  act(() => root.render(<Controlled onCloseAutoFocus={custom} />)); await click('独立打开'); await escape()
  expect(custom).toHaveBeenCalledOnce(); expect(document.activeElement).toBe(button('另一页操作'))
})

test('已有 DialogTrigger 的键盘焦点仍回到同一触发按钮', async () => {
  act(() => root.render(<Dialog><DialogTrigger>标准打开</DialogTrigger><DialogContent aria-describedby={undefined}>
    <DialogTitle>标准浮层</DialogTitle><input aria-label="标准字段" />
  </DialogContent></Dialog>))
  await click('标准打开'); await escape(); expect(document.activeElement).toBe(button('标准打开'))
})
