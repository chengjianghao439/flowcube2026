// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import CheckDetailDialog from './CheckDetailDialog'
import { useDirtyGuardStore } from '@/store/dirtyGuardStore'
import type { StockCheck } from '@/types/stockcheck'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const f = vi.hoisted(() => ({
  error: new Error('另有 5 件正被拣货任务占用'),
  save: vi.fn<(payload: unknown) => Promise<unknown>>(async () => { throw f.error }),
  submit: vi.fn(async () => { throw f.error }),
  refresh: vi.fn(async () => { throw f.error }),
  cancel: vi.fn(async () => { throw f.error }),
  toastError: vi.fn(),
  closed: vi.fn(),
  readError: null as unknown,
  refetch: vi.fn(),
  check: undefined as StockCheck | undefined,
}))
vi.mock('@/hooks/useStockCheck', () => ({
  useCheckDetail: () => ({ data: f.check, isLoading: false, error: f.readError, refetch: f.refetch }),
  useUpdateCheckItems: () => ({ mutateAsync: f.save, isPending: false }),
  useSubmitCheck: () => ({ mutateAsync: f.submit, isPending: false }),
  useRefreshCheckItem: () => ({ mutateAsync: f.refresh, isPending: false }),
  useCancelCheck: () => ({ mutateAsync: f.cancel, isPending: false }),
}))
vi.mock('@/hooks/useProductQtyPolicies', () => ({ useProductQtyPolicies: () => () => false }))
vi.mock('@/components/shared/OrderDetailSections', () => ({ OrderDetailSections: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }))
vi.mock('@/components/ui/dialog', () => ({ Dialog: ({ children }: { children: React.ReactNode }) => <div>{children}</div>, DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>, DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>, DialogTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>, DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }))
vi.mock('@/components/shared/ConfirmDialog', () => ({ ConfirmDialog: ({ open, title, onConfirm }: { open: boolean; title: string; onConfirm: () => void }) => open ? <button onClick={onConfirm}>{title}</button> : null }))
vi.mock('@/lib/toast', () => ({ toast: { error: f.toastError, success: vi.fn(), warning: vi.fn() } }))

const hosts: HTMLDivElement[] = []
beforeEach(() => {
  f.readError = null
  f.check = { id: 1, checkNo: 'CK001', warehouseId: 1, checkType: 1, scopeType: null, scopeValue: null, status: 1, statusName: '盘点中', warehouseName: '测试仓', operatorId: 1, operatorName: '测试员', createdAt: '2026-10-15', items: [{ id: 11, productId: 1, productCode: 'P001', productName: '测试品', bookQty: 5, actualQty: 3, diffQty: -2, unit: '个', scanDriven: false }] }
  useDirtyGuardStore.setState({ pendingConfirm: null })
})
afterEach(() => { hosts.splice(0).forEach(h => h.remove()); vi.clearAllMocks(); useDirtyGuardStore.setState({ pendingConfirm: null }) })
async function mount() {
  const host = document.createElement('div'); document.body.append(host); hosts.push(host)
  const root = createRoot(host)
  const draw = async (checkId: number | null = 1) => { await act(async () => root.render(<CheckDetailDialog open={checkId !== null} onClose={f.closed} checkId={checkId} />)) }
  await draw()
  const click = async (name: string) => {
    const button = Array.from(host.querySelectorAll('button')).find(b => b.textContent === name)!
    expect(button, name).toBeTruthy()
    await act(async () => button.click())
  }
  const input = async (value: string) => {
    const field = host.querySelector<HTMLInputElement>('input[aria-label="测试品实盘数量"]')!
    expect(field).toBeTruthy()
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, value)
      field.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }
  return { host, root, click, draw, input }
}

