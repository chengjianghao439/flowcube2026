// @vitest-environment jsdom
import { act, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { expect, test, vi } from 'vitest'
import AddressBookDialog from '@/pages/sale/components/AddressBookDialog'
import { useAuthStore } from '@/store/authStore'
const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  defaults: { baseURL: '/a' }
}))
vi.mock('@/api/client', () => ({
  default: { defaults: mocks.defaults },
  payloadClient: { get: mocks.get, post: mocks.post }
}))
vi.mock('@/lib/toast', () => ({ toast: { success: mocks.success, error: mocks.error, warning: vi.fn() } }))
vi.mock('@/hooks/usePermission', () => ({ usePermission: () => ({ can: () => true }) }))
vi.mock('@/components/shared/AppDialog', () => ({
  AppDialog: ({ open, children }: { open: boolean; children: ReactNode }) => (open ? <div>{children}</div> : null)
}))
const owner = { baseURL: '/a', userId: 5, sessionGeneration: 10 }
async function flush() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 5))
  })
}
async function click(host: HTMLElement, text: string) {
  const button = [...host.querySelectorAll('button')].find((b) => b.textContent === text)!
  expect(button).toBeTruthy()
  await act(async () => button.click())
  await flush()
}
async function change(host: HTMLElement, value: string) {
  const input = host.querySelector<HTMLTextAreaElement>('textarea[aria-label="详细收货地址"]')!
  expect(input).toBeTruthy()
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await flush()
}
test.each(['重开录入区未保存地址', '原录入区地址', '同次编辑后恢复原输入'])(
  'original address completion preserves reopened same-customer draft %s',
  async (newValue) => {
    vi.resetAllMocks()
    mocks.defaults.baseURL = '/a'
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    useAuthStore.setState({ token: 'fixture', user: { id: 5 } as never, sessionGeneration: 10 })
    mocks.get.mockResolvedValue([])
    let finish!: (v: unknown) => void
    mocks.post.mockImplementation(
      () =>
        new Promise((r) => {
          finish = r
        })
    )
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host),
      cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
    const render = async (open: boolean) => {
      await act(async () =>
        root.render(
          <QueryClientProvider client={cache}>
            <AddressBookDialog
              open={open}
              onOpenChange={() => {}}
              customerId={1}
              readOwner={owner}
              onSelect={() => {}}
            />
          </QueryClientProvider>
        )
      )
      await flush()
    }
    try {
      await render(true)
      await click(host, '新增地址')
      await change(host, '原录入区地址')
      await click(host, '保存地址')
      expect(mocks.post).toHaveBeenCalledTimes(1)
      if (newValue === '同次编辑后恢复原输入') {
        await change(host, '中途修改')
        await change(host, '原录入区地址')
      } else {
        await render(false)
        await render(true)
        await click(host, '新增地址')
        await change(host, newValue)
      }
      await act(async () => {
        finish(null)
        await new Promise((r) => setTimeout(r, 5))
      })
      await flush()
      const input = host.querySelector<HTMLTextAreaElement>('textarea[aria-label="详细收货地址"]')
      expect(input?.value).toBe(newValue === '同次编辑后恢复原输入' ? '原录入区地址' : newValue)
      expect(mocks.success).not.toHaveBeenCalledWith('已保存为常用地址')
      expect(mocks.post.mock.calls[0][2]).toMatchObject({
        baseURL: '/a',
        _authSessionGeneration: 10,
        _erpApiFallbackTried: true
      })
    } finally {
      act(() => root.unmount())
      cache.clear()
      host.remove()
    }
  }
)
