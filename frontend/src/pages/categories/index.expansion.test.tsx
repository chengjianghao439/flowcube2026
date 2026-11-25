// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { getByRole, queryByRole } from '@testing-library/dom'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import CategoriesPage from './index'
import { PERMISSIONS } from '@/lib/permission-codes'
import { TabPathContext } from '@/components/layout/TabPathContext'
import { useDirtyGuardStore } from '@/store/dirtyGuardStore'

const mocks = vi.hoisted(() => ({ tree: [] as object[], create: vi.fn(), canCreate: true }))
vi.mock('@/hooks/usePermission', () => ({ usePermission: () => ({ can: (permission: string) => permission !== PERMISSIONS.CATEGORY_CREATE || mocks.canCreate }) }))
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
    const collapseRoot = host.querySelector<HTMLButtonElement>('[aria-label="收起 合成一级"]')!
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

test.each([true, false])('空分类只显示一个文件夹并按新增权限提示（%s）', async canCreate => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  mocks.tree = []; mocks.canCreate = canCreate
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  try {
    await act(async () => root.render(<CategoriesPage />))
    const panel = host.querySelector('.fc-empty-state')!.closest('td')!
    expect(panel.querySelectorAll('svg')).toHaveLength(1)
    expect(panel.querySelector('svg.lucide-folder-open')).not.toBeNull()
    expect(panel.textContent).toContain('暂无分类')
    expect(panel.textContent?.includes('新增一级分类')).toBe(canCreate)
    expect(panel.textContent?.includes('当前账号没有新增分类权限')).toBe(!canCreate)
  } finally {
    await act(async () => root.unmount())
    mocks.canCreate = true
    host.remove()
  }
})


test('按名称定位深层分类，批量折叠后保留一级分类和查询无结果提示', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  mocks.tree = [
    { id: 1, level: 1, name: '合成塑料', code: 'PL01', status: 1, children: [
      { id: 2, level: 2, name: '指定收纳盒', code: 'PL0101', status: 1 },
    ] },
    { id: 3, level: 1, name: '其他配件', code: null, status: 1 },
  ]
  const host = document.body.appendChild(document.createElement('div'))
  const root = createRoot(host)
  const user = userEvent.setup()
  try {
    await act(async () => root.render(<CategoriesPage />))
    const search = getByRole(host, 'searchbox', { name: '搜索分类编码或名称' })
    await act(async () => user.type(search, '指定收纳'))
    expect(getByRole(host, 'row', { name: /指定收纳盒/ })).toBeTruthy()
    expect(queryByRole(host, 'row', { name: /其他配件/ })).toBeNull()
    await act(async () => { await user.clear(search); await user.type(search, '没有匹配') })
    expect(host.textContent).toContain('没有匹配的分类')
    await act(async () => user.clear(search))
    await act(async () => user.click(getByRole(host, 'button', { name: '全部展开' })))
    expect(getByRole(host, 'row', { name: /指定收纳盒/ })).toBeTruthy()
    await act(async () => user.click(getByRole(host, 'button', { name: '全部收起' })))
    expect(queryByRole(host, 'row', { name: /指定收纳盒/ })).toBeNull()
    expect(getByRole(host, 'row', { name: /合成塑料/ })).toBeTruthy()
  } finally { await act(async () => root.unmount()); host.remove() }
})
