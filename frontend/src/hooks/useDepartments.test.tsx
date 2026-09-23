// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { useCreateDepartment, useDeleteDepartment, useDepartmentOptions, useUpdateDepartment } from './useDepartments'

const listOptions = vi.fn()
vi.mock('@/api/departments', () => ({
  listDepartmentOptionsApi: () => listOptions(),
  listDepartmentsApi: vi.fn(async () => []),
  createDepartmentApi: vi.fn(async () => ({ id: 2 })),
  updateDepartmentApi: vi.fn(async () => null),
  deleteDepartmentApi: vi.fn(async () => null),
}))

let root: Root
let host: HTMLDivElement
let queryClient: QueryClient
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } })
  queryClient.setQueryData(['department-options'], [{ id: 1, name: '旧部门' }])
  listOptions.mockResolvedValue([{ id: 1, name: '旧部门' }, { id: 2, name: '新部门' }])
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); queryClient.clear(); listOptions.mockReset() })

test.each(['create', 'update', 'delete'] as const)('%s department refreshes user form department options', async action => {
  function Harness() {
    const { data } = useDepartmentOptions()
    const create = useCreateDepartment()
    const update = useUpdateDepartment()
    const remove = useDeleteDepartment()
    const run = () => {
      if (action === 'create') create.mutate({ name: '新部门' })
      else if (action === 'update') update.mutate({ id: 1, data: { name: '新部门' } })
      else remove.mutate(1)
    }
    return <><button onClick={run}>保存部门</button><span>{data?.map(item => item.name).join(',')}</span></>
  }
  await act(async () => root.render(<QueryClientProvider client={queryClient}><Harness /></QueryClientProvider>))
  expect(host.textContent).toContain('旧部门')
  await act(async () => {
    host.querySelector('button')!.click()
    await vi.waitFor(() => expect(queryClient.getQueryData(['department-options'])).toEqual([{ id: 1, name: '旧部门' }, { id: 2, name: '新部门' }]))
  })
  expect(host.textContent).toContain('新部门')
  expect(listOptions).toHaveBeenCalled()
})