it('保存和刷新失败显示业务原因，输入和详情保持可重试', async () => {
  const { host, root, click } = await mount()
  await click('保存实盘数')
  expect(f.toastError).toHaveBeenCalledWith(f.error.message)
  expect(host.querySelector<HTMLInputElement>('input[aria-label="测试品实盘数量"]')?.value).toBe('3')
  f.toastError.mockClear()
  await click('刷新账面')
  expect(f.toastError).toHaveBeenCalledWith(f.error.message)
  expect(f.closed).not.toHaveBeenCalled()
  await act(async () => root.unmount())
})

it('提交和取消失败不会关闭弹窗，并能再次操作', async () => {
  const { host, root, click } = await mount()
  await click('提交盘点')
  await click('确认提交盘点')
  expect(f.toastError).toHaveBeenCalledWith(f.error.message)
  expect(host.querySelector<HTMLInputElement>('input[aria-label="测试品实盘数量"]')?.value).toBe('3')
  f.toastError.mockClear()
  await click('取消盘点')
  await act(async () => Array.from(host.querySelectorAll('button')).filter(b => b.textContent === '取消盘点').at(-1)!.click())
  expect(f.toastError).toHaveBeenCalledWith(f.error.message)
  expect(f.closed).not.toHaveBeenCalled()
  await act(async () => root.unmount())
})

it('未知技术错误显示可理解的恢复提示', async () => {
  const previous = f.error
  f.error = new Error('Network Error')
  try {
    const { root, click } = await mount()
    await click('保存实盘数')
    expect(f.toastError).toHaveBeenCalledWith('操作失败，请检查网络后重试')
    await act(async () => root.unmount())
  } finally {
    f.error = previous
  }
})

it.each([403, 404, 503])('首次详情GET失败%s提供重试，不显示空白成功或写入口', async status => {
  f.check = undefined
  f.readError = { status, response: { status, data: { message: '受控读取失败' } } }
  const { host, root, click } = await mount()
  try {
    expect(host.textContent).toMatch(/读取失败|无权|不存在/)
    expect(host.textContent).not.toContain('保存实盘数')
    await click('重试')
    expect(f.refetch).toHaveBeenCalledTimes(1)
    expect(f.save).not.toHaveBeenCalled()
  } finally { await act(async () => root.unmount()) }
})

it.each([403, 404, 503])('已读详情后GET失败%s隐藏旧明细及写入口，保留实盘草稿与关闭保护', async status => {
  const { host, root, click, draw, input } = await mount()
  try {
    await input('4')
    await click('提交盘点')
    expect(host.textContent).toContain('确认提交盘点')
    f.readError = { status, response: { status } }
    await draw()
    expect(host.textContent).not.toContain('CK001')
    expect(host.querySelector('input')).toBeNull()
    expect(host.textContent).not.toContain('保存实盘数')
    expect(host.textContent).not.toContain('确认提交盘点')
    await click('关闭')
    expect(f.closed).not.toHaveBeenCalled()
    expect(useDirtyGuardStore.getState().pendingConfirm).not.toBeNull()
    act(() => useDirtyGuardStore.getState().resolveConfirm(false))
    f.readError = null
    f.check = { ...f.check!, items: f.check!.items!.map(item => ({ ...item, actualQty: 2 })) }
    await draw()
    expect(host.querySelector<HTMLInputElement>('input')?.value).toBe('4')
    await click('保存实盘数')
    expect(f.save).toHaveBeenCalledWith({ id: 1, items: [{ id: 11, actualQty: 4 }] })
    expect(f.submit).not.toHaveBeenCalled()
  } finally { await act(async () => root.unmount()) }
})

it('同单成功后台刷新不覆盖未保存输入，切换盘点单重新建立自身基线', async () => {
  const { host, root, draw, input } = await mount()
  try {
    await input('4')
    f.check = { ...f.check!, items: f.check!.items!.map(item => ({ ...item, actualQty: 2 })) }
    await draw()
    expect(host.querySelector<HTMLInputElement>('input')?.value).toBe('4')
    f.check = { ...f.check, id: 2, checkNo: 'CK002' }
    await draw(2)
    expect(host.textContent).toContain('CK002')
    expect(host.querySelector<HTMLInputElement>('input')?.value).toBe('2')
  } finally { await act(async () => root.unmount()) }
})

