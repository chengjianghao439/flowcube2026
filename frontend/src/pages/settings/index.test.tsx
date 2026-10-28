// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, expect, test, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { getByRole, getByLabelText, queryByRole } from '@testing-library/dom'
import SettingsPage from './index'
import type { SettingItem } from '@/api/settings'

const state = vi.hoisted(() => ({ editable: true, items: [] as SettingItem[], update: vi.fn() }))
vi.mock('@/hooks/usePermission', () => ({ usePermission: () => ({ can: () => state.editable }) }))
vi.mock('@/api/settings', () => ({
  getSettingsApi: async () => ({ list: state.items, map: {} }),
  getLogoApi: async () => ({ url: '', updatedAt: null }),
  updateSettingsApi: (body: Record<string, string>) => state.update(body),
  uploadLogoApi: vi.fn(),
}))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

beforeEach(() => {
  state.editable = true
  state.items = [
    { key_name: 'company_name', value: '原企业', label: '企业名称', type: 'text', remark: null },
    { key_name: 'future_rule', value: '0', label: '后续业务参数', type: 'number', remark: '来自接口的参数' },
    { key_name: 'company_logo', value: 'image-value', label: '图片', type: 'image', remark: null },
    { key_name: 'company_logo_updated_at', value: 'timestamp-value', label: '更新时间', type: 'timestamp', remark: null },
  ]
  state.update.mockReset().mockImplementation(async (body: Record<string, string>) => {
    state.items = state.items.map(item => Object.hasOwn(body, item.key_name) ? { ...item, value: body[item.key_name] } : item)
    return null
  })
})

async function mount() {
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host), qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  await act(async () => {
    root.render(<QueryClientProvider client={qc}><MemoryRouter><SettingsPage /></MemoryRouter></QueryClientProvider>)
    await new Promise(resolve => setTimeout(resolve, 25))
  })
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 15)) })
  return { host, user: userEvent.setup(), close: () => { act(() => root.unmount()); qc.clear(); host.remove() } }
}

test('grouped settings save the original key contract and exclude independent logo fields', async () => {
  const view = await mount()
  try {
    await act(async () => { await view.user.click(getByRole(view.host, 'button', { name: '编辑' })) })
    const input = getByLabelText(view.host, '后续业务参数')
    await act(async () => { await view.user.clear(input); await view.user.type(input, '12') })
    await act(async () => { await view.user.click(getByRole(view.host, 'button', { name: '保存修改' })) })
    expect(state.update).toHaveBeenCalledWith({ company_name: '原企业', future_rule: '12' })
    expect(queryByRole(view.host, 'button', { name: '保存修改' })).toBeNull()
  } finally { view.close() }
})

test('cancel restores original configuration, including values in dynamically added sections', async () => {
  const view = await mount()
  try {
    await act(async () => { await view.user.click(getByRole(view.host, 'button', { name: '编辑' })) })
    await act(async () => { await view.user.type(getByLabelText(view.host, '企业名称'), '未保存') })
    await act(async () => { await view.user.click(getByRole(view.host, 'button', { name: '取消编辑' })) })
    expect(view.host.textContent).toContain('原企业')
    expect(view.host.textContent).not.toContain('原企业未保存')
    expect(state.update).not.toHaveBeenCalled()
  } finally { view.close() }
})

test('the single settings save action preserves pending disable and sends the original form once', async () => {
  let finish!: () => void
  state.update.mockImplementation(() => new Promise<null>(resolve => { finish = () => resolve(null) }))
  const view = await mount()
  try {
    await act(async () => { await view.user.click(getByRole(view.host, 'button', { name: '编辑' })) })
    await act(async () => { await view.user.type(getByLabelText(view.host, '企业名称'), '更改') })
    const save = getByRole(view.host, 'button', { name: '保存修改' }) as HTMLButtonElement
    await act(async () => save.click())
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)) })
    expect(save.disabled).toBe(true)
    expect((getByRole(view.host, 'button', { name: '取消编辑' }) as HTMLButtonElement).disabled).toBe(true)
    await act(async () => save.click())
    expect(state.update).toHaveBeenCalledTimes(1)
    expect(state.update).toHaveBeenCalledWith({ company_name: '原企业更改', future_rule: '0' })
    await act(async () => finish())
  } finally { view.close() }
})

test('read-only users can see real dynamic settings without edit or logo-upload actions', async () => {
  state.editable = false
  const view = await mount()
  try {
    expect(view.host.textContent).toContain('后续业务参数')
    expect(view.host.textContent).toContain('原企业')
    expect(queryByRole(view.host, 'button', { name: '编辑' })).toBeNull()
    expect(view.host.querySelector('input')).toBeNull()
    expect(view.host.querySelector('.desktop-page-description')?.textContent).toBe('当前账号无修改权限')
    expect(view.host.textContent?.match(/当前账号无修改权限/g)).toHaveLength(1)
  } finally { view.close() }
})


test('页头说明优先显示当前编辑提示，取消后回到用途说明且不重复', async () => {
  const view = await mount()
  const caption = () => view.host.querySelector('.desktop-page-description')
  try {
    expect(caption()?.textContent).toBe('维护企业资料与业务参数。')
    await act(async () => { await view.user.click(getByRole(view.host, 'button', { name: '编辑' })) })
    expect(caption()?.textContent).toBe('正在编辑全局配置，保存后立即生效并回到查看状态。')
    expect(view.host.textContent?.match(/正在编辑全局配置/g)).toHaveLength(1)
    expect(view.host.textContent).not.toContain('维护企业资料与业务参数。')
    expect(view.host.querySelector('.desktop-page-business-notice')).toBeNull()
    await act(async () => { await view.user.type(getByLabelText(view.host, '企业名称'), '未保存') })
    expect(caption()?.textContent).toBe('有未保存的更改，关闭标签前请先保存。')
    expect(view.host.textContent?.match(/有未保存的更改/g)).toHaveLength(1)
    await act(async () => { await view.user.click(getByRole(view.host, 'button', { name: '取消编辑' })) })
    expect(caption()?.textContent).toBe('维护企业资料与业务参数。')
    expect(view.host.textContent).not.toContain('正在编辑全局配置')
    expect(state.update).not.toHaveBeenCalled()
  } finally { view.close() }
})
