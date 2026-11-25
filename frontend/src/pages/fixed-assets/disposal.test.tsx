// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { within } from '@testing-library/dom'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { AxiosError, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios'
import apiClient from '@/api/client'
import { toast } from '@/lib/toast'
import { useCompanyStore } from '@/store/companyStore'
import { useAuthStore } from '@/store/authStore'
import { PERMISSIONS as P } from '@/lib/permission-codes'
import FixedAssetsPage from './index'

vi.mock('@/lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const originalAdapter = apiClient.defaults.adapter
const assetA = { id: 7, assetNo: 'A-7', assetName: '资产 A', netBookValue: 65, accumDepr: 35, status: 1 }
const assetB = { id: 8, assetNo: 'B-8', assetName: '资产 B', netBookValue: 80, accumDepr: 20, status: 1 }
// Second company reuses the fixture row ID to also exercise company identity.
const assetC = { ...assetA, assetNo: 'C-7', assetName: '资产 C' }
const result = { id: 99, disposeNo: '处置夹具-99', netBook: 80, gain: -27.5 }

const reply = (config: InternalAxiosRequestConfig, data: unknown): AxiosResponse => (
  { config, status: 200, statusText: 'OK', headers: {}, data: { success: true, data } }
)

let host: HTMLDivElement
let root: Root
let queryClient: QueryClient
let user: ReturnType<typeof userEvent.setup>
let requests: InternalAxiosRequestConfig[]
let unexpected: string[]
let finish: () => void
let reject: (error: Error) => void

beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-18T16:05:00Z'))
  vi.clearAllMocks()
  useAuthStore.setState({ user: { id: 9, username: 'fixture', realName: '合成用户', roleId: 5, roleName: '合成角色', permissions: [P.ACCOUNTING_LEDGER_VIEW, P.ACCOUNTING_VOUCHER_MANAGE] } })
  useCompanyStore.getState().setCompany(1)
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  user = userEvent.setup()
  requests = []
  unexpected = []
  apiClient.defaults.adapter = async config => {
    const company = config.headers.get('X-Company-Id')
    if (config.method === 'get' && config.url === '/fixed-assets') {
      const list = company === '2' ? [assetC] : [assetA, assetB]
      return reply(config, { list, pagination: { total: list.length, page: 1, pageSize: 20 } })
    }
    if (config.method === 'post' && /^\/fixed-assets\/\d+\/dispose$/.test(config.url ?? '')) {
      requests.push(config)
      return new Promise((resolve, fail) => {
        finish = () => resolve(reply(config, result))
        reject = fail
      })
    }
    unexpected.push(`${config.method} ${config.url}`)
    throw new Error('意外的测试请求')
  }
  await act(async () => root.render(<QueryClientProvider client={queryClient}><FixedAssetsPage /></QueryClientProvider>))
  await act(async () => new Promise(resolve => setTimeout(resolve, 0)))
})

afterEach(async () => {
  await act(async () => root.unmount())
  queryClient.clear()
  host.remove()
  useCompanyStore.getState().setCompany(1)
  apiClient.defaults.adapter = originalAdapter
  useAuthStore.setState({ user: null })
  localStorage.clear()
  vi.useRealTimers()
  expect(unexpected).toEqual([])
})

const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]')
const fields = () => {
  const form = within(dialog()!)
  return {
    income: form.getByRole<HTMLInputElement>('spinbutton', { name: '处置收入' }),
    expense: form.getByRole<HTMLInputElement>('spinbutton', { name: '清理费用' }),
    date: form.getByRole<HTMLInputElement>('textbox', { name: '处置日期' }),
  }
}
const button = (name: string) => within(dialog()!).getByRole('button', { name })
const click = async (name: string) => act(async () => user.click(button(name)))
const escape = async () => act(async () => user.keyboard('{Escape}'))

async function openAsset(name: string) {
  const findRow = () => within(host).getByRole('row', { name: new RegExp(name) })
  await vi.waitFor(findRow)
  await act(async () => user.click(within(findRow()).getByRole('button', { name: '处置' })))
  expect(within(dialog()!).getByRole('heading').textContent).toContain(name)
}

async function fillDisposal(income: string, expense: string, date: string) {
  await act(async () => {
    await user.type(fields().income, income)
    await user.type(fields().expense, expense)
    await user.clear(fields().date)
    await user.type(fields().date, date)
    await user.keyboard('{Enter}')
  })
  expect(fields().income.value).toBe(income)
  expect(fields().expense.value).toBe(expense)
  expect(fields().date.value).toBe(date)
}

