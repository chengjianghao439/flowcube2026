// @vitest-environment jsdom
import { act, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { TabPathContext } from '@/components/layout/TabPathContext'
import { SectionVisibilityContext } from '@/components/layout/SectionVisibilityContext'
import { useDirtyGuardStore } from '@/store/dirtyGuardStore'
import { SETTLEMENT_TYPE, type SettlementType } from '@/generated/status'
import { SettlementTypeField } from './SettlementTypeField'
import BaseCrudPage from './BaseCrudPage'

vi.mock('@/lib/toast', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

const tabPath = '/suppliers'
const row = { id: 1, name: '合成供应商' }
let host: HTMLDivElement
let root: ReturnType<typeof createRoot>
let queryClient: QueryClient

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  HTMLElement.prototype.scrollIntoView ??= () => {}
  vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(() => {})
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  useDirtyGuardStore.setState({ dirtyTabs: {}, pendingConfirm: null, bypassNextBlock: false })
})

afterEach(() => {
  // 同步卸载真实 Portal/FocusScope，避免超时的异步 act 留到下一个用例。
  try { act(() => root.unmount()) }
  finally {
    host.remove()
    queryClient.clear()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    useDirtyGuardStore.setState({ dirtyTabs: {}, pendingConfirm: null, bypassNextBlock: false })
  }
})

function FormFixture({ active = true, save = async () => {}, canCreate = true, canEdit = true, canDelete = true }: {
  active?: boolean
  save?: () => Promise<void>
  canCreate?: boolean
  canEdit?: boolean
  canDelete?: boolean
}) {
  const [settlementType, setType] = useState<SettlementType>(SETTLEMENT_TYPE.MONTHLY)
  const [days, setDays] = useState(30)
  return <QueryClientProvider client={queryClient}>
    <TabPathContext.Provider value={tabPath}>
      <SectionVisibilityContext.Provider value={active}>
        <BaseCrudPage title="供应商管理" columns={[{ key: 'name', title: '名称' }]}
          queryKey={['draft-review']} listQuery={async () => [row]}
          deleteApi={async () => null} deleteMessage="删除合成供应商"
          canCreate={canCreate} canEdit={canEdit} canDelete={canDelete}
          submitForm={save} renderForm={(_editing, _open, locked) => <SettlementTypeField side="payable"
            settlementType={settlementType} paymentTermsDays={days} disabled={locked}
            onChange={next => { setType(next.settlementType); setDays(next.paymentTermsDays) }} />}
        />
      </SectionVisibilityContext.Provider>
    </TabPathContext.Provider>
  </QueryClientProvider>
}

