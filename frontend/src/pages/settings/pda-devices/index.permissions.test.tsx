// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { within } from '@testing-library/dom'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { expect, test, vi } from 'vitest'
import { useAuthStore } from '@/store/authStore'
import { PERMISSIONS as P } from '@/lib/permission-codes'
import PdaDevicesPage from './index'

const api = vi.hoisted(() => ({
  list: vi.fn(), warehouses: vi.fn(), create: vi.fn(), update: vi.fn(), status: vi.fn(), reset: vi.fn(),
}))
vi.mock('@/api/pda-devices', () => ({
  listPdaDevicesApi: api.list,
  createPdaDeviceApi: api.create,
  updatePdaDeviceApi: api.update,
  setPdaDeviceStatusApi: api.status,
  resetPdaDeviceSecretApi: api.reset,
}))
vi.mock('@/api/warehouses', () => ({ getWarehousesActiveApi: api.warehouses }))

test.each([false, true])('设备列表保留查看能力，写入口仅设备管理权可见 (%s)', async canManage => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.clearAllMocks()
  useAuthStore.setState({
    user: { id: 9, username: 'fixture', realName: '合成用户', roleId: 5, roleName: '合成角色', permissions: [P.PDA_DEVICE_VIEW, ...(canManage ? [P.PDA_DEVICE_MANAGE] : [])] },
  })
  api.list.mockResolvedValue({
    list: [{ id: 7, deviceName: '合成扫码设备', deviceCode: 'PDA-FIXTURE', warehouseName: '合成仓', activeSessions: 0, status: 'active' }],
    pagination: { page: 1, pageSize: 20, total: 1 },
  })
  api.warehouses.mockResolvedValue([])
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const user = userEvent.setup()
  try {
    await act(async () => root.render(<QueryClientProvider client={cache}><PdaDevicesPage /></QueryClientProvider>))
    await act(async () => new Promise(resolve => setTimeout(resolve, 0)))
    const page = within(host)
    await vi.waitFor(() => expect(page.getByText('PDA-FIXTURE')).toBeTruthy())
    await act(async () => user.click(page.getByRole('button', { name: '查询' })))
    const filters = within(within(document.body).getByRole('dialog', { name: '查询 PDA 设备' }))
    expect(filters.getByRole('textbox', { name: '设备名称或设备码' })).toBeTruthy()
    await act(async () => user.click(filters.getByRole('button', { name: '取消' })))
    expect(Boolean(page.queryByRole('button', { name: '登记新设备' }))).toBe(canManage)
    expect(Boolean(page.queryByRole('button', { name: '编辑' }))).toBe(canManage)
    expect(Boolean(page.queryByRole('columnheader', { name: '操作' }))).toBe(canManage)
    expect(Boolean(api.warehouses.mock.calls.length)).toBe(canManage)
    if (canManage) {
      await act(async () => user.click(page.getByRole('button', { name: '更多操作' })))
      expect(within(document.body).getByRole('menuitem', { name: '停用' })).toBeTruthy()
      expect(within(document.body).getByRole('menuitem', { name: '重置密钥' })).toBeTruthy()
      await act(async () => user.keyboard('{Escape}'))
      await act(async () => user.click(page.getByRole('button', { name: '编辑' })))
      const edit = within(document.body).getByRole('dialog', { name: /编辑设备/ })
      expect(edit.querySelector('.fc-form-dialog-body')?.nextElementSibling?.classList.contains('fc-dialog-footer')).toBe(true)
      await act(async () => useAuthStore.getState().updateUser({ permissions: [P.PDA_DEVICE_VIEW] }))
      expect(within(document.body).queryByRole('dialog', { name: /编辑设备/ })).toBeNull()
      expect(page.queryByRole('button', { name: '更多操作' })).toBeNull()
    }
    expect(api.create).not.toHaveBeenCalled()
    expect(api.update).not.toHaveBeenCalled()
    expect(api.status).not.toHaveBeenCalled()
    expect(api.reset).not.toHaveBeenCalled()
  } finally {
    await act(async () => root.unmount())
    cache.clear()
    host.remove()
    useAuthStore.setState({ user: null })
  }
})
