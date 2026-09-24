// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { ApiClientError } from '@/api/client'
import { toast } from '@/lib/toast'
import BaseCrudPage from './BaseCrudPage'

vi.mock('@/lib/toast', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>
let queryClient: QueryClient

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  vi.mocked(toast.error).mockClear()
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  queryClient.clear()
})

test.each([
  { message: '供应商名称已存在，请勿重复', error: new ApiClientError({ message: '供应商名称已存在，请勿重复', status: 400, response: { success: false, message: '供应商名称已存在，请勿重复' } }) },
  { message: '请输入正确的手机号', error: { response: { data: { message: '请输入正确的手机号' } } } },
])('保存失败只提示一次明确原因：$message', async ({ message, error }) => {
  await act(async () => root.render(
    <QueryClientProvider client={queryClient}>
      <BaseCrudPage
        title="供应商管理"
        columns={[]}
        queryKey={['supplier-feedback-test']}
        listQuery={async () => ({ list: [] })}
        deleteApi={async () => null}
        deleteMessage="删除供应商"
        renderForm={() => <div>测试表单</div>}
        submitForm={async () => { throw error }}
      />
    </QueryClientProvider>,
  ))
  await act(async () => {
    [...document.querySelectorAll('button')].find(button => button.textContent?.includes('新建'))!.click()
  })
  await act(async () => {
    [...document.querySelectorAll('button')].find(button => button.textContent === '创建')!.click()
  })
  expect(toast.error).toHaveBeenCalledExactlyOnceWith(message)
})