async function render(props: Parameters<typeof FormFixture>[0] = {}) {
  await act(async () => root.render(<FormFixture {...props} />))
  await waitUntil(() => host.textContent?.includes(row.name) === true, '列表完成读取')
}
async function waitUntil(check: () => boolean, message: string) {
  const deadline = performance.now() + 5000
  while (!check()) {
    if (performance.now() > deadline) throw new Error(`未等到${message}`)
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
  }
}
function button(name: string) {
  const element = [...document.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent === name)
  expect(element, `缺少 ${name} 按钮`).toBeDefined()
  return element!
}
async function click(name: string) { act(() => button(name).click()) }
function settlementTrigger() {
  return document.querySelector<HTMLButtonElement>('[role="combobox"]')!
}
async function chooseCash() {
  const trigger = settlementTrigger()
  expect(trigger).not.toBeNull()
  // Radix 的真实 BubbleInput 同步 Root value/onValueChange，再冒泡原生 change。
  // 不打开布局/焦点浮层，避免并行 JSDOM worker 等待未完成的 Select 布局任务。
  // 这里只验证真实选择器的值/脏合同；可见 Portal 的键盘交互另做 GUI 验收。
  const native = trigger.closest('form')?.querySelector<HTMLSelectElement>('select')
  expect(native).toBeInstanceOf(HTMLSelectElement)
  const setValue = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!
  act(() => {
    setValue.call(native, String(SETTLEMENT_TYPE.CASH))
    native!.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await waitUntil(() => settlementTrigger().textContent?.includes('现结') === true, 'Radix 选择现结')
  expect(settlementTrigger().textContent).toContain('现结')
}

test('只改真实 Radix 结算选择也标记当前 tab；取消确认后继续编辑保留选择', async () => {
  await render()
  await click('编辑')
  expect(useDirtyGuardStore.getState().isTabDirty(tabPath)).toBe(false)
  await chooseCash()
  await waitUntil(() => useDirtyGuardStore.getState().isTabDirty(tabPath), '选择变更注册脏状态')
  expect(useDirtyGuardStore.getState().isTabDirty(tabPath)).toBe(true)
  await click('取消')
  await waitUntil(() => document.body.textContent?.includes('放弃未保存输入？') === true, '放弃确认')
  expect(document.body.textContent).toContain('放弃未保存输入？')
  await click('继续编辑')
  expect(settlementTrigger().textContent).toContain('现结')
  expect(useDirtyGuardStore.getState().isTabDirty(tabPath)).toBe(true)
})

test('继续编辑在真实确认弹窗卸载后回到原字段，放弃不回已移除字段', async () => {
  await render()
  await click('编辑')
  await chooseCash()
  const original = settlementTrigger()
  act(() => original.focus())
  expect(document.activeElement).toBe(original)
  await click('取消')
  await waitUntil(() => document.body.textContent?.includes('放弃未保存输入？') === true, '放弃确认')
  await click('继续编辑')
  // Radix FocusScope 的卸载自动焦点事件在下一任务执行；等待该真实任务，
  // 再断言焦点，避免只验证立即调用 focus 后又被默认 BODY 恢复覆盖。
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
  expect(document.activeElement).toBe(original)
  expect(original.textContent).toContain('现结')
  await click('取消')
  await click('放弃并关闭')
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
  expect(original.isConnected).toBe(false)
  expect(document.activeElement).not.toBe(original)
})

test('隐藏页的 pending 成功保留原选择和弹窗，返回后核对关闭而非再提交', async () => {
  let resolve!: () => void
  const pending = new Promise<void>(done => { resolve = done })
  const save = vi.fn(() => pending)
  await render({ save })
  await click('编辑')
  await chooseCash()
  await click('保存修改')
  await waitUntil(() => button('取消').disabled, '保存进入 pending')
  await render({ save, active: false })
  await act(async () => resolve())
  await waitUntil(() => !useDirtyGuardStore.getState().isTabDirty(tabPath), '原保存成功注册')
  // 隐藏子视图由 useVisibleDisclosure 移除 Portal；返回后仍须呈现原操作。
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  await render({ save })
  await waitUntil(() => document.body.textContent?.includes('原操作已保存，请核对后关闭。') === true, '返回后的原保存结果')
  expect(document.querySelector('[role="dialog"]')).not.toBeNull()
  expect(settlementTrigger().textContent).toContain('现结')
  expect(settlementTrigger().disabled).toBe(true)
  expect(document.body.textContent).toContain('原操作已保存，请核对后关闭。')
  expect(useDirtyGuardStore.getState().isTabDirty(tabPath)).toBe(false)
  expect(button('保存修改').disabled).toBe(true)
  await click('关闭')
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  expect(save).toHaveBeenCalledTimes(1)
})

test('提交中 Escape、遮罩、取消与关闭均保留原草稿；失败解除锁后可继续编辑', async () => {
  let reject!: (error: Error) => void
  const pending = new Promise<void>((_done, fail) => { reject = fail })
  await render({ save: () => pending })
  await click('编辑')
  await chooseCash()
  await click('保存修改')
  await waitUntil(() => button('取消').disabled, '保存进入 pending')
  const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!
  const overlay = document.querySelector<HTMLElement>('[data-slot="dialog-overlay"]')
    ?? [...document.querySelectorAll<HTMLElement>('[data-state="open"]')].find(node => node.className.includes('fixed inset-0'))!
  expect(overlay).toBeDefined()
  await act(async () => dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
  await act(async () => {
    overlay.dispatchEvent(new MouseEvent('pointerdown', { button: 0, bubbles: true, cancelable: true }))
    overlay.click()
  })
  expect(button('取消').disabled).toBe(true)
  await click('取消')
  const close = document.querySelector<HTMLButtonElement>('button[aria-label="关闭弹窗"]')
    ?? [...dialog.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent === '关闭')!
  expect(close).toBeDefined()
  await act(async () => close.click())
  expect(document.querySelector('[role="dialog"]')).not.toBeNull()
  expect(settlementTrigger().textContent).toContain('现结')
  expect(useDirtyGuardStore.getState().isTabDirty(tabPath)).toBe(true)
  expect(settlementTrigger().disabled).toBe(true)
  await act(async () => reject(new Error('合成延迟失败')))
  await waitUntil(() => !settlementTrigger().disabled, '失败解除 pending')
  expect(settlementTrigger().disabled).toBe(false)
  expect(settlementTrigger().textContent).toContain('现结')
  expect(useDirtyGuardStore.getState().isTabDirty(tabPath)).toBe(true)
})

test.each([
  { canCreate: false, canEdit: false, canDelete: false, absent: ['+ 新建', '编辑', '删除'] },
  { canCreate: true, canEdit: false, canDelete: false, absent: ['编辑', '删除'] },
  { canCreate: false, canEdit: false, canDelete: true, absent: ['+ 新建', '编辑'] },
])('逐动作写权限限制入口 $canCreate/$canEdit/$canDelete', async ({ absent, ...permissions }) => {
  await render(permissions)
  for (const name of absent) expect([...host.querySelectorAll('button')].some(node => node.textContent === name)).toBe(false)
  expect(host.textContent).toContain(row.name)
  if (permissions.canDelete) expect(button('删除')).toBeDefined()
})
