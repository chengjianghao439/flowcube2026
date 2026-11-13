// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { focusManager, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { queryClient } from '@/lib/queryClient'
import { useInboundTaskDetail } from './useInboundTasks'
import { useCheckDetail } from './useStockCheck'
import { usePdaPendingAdjustments } from './usePdaAdjustment'
import { useSaleDetail } from './useSale'
import { usePurchaseDetail } from './usePurchase'

const api = vi.hoisted(() => ({ inbound: vi.fn(), check: vi.fn(), adjustment: vi.fn(), sale: vi.fn(), purchase: vi.fn() }))
vi.mock('@/api/inbound-tasks', async original => ({ ...await original<object>(), getInboundTaskByIdApi: api.inbound }))
vi.mock('@/api/stockcheck', async original => ({ ...await original<object>(), getCheckDetailApi: api.check }))
vi.mock('@/api/warehouse-tasks', async original => ({ ...await original<object>(), getPendingAdjustmentsApi: api.adjustment }))
vi.mock('@/api/sale', async original => ({ ...await original<object>(), getSaleDetailApi: api.sale }))
vi.mock('@/api/purchase', async original => ({ ...await original<object>(), getPurchaseDetailApi: api.purchase }))

let cache: QueryClient, root: ReturnType<typeof createRoot>, host: HTMLDivElement
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.resetAllMocks()
  focusManager.setFocused(true)
  cache = new QueryClient({ defaultOptions: queryClient.getDefaultOptions() })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); cache.clear(); focusManager.setFocused(undefined) })

function Desktop({ visible }: { visible: boolean }) {
  const inbound = useInboundTaskDetail(21, { visible })
  const check = useCheckDetail(22, visible)
  const sale = useSaleDetail(23, visible)
  return <><span>{inbound.data?.receivedQty}</span><span>{check.data?.statusName}</span><span>{sale.data?.statusName}</span><input aria-label="原草稿" defaultValue="留住输入" /></>
}
function Adjustments() {
  const { data } = usePdaPendingAdjustments()
  return <p>{data?.map(row => row.taskNo).join('、')}</p>
}
function Purchase({ visible }: { visible: boolean }) {
  const { data } = usePurchaseDetail(24, { visible })
  return <><span>{data?.inboundTasks?.[0]?.receiptStatus?.label}</span><input aria-label="原草稿" defaultValue="留住输入" /></>
}
async function draw(element: React.ReactNode) {
  await act(async () => root.render(<QueryClientProvider client={cache}>{element}</QueryClientProvider>))
}
async function waitForText(value: string) {
  await vi.waitFor(async () => {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
    expect(host.textContent).toContain(value)
  })
}

test('收货、盘点及销售详情在切回可见页时重新读取，并保留已输入内容', async () => {
  api.inbound.mockResolvedValue({ receivedQty: 0 })
  api.check.mockResolvedValue({ statusName: '盘点未录入' })
  api.sale.mockResolvedValue({ statusName: '改单待归还' })
  await draw(<Desktop visible />); await waitForText('盘点未录入')
  const draft = host.querySelector('input')!
  draft.value = '原输入 7'
  await draw(<Desktop visible={false} />)
  api.inbound.mockResolvedValue({ receivedQty: 4 })
  api.check.mockResolvedValue({ statusName: '实盘 7' })
  api.sale.mockResolvedValue({ statusName: '改单已确认' })
  expect(api.inbound).toHaveBeenCalledOnce(); expect(api.check).toHaveBeenCalledOnce(); expect(api.sale).toHaveBeenCalledOnce()
  await draw(<Desktop visible />); await waitForText('4实盘 7改单已确认')
  expect(host.querySelector('input')).toBe(draft)
  expect(draft.value).toBe('原输入 7')
})

test('浏览器从其他窗口切回时刷新可见交接数据', async () => {
  api.inbound.mockResolvedValue({ receivedQty: 0 }); api.check.mockResolvedValue({ statusName: '盘点未录入' }); api.sale.mockResolvedValue({ statusName: '改单待归还' })
  await draw(<Desktop visible />); await waitForText('盘点未录入')
  await act(async () => window.dispatchEvent(new Event('blur')))
  api.inbound.mockResolvedValue({ receivedQty: 4 }); api.check.mockResolvedValue({ statusName: '实盘 7' }); api.sale.mockResolvedValue({ statusName: '改单已确认' })
  await act(async () => window.dispatchEvent(new Event('focus')))
  await waitForText('4实盘 7改单已确认')
})

test('采购关联收货状态在切回工作区或窗口时重读并保留输入', async () => {
  const receipt = (label: string) => ({ inboundTasks: [{ receiptStatus: { label } }] })
  api.purchase.mockResolvedValue(receipt('待收货'))
  await draw(<Purchase visible />)
  await waitForText('待收货')
  const draft = host.querySelector('input')!
  draft.value = '原输入 7'

  await draw(<Purchase visible={false} />)
  api.purchase.mockResolvedValue(receipt('待上架'))
  await act(async () => window.dispatchEvent(new Event('focus')))
  expect(api.purchase).toHaveBeenCalledOnce()
  await draw(<Purchase visible />)
  await waitForText('待上架')

  api.purchase.mockResolvedValue(receipt('已上架'))
  await act(async () => window.dispatchEvent(new Event('focus')))
  await waitForText('已上架')
  expect(draft.value).toBe('原输入 7')
})

test('PDA 重新进入改单列表立即读取外部新增任务', async () => {
  api.adjustment.mockResolvedValue([])
  await draw(<Adjustments />)
  await vi.waitFor(() => expect(api.adjustment).toHaveBeenCalledOnce())
  await draw(null)
  api.adjustment.mockResolvedValue([{ adjustmentId: 1, taskNo: '合成待归还任务' }])
  await draw(<Adjustments />)
  await waitForText('合成待归还任务')
})
