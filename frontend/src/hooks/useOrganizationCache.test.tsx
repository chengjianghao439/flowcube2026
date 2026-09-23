// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { useCreateUser, useUpdateUser, useDeleteUser } from './useUsers'
import { useCreateApprovalFlow, useUpdateApprovalFlow, useDeleteApprovalFlow } from './useApprovals'

vi.mock('@/api/users', () => ({
  createUserApi: vi.fn(async () => ({ id: 1 })),
  updateUserApi: vi.fn(async () => null),
  deleteUserApi: vi.fn(async () => null),
}))
vi.mock('@/api/approvals', () => ({
  createApprovalFlowApi: vi.fn(async () => ({ id: 1 })),
  updateApprovalFlowApi: vi.fn(async () => null),
  deleteApprovalFlowApi: vi.fn(async () => null),
}))

let root: Root
let host: HTMLDivElement
let queryClient: QueryClient
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); queryClient.clear() })

test.each(['create', 'update', 'delete'] as const)('%s user refreshes manager options and department status', async action => {
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
  function Harness() {
    const create = useCreateUser()
    const update = useUpdateUser()
    const remove = useDeleteUser()
    return <button onClick={() => {
      if (action === 'create') create.mutate({} as Parameters<typeof create.mutate>[0])
      else if (action === 'update') update.mutate({ id: 1, data: { realName: '测试用户', isActive: false } })
      else remove.mutate(1)
    }}>run</button>
  }
  await act(async () => root.render(<QueryClientProvider client={queryClient}><Harness /></QueryClientProvider>))
  await act(async () => { host.querySelector('button')!.click(); await vi.waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['users'] })) })
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['user-options'] })
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['departments'] })
})

test.each(['create', 'update', 'delete'] as const)('%s approval flow refreshes department reference counts', async action => {
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
  function Harness() {
    const create = useCreateApprovalFlow()
    const update = useUpdateApprovalFlow()
    const remove = useDeleteApprovalFlow()
    return <button onClick={() => {
      if (action === 'create') create.mutate({ bizType: 'expense_claim', name: '测试流程', steps: [] })
      else if (action === 'update') update.mutate({ id: 1, data: { name: '测试流程' } })
      else remove.mutate(1)
    }}>run</button>
  }
  await act(async () => root.render(<QueryClientProvider client={queryClient}><Harness /></QueryClientProvider>))
  await act(async () => { host.querySelector('button')!.click(); await vi.waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['approval-flows'] })) })
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['departments'] })
})
