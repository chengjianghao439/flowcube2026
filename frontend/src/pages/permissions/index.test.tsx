// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, afterEach, expect, test } from 'vitest'
import { getByRole, queryByRole } from '@testing-library/dom'
import client, { setApiClientBaseURL } from '@/api/client'
import { useAuthStore } from '@/store/authStore'
import { useDirtyGuardStore } from '@/store/dirtyGuardStore'
import { PERMISSION_GROUPS, PERMISSIONS as P } from '@/lib/permission-codes'
import PermissionsPage from './index'

const originalAdapter = client.defaults.adapter
const writes: unknown[] = [], unexpected: string[] = []
let finish: (() => void) | undefined
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  localStorage.clear(); writes.length = 0; unexpected.length = 0; finish = undefined
  setApiClientBaseURL('/t07-permissions-fixture')
  useAuthStore.getState().login('fixture', null, { id: 9, username: 'fixture', realName: '合成账号', roleId: 5, roleName: '合成角色', permissions: [P.ROLE_ASSIGN] })
  useDirtyGuardStore.setState({ dirtyTabs: {}, pendingConfirm: null })
  client.defaults.adapter = async config => {
    let data: unknown
    if (config.method === 'get' && config.url === '/roles') data = [{ id: 2, code: 'fixture', name: '合成角色', remark: '', is_system: 0 }, { id: 3, code: 'other', name: '另一角色', remark: '', is_system: 0 }]
    else if (config.method === 'get' && /^\/roles\/[23]\/permissions$/.test(config.url ?? '')) data = []
    else if (config.method === 'put' && config.url === '/roles/2/permissions') {
      writes.push(JSON.parse(config.data))
      await new Promise<void>(resolve => { finish = resolve })
      data = null
    } else { unexpected.push(`${config.method} ${config.url}`); throw new Error('unexpected fixture request') }
    return { config, headers: {}, status: 200, statusText: 'OK', data: { success: true, data } }
  }
})
afterEach(() => { client.defaults.adapter = originalAdapter; expect(unexpected).toEqual([]) })
async function mount() {
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host), qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  await act(async () => root.render(<QueryClientProvider client={qc}><MemoryRouter><PermissionsPage /></MemoryRouter></QueryClientProvider>))
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 15)) })
  return { host, close: () => { act(() => root.unmount()); qc.clear(); host.remove() } }
}
async function click(host: HTMLElement, name: string) { await act(async () => getByRole(host, 'button', { name }).click()) }

test('single permission-save action uses the original role and selection and stays disabled while pending', async () => {
  const view = await mount()
  try {
    await click(view.host, '编辑')
    const item = PERMISSION_GROUPS[0].items[0]
    await click(view.host, item.label)
    const save = getByRole(view.host, 'button', { name: '保存修改' }) as HTMLButtonElement
    await act(async () => save.click())
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)) })
    expect(save.disabled).toBe(true)
    expect((getByRole(view.host, 'button', { name: '取消编辑' }) as HTMLButtonElement).disabled).toBe(true)
    await act(async () => save.click())
    expect(writes).toEqual([{ permissions: [item.code] }])
    await act(async () => finish!())
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)) })
    expect(queryByRole(view.host, 'button', { name: '保存修改' })).toBeNull()
  } finally { view.close() }
})

test('cancel and dirty role-switch confirmation retain the original permission-edit model', async () => {
  const view = await mount()
  try {
    await click(view.host, '编辑'); await click(view.host, PERMISSION_GROUPS[0].items[0].label)
    await click(view.host, '另一角色')
    expect(useDirtyGuardStore.getState().pendingConfirm).not.toBeNull()
    await act(async () => useDirtyGuardStore.getState().resolveConfirm(false))
    expect(getByRole(view.host, 'button', { name: PERMISSION_GROUPS[0].items[0].label }).getAttribute('aria-pressed')).toBe('true')
    await click(view.host, '取消编辑'); await click(view.host, '编辑')
    expect(getByRole(view.host, 'button', { name: PERMISSION_GROUPS[0].items[0].label }).getAttribute('aria-pressed')).toBe('false')
    await act(async () => useAuthStore.getState().updateUser({ permissions: [] }))
    expect(queryByRole(view.host, 'button', { name: '保存修改' })).toBeNull()
    expect(writes).toEqual([])
  } finally { view.close() }
})