it('确认放弃草稿并关闭后，重新打开同单采用服务端实盘数', async () => {
  const { host, root, draw, input, click } = await mount()
  try {
    await input('4')
    await click('关闭')
    expect(f.closed).not.toHaveBeenCalled()
    act(() => useDirtyGuardStore.getState().resolveConfirm(true))
    expect(f.closed).toHaveBeenCalledTimes(1)
    await draw(null)
    await draw()
    expect(host.querySelector<HTMLInputElement>('input')?.value).toBe('3')
  } finally { await act(async () => root.unmount()) }
})

it('保存成功只更新本次已保存基线，保存期间新输入仍有关闭保护', async () => {
  let finish: (() => void) | undefined
  f.save.mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve(undefined) }))
  const { host, root, input, click } = await mount()
  try {
    await input('4')
    await click('保存实盘数')
    await input('5')
    await act(async () => finish!())
    expect(host.querySelector<HTMLInputElement>('input')?.value).toBe('5')
    expect(f.save).toHaveBeenCalledWith({ id: 1, items: [{ id: 11, actualQty: 4 }] })
    await click('关闭')
    expect(f.closed).not.toHaveBeenCalled()
    expect(useDirtyGuardStore.getState().pendingConfirm).not.toBeNull()
  } finally { await act(async () => root.unmount()) }
})

it('未填写保持NULL语义，明确0可保存，PDA扫码行不进入手填载荷', async () => {
  f.check = { ...f.check!, items: [
    { ...f.check!.items![0], actualQty: null },
    { ...f.check!.items![0], id: 12, productId: 2, scanDriven: true, actualQty: 2, scannedContainerCount: 1 },
  ] }
  const { root, input, click } = await mount()
  try {
    await click('保存实盘数')
    expect(f.save).not.toHaveBeenCalled()
    await input('0')
    await click('保存实盘数')
    expect(f.save).toHaveBeenCalledWith({ id: 1, items: [{ id: 11, actualQty: 0 }] })
  } finally { await act(async () => root.unmount()) }
})

it('保存期间改回旧基线，保存后的GET先返回也不能覆盖新输入', async () => {
  let finish: (() => void) | undefined
  f.save.mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve(undefined) }))
  const { host, root, input, click, draw } = await mount()
  try {
    await input('4')
    await click('保存实盘数')
    await input('3')
    // 真实hook先等待invalidateQueries/refetch，再完成mutateAsync。
    f.check = { ...f.check!, items: f.check!.items!.map(item => ({ ...item, actualQty: 4 })) }
    await draw()
    await act(async () => finish!())
    expect(f.save).toHaveBeenCalledWith({ id: 1, items: [{ id: 11, actualQty: 4 }] })
    expect(host.querySelector<HTMLInputElement>('input')?.value).toBe('3')
    await click('关闭')
    expect(f.closed).not.toHaveBeenCalled()
    expect(useDirtyGuardStore.getState().pendingConfirm).not.toBeNull()
  } finally { await act(async () => root.unmount()) }
})

it('同单结束后只读实盘与差异同取服务端事实，不混入未保存草稿', async () => {
  const { host, root, input, draw } = await mount()
  try {
    await input('4')
    f.check = { ...f.check!, status: 2, statusName: '已完成', items: f.check!.items!.map(item => ({ ...item, actualQty: 3, diffQty: -2 })) }
    await draw()
    expect(host.querySelector('input')).toBeNull()
    expect(host.textContent).toContain('-2.00')
    expect(host.textContent).not.toContain('-1.00')
  } finally { await act(async () => root.unmount()) }
})
