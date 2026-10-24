// @vitest-environment jsdom
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { FinderModal } from './FinderModal'
import ProductFinderModal from '@/components/shared/ProductFinderModal'
import { AppDialog } from '@/components/shared/AppDialog'

// 保留真实输入、AppDialog、Radix FocusScope 与回焦 hook；只隔离数据读取。
vi.mock('@/hooks/useProducts', () => ({ useProductFinder: () => ({
  data: { list: [{ id: 1, code: 'P001', name: '连接器', unit: '个' }], pagination: { total: 1 } },
  isFetching: false, isLoading: false, refetch: vi.fn(),
}) }))
vi.mock('@/hooks/useCategories', () => ({ useCategoryTree: () => ({ data: [], refetch: vi.fn() }) }))

let host: HTMLDivElement, root: Root
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals() })

test.each(['profile', 'product'] as const)('嵌套在查询窗中的%s选择器打开后可直接输入，取消返回原字段', async kind => {
  function Fixture() {
    const [open, setOpen] = useState(false)
    const [queryOpen, setQueryOpen] = useState(true)
    return <AppDialog open={queryOpen} onOpenChange={setQueryOpen} dialogId="nested-query-focus" title="查询条件">
      <button type="button" onClick={() => setOpen(true)}>客户字段</button>
      {kind === 'product' ? <ProductFinderModal open={open} onClose={() => setOpen(false)} onConfirm={() => {}} /> : <FinderModal open={open} onClose={() => setOpen(false)} title="选择客户" dialogId="nested-customer-focus"
        columns={[{ key: 'name', title: '客户名称' }]} data={[]} selected={null} onSelect={() => {}} onConfirm={() => {}}
        getRowKey={() => 1} keyword="" onKeywordChange={() => {}} searchPlaceholder="搜索客户" />}
    </AppDialog>
  }
  await act(async () => root.render(<Fixture />))
  const trigger = [...document.querySelectorAll('button')].find(button => button.textContent === '客户字段')!
  await act(async () => { trigger.focus(); trigger.click() })
  const dialog = [...document.querySelectorAll('[role="dialog"]')].find(element => element.querySelector('h2')?.textContent === (kind === 'product' ? '选择商品' : '选择客户'))!
  expect(document.activeElement).toBe(dialog.querySelector('input'))
  const cancel = [...dialog.querySelectorAll('button')].find(button => button.textContent === '取消')!
  await act(async () => cancel.click())
  await vi.waitFor(() => expect(document.activeElement).toBe(trigger))
})

test.each(['profile', 'product'] as const)('%s完整选择器在取消和确认后均返回原触发字段', async kind => {
  const row = { id: 1, name: '供应商甲' }
  function Fixture() {
    const [open, setOpen] = useState(false)
    return <><button type="button" onClick={() => setOpen(true)}>选择资料</button>
      {kind === 'product' ? <ProductFinderModal open={open} onClose={() => setOpen(false)} onConfirm={() => setOpen(false)} />
        : <FinderModal open={open} onClose={() => setOpen(false)} title="选择供应商" dialogId="full-finder-focus"
          columns={[{ key: 'name', title: '名称' }]} data={[row]} selected={row} onSelect={() => {}}
          onConfirm={() => setOpen(false)} getRowKey={value => value.id} keyword="" onKeywordChange={() => {}} />}
    </>
  }
  await act(async () => root.render(<Fixture />))
  const trigger = host.querySelector('button')!
  for (const action of ['取消', '确认选择']) {
    await act(async () => { trigger.focus(); trigger.click() })
    const dialog = document.querySelector('[role="dialog"]')!
    expect(document.activeElement).toBe(dialog.querySelector('input'))
    if (kind === 'product' && action === '确认选择') await act(async () => dialog.querySelector<HTMLTableRowElement>('tbody tr')!.click())
    const button = [...dialog.querySelectorAll('button')].find(element => element.textContent === action)!
    await act(async () => button.click())
    await vi.waitFor(() => {
      expect(document.querySelector('[role="dialog"]')).toBeNull()
      expect(document.activeElement).toBe(trigger)
    })
  }
})


test.each(['paused', 'incomplete', 'both'] as const)('%s 状态在唯一标题说明中保留提示和确认闸门', async state => {
  const confirm = vi.fn(), select = vi.fn(), row = { id: 1, name: '合成供应商' }
  await act(async () => root.render(<FinderModal open onClose={() => {}} title="选择供应商" dialogId="special-caption-finder"
    columns={[{ key: 'name', title: '名称' }]} data={[row]} selected={row} onSelect={select} onConfirm={confirm}
    getRowKey={item => item.id} keyword="" onKeywordChange={() => {}} entityName="供应商"
    unavailableMessage={state !== 'incomplete' ? '读取已暂停，输入已保留。' : undefined}
    incomplete={state !== 'paused'} loadedCount={200} totalCount={201} />))
  const dialog = document.querySelector('[role="dialog"]')!
  const caption = dialog.querySelector('.fc-dialog-caption')!
  expect(dialog.querySelectorAll('.fc-dialog-caption')).toHaveLength(1)
  expect(caption.textContent).toContain(state !== 'incomplete' ? '读取已暂停' : '已读取 200 / 201')
  expect(dialog.getAttribute('aria-describedby')).toBe(caption.id)
  if (state === 'both') expect(caption.textContent).toContain('已读取 200 / 201')
  expect(dialog.textContent?.match(state !== 'incomplete' ? /读取已暂停/g : /已读取 200/g)).toHaveLength(1)
  const button = [...dialog.querySelectorAll('button')].find(button => button.textContent === '确认选择')!
  expect(button.disabled).toBe(true)
  await act(async () => button.click())
  expect(confirm).not.toHaveBeenCalled()
})
