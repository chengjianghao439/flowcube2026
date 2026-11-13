// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import CategoriesPage from './index'
import { TabPathContext } from '@/components/layout/TabPathContext'
import { useDirtyGuardStore } from '@/store/dirtyGuardStore'

const mocks = vi.hoisted(() => ({ tree: [] as object[], create: vi.fn() }))
vi.mock('@/hooks/usePermission', () => ({ usePermission: () => ({ can: () => true }) }))
vi.mock('@/hooks/useCategories', () => ({
  useCategoryTree: () => ({ data: mocks.tree, isLoading: false }),
  useCreateCategory: () => ({ mutate: mocks.create, isPending: false }),
  useUpdateCategory: () => ({}),
  useDeleteCategory: () => ({}),
  useToggleCategoryStatus: () => ({}),
}))

test('逐级保存子分类时展开路径，最后一级无需重新展开父级', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const node = (id: number, parentId: number | null, name: string) => ({
    id, name, parentId, level: id, sortOrder: 0, status: 1, children: [] as object[],
  })
  const first = node(1, null, '合成一级')
  let parent = first
  mocks.tree = [first]
  mocks.create.mockImplementation((payload, options) => {
    expect(payload.parentId).toBe(parent.id)
    const child = node(parent.id + 1, parent.id, payload.name)
    parent.children.push(child)
    parent = child
    options.onSuccess(child)
  })
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const user = userEvent.setup()
  try {
    await act(async () => root.render(<CategoriesPage />))
    for (const name of ['合成二级', '合成三级', '合成四级']) {
      const buttons = host.querySelectorAll<HTMLButtonElement>('button[title="新增子分类"]')
      expect(buttons.length).toBe(parent.id)
      await act(async () => { await user.click(buttons[buttons.length - 1]) })
      const input = document.querySelector<HTMLInputElement>('[role="dialog"] input[id="category-name"]')!
      await act(async () => { await user.type(input, name) })
      const save = document.querySelector<HTMLButtonElement>('[role="dialog"] button[type="submit"]')!
      await act(async () => { await user.click(save) })
      expect(host.textContent).toContain(name)
    }
    const collapseRoot = host.querySelector<HTMLButtonElement>('[aria-label="收起合成一级"]')!
    await act(async () => { await user.click(collapseRoot) })
    expect(host.textContent).not.toContain('合成二级')
  } finally {
    await act(async () => root.unmount())
    host.remove()
  }
})

test('分类空表单可直接关闭，输入后 Escape 或关闭须确认并保留草稿', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  mocks.tree = []
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const user = userEvent.setup()
  const click = async (label: string) => {
    const button = [...document.querySelectorAll('button')].find(item => item.textContent?.trim() === label)
    expect(button, label).toBeTruthy()
    await act(async () => { await user.click(button!) })
  }
  try {
    await act(async () => root.render(<TabPathContext.Provider value="/categories"><CategoriesPage /></TabPathContext.Provider>))
    await click('新增一级分类')
    await click('取消')
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    await click('新增一级分类')
    const input = document.querySelector<HTMLInputElement>('#category-name')!
    await act(async () => { await user.type(input, '未保存分类'); await user.keyboard('{Escape}') })
    expect(useDirtyGuardStore.getState().isTabDirty('/categories')).toBe(true)
    await click('继续编辑')
    expect(input.value).toBe('未保存分类')
    await vi.waitFor(() => expect(document.activeElement).toBe(input))
    await click('关闭')
    await click('放弃本次修改')
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(useDirtyGuardStore.getState().isTabDirty('/categories')).toBe(false)
  } finally {
    await act(async () => root.unmount())
    host.remove()
  }
})
