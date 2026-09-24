// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import CheckDetailDialog from './CheckDetailDialog'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const f = vi.hoisted(() => ({
  error: new Error('另有 5 件正被拣货任务占用'),
  save: vi.fn(async () => { throw f.error }),
  submit: vi.fn(async () => { throw f.error }),
  refresh: vi.fn(async () => { throw f.error }),
  cancel: vi.fn(async () => { throw f.error }),
  toastError: vi.fn(),
  closed: vi.fn(),
  check: { id: 1, checkNo: 'CK001', status: 1, statusName: '盘点中', warehouseName: '测试仓', operatorName: '测试员', items: [{ id: 11, productId: 1, productName: '测试品', bookQty: 5, actualQty: 3, unit: '个', scanDriven: false }] },
}))
vi.mock('@/hooks/useStockCheck', () => ({
  useCheckDetail: () => ({ data: f.check, isLoading: false }),
  useUpdateCheckItems: () => ({ mutateAsync: f.save, isPending: false }),
  useSubmitCheck: () => ({ mutateAsync: f.submit, isPending: false }),
  useRefreshCheckItem: () => ({ mutateAsync: f.refresh, isPending: false }),
  useCancelCheck: () => ({ mutateAsync: f.cancel, isPending: false }),
}))
vi.mock('@/hooks/useProductQtyPolicies', () => ({ useProductQtyPolicies: () => () => false }))
vi.mock('@/components/shared/OrderDetailSections', () => ({ OrderDetailSections: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }))
vi.mock('@/components/shared/ProductIdentityCells', () => ({ ProductIdentityGridCells: () => <div>测试品</div>, ProductIdentityGridHeaders: () => <div>商品</div> }))
vi.mock('@/components/ui/dialog', () => ({ Dialog: ({ children }: { children: React.ReactNode }) => <div>{children}</div>, DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>, DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>, DialogTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>, DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }))
vi.mock('@/components/shared/ConfirmDialog', () => ({ ConfirmDialog: ({ open, title, onConfirm }: { open: boolean; title: string; onConfirm: () => void }) => open ? <button onClick={onConfirm}>{title}</button> : null }))
vi.mock('@/lib/toast', () => ({ toast: { error: f.toastError, success: vi.fn(), warning: vi.fn() } }))

const hosts: HTMLDivElement[] = []
afterEach(() => { hosts.splice(0).forEach(h => h.remove()); vi.clearAllMocks() })
async function mount() {
  const host = document.createElement('div'); document.body.append(host); hosts.push(host)
  const root = createRoot(host)
  await act(async () => root.render(<CheckDetailDialog open onClose={f.closed} checkId={1} />))
  const click = async (name: string) => {
    const button = Array.from(host.querySelectorAll('button')).find(b => b.textContent === name)!
    expect(button, name).toBeTruthy()
    await act(async () => button.click())
  }
  return { host, root, click }
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