test('取消资产 A 后直接确认资产 B 发送 B 的默认金额和当天日期', async () => {
  await openAsset(assetA.assetName)
  await fillDisposal('374.52', '18.25', '2026-11-13')
  await click('取消')
  expect(dialog()).toBeNull()
  await openAsset(assetB.assetName)
  await click('确认处置')
  expect(requests).toHaveLength(1)
  expect(requests[0].url).toBe('/fixed-assets/8/dispose')
  expect(requests[0].headers.get('X-Company-Id')).toBe('1')
  expect(JSON.parse(requests[0].data)).toEqual({ disposeType: 1, disposeDate: '2026-11-19', income: 0, expense: 0 })
  await act(async () => finish())
})

test('资产 B 的最终确认金额与日期进入自己的处置请求', async () => {
  await openAsset(assetA.assetName)
  await fillDisposal('374.52', '18.25', '2026-11-13')
  await click('取消')
  await openAsset(assetB.assetName)
  expect(fields().income.value).toBe('')
  expect(fields().expense.value).toBe('')
  expect(fields().date.value).toBe('2026-11-19')
  await fillDisposal('112.35', '4.85', '2026-11-18')
  await click('确认处置')
  expect(requests).toHaveLength(1)
  expect(requests[0].url).toBe('/fixed-assets/8/dispose')
  expect(JSON.parse(requests[0].data)).toEqual({ disposeType: 1, disposeDate: '2026-11-18', income: 112.35, expense: 4.85 })
  await act(async () => finish())
  await vi.waitFor(() => expect(dialog()).toBeNull())
})

test.each(['取消', '关闭', 'Escape', '点击遮罩'])('保存中使用%s保留当前处置表单', async closeMethod => {
  await openAsset(assetA.assetName)
  await fillDisposal('374.52', '18.25', '2026-11-13')
  await click('确认处置')
  await vi.waitFor(() => expect(button('处置中…')).toBeDefined())
  if (closeMethod === 'Escape') await escape()
  else if (closeMethod === '点击遮罩') {
    const overlay = document.querySelector<HTMLElement>('.fc-dialog-overlay')!
    await act(async () => {
      overlay.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }))
      overlay.click()
    })
  } else await click(closeMethod)
  expect(dialog()).toBeTruthy()
  expect(fields().income.value).toBe('374.52')
  expect(requests).toHaveLength(1)
  await act(async () => finish())
  await vi.waitFor(() => expect(dialog()).toBeNull())
})

test('同一轮连续确认只发起一次处置', async () => {
  await openAsset(assetA.assetName)
  const confirm = button('确认处置')
  await act(async () => {
    confirm.click()
    confirm.click()
  })
  expect(requests).toHaveLength(1)
  await act(async () => finish())
})

test('失败保留本轮输入，随后可以用相同值重试', async () => {
  await openAsset(assetA.assetName)
  await fillDisposal('374.52', '18.25', '2026-11-13')
  await click('确认处置')
  await vi.waitFor(() => expect(requests).toHaveLength(1))
  const response = { ...reply(requests[0], null), status: 400, data: { message: '夹具保存失败' } }
  await act(async () => reject(new AxiosError('夹具保存失败', 'ERR_BAD_REQUEST', requests[0], undefined, response)))
  await vi.waitFor(() => expect(button('确认处置').hasAttribute('disabled')).toBe(false))
  expect(toast.error).toHaveBeenCalledExactlyOnceWith('夹具保存失败')
  expect(fields().income.value).toBe('374.52')
  await click('确认处置')
  expect(requests).toHaveLength(2)
  expect(requests[1].data).toBe(requests[0].data)
  await act(async () => finish())
})

test('旧账套保存晚到，切回同账套同资产也不会关闭新一轮表单', async () => {
  await openAsset(assetA.assetName)
  await fillDisposal('374.52', '18.25', '2026-11-13')
  await click('确认处置')
  await vi.waitFor(() => expect(requests).toHaveLength(1))
  await act(async () => useCompanyStore.getState().setCompany(2))
  expect(dialog()).toBeNull()
  await openAsset(assetC.assetName)
  expect(fields().income.value).toBe('')
  await act(async () => useCompanyStore.getState().setCompany(1))
  expect(dialog()).toBeNull()
  await openAsset(assetA.assetName)
  await fillDisposal('59.26', '1.45', '2026-11-18')
  await act(async () => finish())
  expect(dialog()?.textContent).toContain(assetA.assetName)
  expect(fields().income.value).toBe('59.26')
  expect(toast.success).not.toHaveBeenCalled()
  expect(toast.error).not.toHaveBeenCalled()
})
