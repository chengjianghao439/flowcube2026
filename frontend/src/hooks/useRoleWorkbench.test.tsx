// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, useNavigate, type NavigateFunction } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { expect, test, vi } from 'vitest'
import { useRoleWorkbench } from './useDashboard'
import { TabPathContext } from '@/components/layout/TabPathContext'
import { getRoleWorkbenchApi } from '@/api/reports'

vi.mock('@/api/reports', () => ({ getRoleWorkbenchApi: vi.fn(async () => ({ summary: { totalAlerts: 3 }, sections: [] })) }))

test('首页与待办中心共享一次查询，切换工作区沿用新鲜缓存', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host)
  let navigate: NavigateFunction
  function Consumer() { const query = useRoleWorkbench(); return <span>{query.data?.summary.totalAlerts}</span> }
  function Harness() {
    navigate = useNavigate()
    return <><TabPathContext.Provider value="/dashboard"><Consumer /></TabPathContext.Provider>
      <TabPathContext.Provider value="/reports/role-workbench"><Consumer /></TabPathContext.Provider></>
  }
  try {
    await act(async () => { root.render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/dashboard']}><Harness /></MemoryRouter></QueryClientProvider>) })
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)) })
    expect(client.getQueryData(['role-workbench'])).toMatchObject({ summary: { totalAlerts: 3 } })
    await act(async () => { navigate('/reports/role-workbench') })
    expect(getRoleWorkbenchApi).toHaveBeenCalledTimes(1)
  } finally { await act(async () => root.unmount()); client.clear(); host.remove() }
})
