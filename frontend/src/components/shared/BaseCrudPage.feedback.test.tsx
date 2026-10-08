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

test('提交中取消和关闭不能丢弃原表单或打开另一个草稿', async () => {
  let resolve!: () => void
  const saved = new Promise<void>(r => { resolve = r })
  await act(async () => root.render(
    <QueryClientProvider client={queryClient}>
      <BaseCrudPage title="供应商管理" columns={[]} queryKey={['pending-draft']} listQuery={async () => []}
        deleteApi={async () => null} deleteMessage="删除供应商" renderForm={() => <input aria-label="供应商名称" defaultValue="保留原输入" />}
        submitForm={() => saved} />
    </QueryClientProvider>,
  ))
  const button = (name: string) => [...document.querySelectorAll('button')].find(b => b.textContent === name)!
  await act(async () => button('+ 新建').click())
  await act(async () => button('创建').click())
  await act(async () => { await new Promise(r => setTimeout(r, 25)) })
  expect(button('取消').disabled).toBe(true)
  await act(async () => button('关闭').click())
  expect(document.querySelector('input[aria-label="供应商名称"]')).not.toBeNull()
  expect((document.querySelector('input[aria-label="供应商名称"]') as HTMLInputElement).value).toBe('保留原输入')
  await act(async () => resolve())
  expect(document.querySelector('input[aria-label="供应商名称"]')).toBeNull()
})

test('读取失败时不把记录总数显示为零', async () => {
  await act(async () => root.render(
    <QueryClientProvider client={queryClient}>
      <BaseCrudPage title="供应商管理" columns={[]} queryKey={['failed-count']} listQuery={async () => { throw Error('网络不可用') }}
        deleteApi={async () => null} deleteMessage="删除供应商" renderForm={() => null} submitForm={async () => null} />
    </QueryClientProvider>,
  ))
  await act(async () => { await new Promise(r => setTimeout(r, 25)) })
  expect(document.body.textContent).toContain('供应商管理加载失败')
  expect(document.body.textContent).not.toContain('共 0')
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
