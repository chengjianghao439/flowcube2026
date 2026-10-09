// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, expect, test, vi } from 'vitest'
import CommercialSalePage from './CommercialSalePage'
import type { SaleOrder } from '@/types/sale'
import type { CommercialGroup } from '@/types/sale-commercial'
import { useAuthStore } from '@/store/authStore'
import { PERMISSIONS } from '@/lib/permission-codes'
import { useWorkspaceStore, HOME_TAB } from '@/store/workspaceStore'
import { useSectionActive } from '@/components/layout/SectionVisibilityContext'
const mocks = vi.hoisted(() => ({ query: vi.fn(), execute: vi.fn(), get: vi.fn(), activity: vi.fn(), defaults: { baseURL: '/a' } }))
vi.mock('@/api/client', () => ({ default: { defaults: mocks.defaults }, getApiClientBaseURL: () => mocks.defaults.baseURL, subscribeApiClientBaseURL: () => () => {} }))
vi.mock('@/api/operation-requests', () => ({ getOperationRequestStatusApi: mocks.query }))
vi.mock('@/api/document-activity', () => ({ getDocumentActivityApi: mocks.activity }))
vi.mock('@/api/sale-commercial', () => ({ executeCommercialSaleApi: mocks.execute, getCommercialSaleApi: mocks.get }))
vi.mock('./CommercialFulfillmentSummary', () => ({ default: function ArrangementFixture() {
  const active = useSectionActive()
  return <div data-arrangement-active={String(active)}>真实供货分配<input aria-label="未保存的发货安排" /></div>
} }))
vi.mock('../form/components/SaleOrderOverview', () => ({ SaleOrderOverview: () => <p>原销售概览</p> }))
vi.mock('../form/components/FulfillmentProgressCard', () => ({ FulfillmentProgressCard: () => <p>原任务归还入口</p> }))
vi.mock('@/components/print/SaleOrderPrintTemplate', () => ({ PrintPreviewOverlay: () => <p>客户预览</p> }))
function CurrentRoute() { const location = useLocation(); return <output data-route>{location.pathname + location.search}</output> }
const owner = { baseURL: '/a', userId: 5, sessionGeneration: 10 }
const group = {
  id: 8,
  lineKey: 'A',
  kind: 'kit',
  kitVersionId: 19,
  kitCode: 'KA',
  kitName: '套A',
  warehouseId: 1,
  originalQty: 2,
  targetQty: 2,
  unitPrice: 100,
  amount: 200,
  originalAmount: 200,
  metadata: { input: { kind: 'kit' }, entry: null },
  components: [],
  dispatch: { confirmedShippedQty: 1, outstandingQty: 0, activeAllocatedQty: 1, availableQty: 1, facts: [] }
} as unknown as CommercialGroup
const order = {
  id: 80,
  orderNo: 'SO80',
  customerId: 1,
  customerName: '测试',
  warehouseId: 1,
  warehouseName: '仓一',
  commercialModel: 'kit-v1',
  commercialRevision: 4,
  status: 3,
  statusName: '执行中',
  totalAmount: 200,
  commercialGroups: [group],
  commercialDispatches: [
    {
      dispatchGroupId: 1,
      groupId: 8,
      taskId: 90,
      taskNo: 'WT-A',
      warehouseId: 1,
      taskStatus: 7,
      quantity: 1,
      active: true,
      confirmedShipped: true,
      outstanding: false,
      allocated: true
    },
    {
      dispatchGroupId: 2,
      groupId: 7,
      taskId: 90,
      taskNo: 'WT-OLD',
      warehouseId: 1,
      taskStatus: 7,
      quantity: 1,
      active: false,
      confirmedShipped: false,
      outstanding: false,
      allocated: false
    }
  ],
  items: [],
  tasks: [],
  createdAt: '2026-10-01'
} as unknown as SaleOrder
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  localStorage.clear(); sessionStorage.clear()
  vi.resetAllMocks()
  mocks.defaults.baseURL = '/a'
  mocks.query.mockResolvedValue({ status: 'not_found', data: null })
  mocks.execute.mockResolvedValue({ tasks: [] })
  mocks.get.mockResolvedValue(order)
  mocks.activity.mockResolvedValue({ status: '草稿', sections: [], events: [], historyNote: '历史记录可能不完整' })
  useAuthStore.getState().logout()
  useAuthStore.setState({
    token: 'test-only',
    sessionGeneration: 10,
    user: {
      id: 5,
      username: 'fixture',
      realName: '测试',
      roleId: 5,
      roleName: '测试',
      permissions: [PERMISSIONS.SALE_ORDER_SHIP, PERMISSIONS.SALE_ORDER_CANCEL, PERMISSIONS.SALE_ORDER_VIEW]
    }
  })
})
async function flush() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 3))
  })
}
async function click(label: string) {
  const b = Array.from(document.querySelectorAll('button')).find((b) => b.textContent === label)
  expect(b, label).toBeTruthy()
  await act(async () => b!.click())
  await flush()
}
async function mount(run: (host: HTMLElement) => Promise<void>, input = order, onClose = () => {}) {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host),
    cache = new QueryClient()
  try {
    await act(async () =>
      root.render(
        <QueryClientProvider client={cache}>
          <MemoryRouter><CurrentRoute />
            <CommercialSalePage initial={input} owner={owner} tabPath="/sale/80" onClose={onClose} />
          </MemoryRouter>
        </QueryClientProvider>
      )
    )
    await run(host)
  } finally {
    await act(async () => { root.unmount(); await new Promise<void>(resolve => setTimeout(resolve, 0)) })
    cache.clear()
    host.remove()
  }
}
test('混合详情沿普通订单六标签与基础信息布局，成交量价独立于仓库组件合计', async () => {
  const ordinary = { ...group, id: 9, kind: 'ordinary', kitCode: null, kitName: null,
    targetQty: 1.25, originalQty: 2, amount: 28.75, originalAmount: 46, unitPrice: 23,
    metadata: { input: { kind: 'ordinary', productId: 3, remark: '按长度分装' }, entry: { entryUnit: '米', entryQty: 2, conversionRate: 1, entryUnitPrice: 23 } },
    components: [{ productId: 3, productCode: 'P-LONG', productName: '长商品名称完整值', spec: '完整规格', color: '本色', articleNumber: '供应商型号', unit: '米', baseQty: 1, quantity: 1.25, amount: 28.75, allocatedAmount: 46 }]
  } as unknown as CommercialGroup
  await mount(async host => {
    expect([...host.querySelectorAll('button[aria-pressed]')].map(button => button.textContent)).toEqual(['订单信息', '发货安排', '作业进度', '拣货明细', '装箱进度', '操作记录'])
    expect(host.textContent).toContain('基础信息')
    expect([...host.querySelectorAll('button')].some(b => b.textContent === '读取最新订单' || b.textContent === '刷新订单')).toBe(false)
    expect(host.textContent).toContain('收货人：验收收货人')
    expect(host.textContent).toContain('备注：保留原备注')
    const table = host.querySelector('[data-sale-detail-items] table')!
    expect([...table.querySelectorAll('th')].map(th => th.textContent?.replace(/调整.*列宽/g, ''))).toEqual(['商品', '单位', '数量', '单价', '金额', '备注'])
    for (const fact of ['套A', '成套', 'P-LONG', '长商品名称完整值', '完整规格', '供应商型号', '本色', '1.25', '¥28.75']) expect(table.textContent).toContain(fact)
    expect(host.querySelector('[data-sale-detail-items]')?.textContent).toContain('订单金额¥223.75')
    expect(host.textContent).not.toContain('999.00')
    expect(host.textContent).not.toContain('真实供货分配')
    expect(host.querySelector('[data-sale-detail-items] details')).toBeNull()
    expect(table.textContent).not.toContain('成交依据')
    expect(table.textContent).toContain('按长度分装')
    expect([...table.querySelectorAll('[data-table-text]')].some(node => node.textContent === '按长度分装')).toBe(true)
    expect(mocks.execute).not.toHaveBeenCalled()
  }, { ...order, commercialGroups: [group, ordinary], totalAmount: 228.75, discountAmount: 5,
    receiverName: '验收收货人', remark: '保留原备注', items: [{ id: 1, productName: '仓库组件', amount: 999 }] } as SaleOrder)
})
test('混合详情标签按需挂载、隐藏暂停，返回保留安排输入与原发货记录', async () => {
  await mount(async host => {
    await click('发货安排')
    const input = host.querySelector<HTMLInputElement>('input[aria-label="未保存的发货安排"]')!
    input.value = '保留客户约定'
    await click('作业进度')
    expect(input.closest('[hidden]')).not.toBeNull()
    expect(input.parentElement?.getAttribute('data-arrangement-active')).toBe('false')
    const rows = [...host.querySelectorAll('[data-sale-batches] tbody tr')]
    for (const text of ['WT-A', '套A', '1套', '仓一', '已出库', '已确认实发']) expect(rows[0].textContent).toContain(text)
    expect(rows[0].textContent).not.toContain('未确认')
    for (const text of ['WT-OLD', '原成交行 #7', '仓一', '已出库', '原批次（未确认）', '已撤销批次']) expect(rows[1].textContent).toContain(text)
    await click('发货安排')
    expect(input.value).toBe('保留客户约定')
    expect(input.closest('[hidden]')).toBeNull()
    expect(mocks.execute).not.toHaveBeenCalled()
  })
})
test('成套详情直接显示独立父子商品行，子行按套数展开但不重复显示价格金额', async () => {
  const components = [
    { productId: 11, productCode: 'P11', productName: '共享铰链', spec: 'M12', color: '银色', articleNumber: 'ART11', unit: '个', baseQty: 2, quantity: 999, amount: 123 },
    { productId: 12, productCode: 'P12', productName: '螺钉', unit: '个', baseQty: 4, amount: 77 },
  ]
  await mount(async host => {
    const parents = [...host.querySelectorAll('[data-sale-kit-line="parent"]')].map(e => e.closest('tr')!)
    const children = [...host.querySelectorAll('[data-sale-kit-line="component"]')].map(e => e.closest('tr')!)
    expect(parents).toHaveLength(2)
    expect(children).toHaveLength(4)
    expect(parents[0].cells[2].textContent).toBe('3')
    expect(parents[0].cells[3].textContent).toBe('¥100.00')
    expect(parents[0].cells[4].textContent).toBe('¥300.00')
    expect(children.map(row => row.cells[2].textContent)).toEqual(['6', '12', '2', '4'])
    for (const child of children) {
      expect(child.cells[3].textContent).toBe('—'); expect(child.cells[4].textContent).toBe('—')
    }
    expect(children[0].cells[0].textContent).toContain('型号 M12 · 颜色 银色 · 供应商型号 ART11')
    expect(host.querySelector('[data-sale-detail-items]')?.textContent).toContain('订单金额¥400.00')
    expect(mocks.execute).not.toHaveBeenCalled()
  }, { ...order, totalAmount: 400, commercialGroups: [{ ...group, targetQty: 3, amount: 300, components }, { ...group, id: 10, lineKey: 'B', kitName: '套B', targetQty: 1, amount: 100, components }] } as SaleOrder)
})
test('混合详情没有明细、装箱或记录时给出对应空态，切标签不发写请求', async () => {
  await mount(async host => {
    expect(host.textContent).toContain('暂无商品明细')
    await click('装箱进度'); expect(host.textContent).toContain('暂无装箱记录')
    await click('操作记录'); expect(host.textContent).toContain('暂无操作记录')
    expect(mocks.execute).not.toHaveBeenCalled()
  }, { ...order, commercialGroups: [], packages: [], timeline: [] })
})
test('commercial bridge keeps confirmed vs inactive unconfirmed WT7 distinct; actions use source permission', async () => {
  await mount(async (host) => {
    await click('作业进度')
    const rows = [...host.querySelectorAll('[data-sale-batches] tbody tr')]
    for (const text of ['WT-A', '套A', '1套', '仓一', '已出库', '已确认实发']) expect(rows[0].textContent).toContain(text)
    expect(rows[0].textContent).not.toContain('未确认')
    for (const text of ['WT-OLD', '原成交行 #7', '仓一', '已出库', '原批次（未确认）', '已撤销批次']) expect(rows[1].textContent).toContain(text)
    expect(host.textContent).not.toContain('编辑订单')
    expect(host.textContent).not.toContain('整单占库')
    expect(host.textContent).toContain('关闭剩余未发')
  })
})
test('mounted ship selection rejects fractional kits and submits commercial group/revision under original identity', async () => {
  await mount(async () => {
    await click('继续发货')
    const input = document.querySelector<HTMLInputElement>('input[aria-label="套A本批数量"]')!
    async function change(value: string) {
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
        input.dispatchEvent(new Event('input', { bubbles: true }))
      })
    }
    await change('0.8')
    expect(
      Array.from(document.querySelectorAll('button')).find((b) => b.textContent === '确认发起出库')!.disabled
    ).toBe(true)
    await change('1')
    await click('确认发起出库')
    expect(mocks.execute.mock.calls[0][0].operation).toEqual({
      action: 'ship',
      id: 80,
      body: { commercialModel: 'kit-v1', expectedRevision: 4, groups: [{ groupId: 8, qty: 1 }] }
    })
  })
})
test('returning task blocks dispatch/cancel without claiming reservation released', async () => {
  await mount(
    async (host) => {
      expect(host.textContent).toContain('不视为预占释放')
      expect(Array.from(host.querySelectorAll('button')).find((b) => b.textContent === '继续发货')!.disabled).toBe(
        true
      )
    },
    { ...order, warehouseTaskCancelRequestedAt: '2026-10-01' }
  )
})
test('confirmed original retry safely rereads changed revision/dispatch allowance after mounted unknown', async () => {
  mocks.execute.mockRejectedValueOnce({ status: 408 }).mockResolvedValueOnce(null)
  mocks.get.mockResolvedValue({
    ...order,
    commercialRevision: 5,
    commercialGroups: [{ ...group, dispatch: { ...group.dispatch, availableQty: 0, outstandingQty: 1 } }]
  })
  await mount(async (host) => {
    await click('继续发货')
    const input = document.querySelector<HTMLInputElement>('input[aria-label="套A本批数量"]')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '1')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await click('确认发起出库')
    expect(host.textContent).toContain('原操作结果待确认')
    expect(mocks.get).not.toHaveBeenCalled()
    await click('按原请求重试')
    expect(mocks.get).toHaveBeenCalledWith(80, owner)
    expect(mocks.execute.mock.calls[1][0].requestKey).toBe(mocks.execute.mock.calls[0][0].requestKey)
    expect(mocks.execute.mock.calls[1][0].operation).toEqual(mocks.execute.mock.calls[0][0].operation)
    await click('继续发货')
    expect(document.body.textContent).toContain('没有可选发货余量')
  })
})

async function pagePaths(run: (setPath: (path: string) => Promise<void>, host: HTMLElement) => Promise<void>, initialPath = '/sale/80') {
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host), cache = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  async function setPath(path: string) {
    await act(async () => root.render(<QueryClientProvider client={cache}><MemoryRouter><CommercialSalePage initial={order} owner={owner} tabPath={path} onClose={() => {}} /></MemoryRouter></QueryClientProvider>))
    await flush()
  }
  try { await setPath(initialPath); await run(setPath, host) }
  finally { act(() => root.unmount()); cache.clear(); host.remove() }
}
async function chooseShip() {
  await click('继续发货')
  const input = document.querySelector<HTMLInputElement>('input[aria-label="套A本批数量"]')!
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '1'); input.dispatchEvent(new Event('input', { bubbles: true })) })
  return input
}
test('same SO progress handoff preserves ship selection and current operation remains writable', async () => {
  await pagePaths(async (setPath) => {
    const input = await chooseShip()
    await setPath('/sale/80?focus=progress&taskId=90')
    expect(document.querySelector('input[aria-label="套A本批数量"]')).toBe(input)
    await click('确认发起出库')
    expect(mocks.execute).toHaveBeenCalledTimes(1)
    expect(mocks.execute.mock.calls[0][0].operation.id).toBe(80)
  })
})
test('混合详情交接进入对应标签，非法交接回订单信息且不写入', async () => {
  await pagePaths(async (setPath, host) => {
    expect(host.querySelector('button[aria-pressed="true"]')?.textContent).toBe('作业进度')
    await setPath('/sale/80?focus=fulfillment')
    expect(host.querySelector('button[aria-pressed="true"]')?.textContent).toBe('发货安排')
    await setPath('/sale/80?focus=progress&taskId=90&taskId=')
    expect(host.querySelector('button[aria-pressed="true"]')?.textContent).toBe('订单信息')
    expect(host.textContent).toContain('交接参数无效')
    expect(mocks.execute).not.toHaveBeenCalled()
  }, '/sale/80?focus=progress&taskId=90')
})
test('same SO progress handoff permits query-first retry of exact frozen detail action', async () => {
  mocks.execute.mockRejectedValueOnce({ status: 408 }).mockResolvedValue(null)
  await pagePaths(async setPath => {
    await chooseShip(); await click('确认发起出库')
    const original = mocks.execute.mock.calls[0][0]
    await setPath('/sale/80?focus=progress&taskId=90')
    await click('按原请求重试')
    expect(mocks.query.mock.calls[0][1]).toBe('sale.ship.80')
    expect(mocks.execute.mock.calls[1][0]).toEqual(original)
  })
})
test('detail reload at progress handoff finds original query-only record without applying or posting', async () => {
  mocks.execute.mockRejectedValue({ status: 408 })
  await pagePaths(async () => { await chooseShip(); await click('确认发起出库') })
  const original = mocks.execute.mock.calls[0][0]
  mocks.query.mockResolvedValue({ status: 'success', resourceType: 'sale_order', resourceId: 80, data: null })
  await pagePaths(async (_, host) => {
    expect([...host.querySelectorAll('button')].find(b => b.textContent === '按原请求重试')!.disabled).toBe(true)
    await click('查询原操作结果')
    expect(mocks.query).toHaveBeenCalledWith(original.requestKey, 'sale.ship.80', expect.objectContaining({ baseURL: '/a' }))
    expect(mocks.execute).toHaveBeenCalledTimes(1)
    expect(mocks.get).not.toHaveBeenCalled()
  }, '/sale/80?focus=progress&taskId=90')
})

function allowDetailActions() {
  useAuthStore.setState({ user: { ...useAuthStore.getState().user!, permissions: [
    PERMISSIONS.SALE_ORDER_VIEW, PERMISSIONS.SALE_ORDER_RESERVE, PERMISSIONS.SALE_ORDER_RELEASE,
    PERMISSIONS.SALE_ORDER_CANCEL, PERMISSIONS.SALE_ORDER_DELETE, PERMISSIONS.SALE_ORDER_SHIP
  ] } })
}
function actionOrder(status: SaleOrder['status']): SaleOrder {
  return { ...order, status, commercialDispatches: [], commercialGroups: [{
    ...group, dispatch: { ...group.dispatch!, confirmedShippedQty: 0 }
  }] }
}
function expectRecoveryVisible(host: HTMLElement) {
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  expect(host.closest('[aria-hidden="true"]')).toBeNull()
  expect(host.textContent).toContain('原操作结果待确认')
  expect(host.textContent).not.toContain('操作失败')
  expect(host.textContent).not.toContain('请稍后重试')
  const query = [...host.querySelectorAll('button')].find(button => button.textContent === '查询原操作结果')!
  expect(query.disabled).toBe(false)
  expect(query.closest('[aria-hidden="true"]')).toBeNull()
}
test.each([
  ['reserve', 1, '占用库存'], ['release', 2, '取消占库'],
  ['cancel', 1, '取消订单'], ['delete', 5, '删除订单']
] as const)('real confirmation %s unknown removes overlay but preserves exact mounted request and write block', async (action, status, label) => {
  allowDetailActions()
  mocks.execute.mockRejectedValueOnce({ status: 503, message: '操作失败，请稍后重试' }).mockResolvedValueOnce(null)
  const onClose = vi.fn()
  await mount(async host => {
    await click(label)
    expect(document.querySelector('[role="dialog"]')).toBeTruthy()
    await click('确认')
    const original = mocks.execute.mock.calls[0][0]
    expect(original.operation).toEqual({ action, id: 80, body: { commercialModel: 'kit-v1', expectedRevision: 4 } })
    const saved = sessionStorage.getItem('flowcube-kit-query-records-v1')
    expect(saved).toContain(original.requestKey)
    expectRecoveryVisible(host)
    expect(host.querySelector('[role="alert"]')?.textContent).toBe('原操作结果待确认，请先查询原操作结果')
    expect([...host.querySelectorAll('button')].find(button => button.textContent === label)!.disabled).toBe(true)
    expect(mocks.execute).toHaveBeenCalledTimes(1)
    expect(onClose).not.toHaveBeenCalled()
    await click('查询原操作结果')
    expect(mocks.query.mock.calls[0][1]).toBe(`sale.${action}.80`)
    expect(host.querySelector('[role="alert"]')?.textContent).toBe('暂未找到原操作结果，这不证明提交失败。刷新后只可继续查询；原表单未保存，不能重新拼接提交。')
    expect(sessionStorage.getItem('flowcube-kit-query-records-v1')).toBe(saved)
    expect(mocks.execute).toHaveBeenCalledTimes(1)
    await click('按原请求重试')
    expect(mocks.execute).toHaveBeenCalledTimes(2)
    expect(mocks.execute.mock.calls[1][0]).toEqual(original)
    expect(mocks.query).toHaveBeenCalledTimes(2)
    expect(onClose).toHaveBeenCalledTimes(action === 'delete' ? 1 : 0)
  }, actionOrder(status), onClose)
})
test('real ship dialog unknown removes overlay while keeping selected groups frozen and query-first retry', async () => {
  mocks.execute.mockRejectedValueOnce({ status: 408 }).mockResolvedValueOnce(null)
  await mount(async host => {
    await chooseShip()
    expect(document.querySelector('[role="dialog"]')).toBeTruthy()
    await click('确认发起出库')
    const original = mocks.execute.mock.calls[0][0]
    expectRecoveryVisible(host)
    expect(host.querySelector('[role="alert"]')?.textContent).toBe('提交结果待确认。原请求已冻结，请先查询原操作结果。')
    expect([...host.querySelectorAll('button')].find(button => button.textContent === '继续发货')!.disabled).toBe(true)
    expect(original.operation.body.groups).toEqual([{ groupId: 8, qty: 1 }])
    expect(mocks.execute).toHaveBeenCalledTimes(1)
    await click('按原请求重试')
    expect(mocks.query).toHaveBeenCalledWith(original.requestKey, 'sale.ship.80', expect.objectContaining({ baseURL: '/a' }))
    expect(mocks.execute.mock.calls[1][0]).toEqual(original)
  })
})
test.each(['cancel', 'ship'] as const)('real %s dialog cannot dismiss or submit again while original request is busy', async action => {
  allowDetailActions()
  let finish!: (reason: unknown) => void
  mocks.execute.mockImplementationOnce(() => new Promise((_, reject) => { finish = reject }))
  await mount(async host => {
    if (action === 'ship') { await chooseShip(); await click('确认发起出库') }
    else { await click('取消订单'); await click('确认') }
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!
    expect(dialog).toBeTruthy()
    const cancel = [...dialog.querySelectorAll('button')].find(button => button.textContent === (action === 'ship' ? '取消' : '返回订单'))!
    expect(cancel.disabled).toBe(true)
    const close = [...dialog.querySelectorAll('button')].find(button => button.textContent === '关闭')!
    expect(close).toBeTruthy()
    await act(async () => {
      cancel.click()
      close.click()
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    await flush()
    expect(document.querySelector('[role="dialog"]')).toBe(dialog)
    expect(mocks.execute).toHaveBeenCalledTimes(1)
    await act(async () => finish({ status: 503 }))
    await flush()
    expectRecoveryVisible(host)
    expect(mocks.execute).toHaveBeenCalledTimes(1)
  }, action === 'cancel' ? actionOrder(1) : order)
})
test('terminal business failure keeps its error and permits an explicit new action instead of unknown recovery', async () => {
  allowDetailActions()
  mocks.execute.mockRejectedValue({ status: 400, message: '业务拒绝夹具' })
  await mount(async host => {
    await click('取消订单'); await click('确认')
    expect(host.textContent).toContain('业务拒绝夹具')
    expect(host.querySelector('[role="alert"]')?.textContent).toBe('业务拒绝夹具')
    expect(host.textContent).not.toContain('原操作结果待确认')
    expect([...host.querySelectorAll('button')].find(button => button.textContent === '取消订单')!.disabled).toBe(false)
    expect(sessionStorage.getItem('flowcube-kit-query-records-v1')).not.toContain('requestKey')
    expect(mocks.execute).toHaveBeenCalledTimes(1)
    expect(document.querySelector('[role="dialog"]')).toBeTruthy()
    await click('返回订单')
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    await click('取消订单')
    expect(mocks.execute).toHaveBeenCalledTimes(1)
  }, actionOrder(1))
})
test('unknown delete after reload stays query-only without overlay, POST, close or applying the original receipt', async () => {
  allowDetailActions()
  mocks.execute.mockRejectedValue({ status: 503 })
  await mount(async () => { await click('删除订单'); await click('确认') }, actionOrder(5))
  const original = mocks.execute.mock.calls[0][0]
  const saved = sessionStorage.getItem('flowcube-kit-query-records-v1')
  const onClose = vi.fn()
  mocks.query.mockResolvedValue({ status: 'success', resourceType: 'sale_order', resourceId: 80, data: null })
  await mount(async host => {
    expectRecoveryVisible(host)
    expect([...host.querySelectorAll('button')].find(button => button.textContent === '按原请求重试')!.disabled).toBe(true)
    expect(sessionStorage.getItem('flowcube-kit-query-records-v1')).toBe(saved)
    await click('查询原操作结果')
    expect(mocks.query).toHaveBeenCalledWith(original.requestKey, 'sale.delete.80', expect.objectContaining({ baseURL: '/a' }))
    expect(mocks.execute).toHaveBeenCalledTimes(1)
    expect(mocks.get).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  }, actionOrder(5), onClose)
})
test('pending query retains the specific original session refusal instead of hiding recovery information', async () => {
  allowDetailActions()
  mocks.execute.mockRejectedValue({ status: 503, message: '操作失败，请稍后重试' })
  await mount(async host => {
    await click('取消订单'); await click('确认')
    const saved = sessionStorage.getItem('flowcube-kit-query-records-v1')
    await act(async () => useAuthStore.setState({ sessionGeneration: 11 }))
    await click('查询原操作结果')
    expect(host.querySelector('[role="alert"]')?.textContent).toBe('原记录的服务器、账号或登录状态已变化，请回原来源人工核对')
    expect(host.textContent).toContain('原操作结果待确认')
    expect(mocks.query).not.toHaveBeenCalled()
    expect(mocks.execute).toHaveBeenCalledTimes(1)
    expect(sessionStorage.getItem('flowcube-kit-query-records-v1')).toBe(saved)
  }, actionOrder(1))
})


test.each([true, false])('commercial original return entry uses shared create permission and navigates without commercial writes: %s', async allowed => {
  useAuthStore.setState({ user: { ...useAuthStore.getState().user!, permissions: allowed ? [PERMISSIONS.RETURN_ORDER_CREATE] : [] } })
  useWorkspaceStore.setState({ tabs: [HOME_TAB], activeKey: HOME_TAB.key })
  await mount(async host => {
    const button = [...host.querySelectorAll('button')].find(b => b.textContent === '发起退货')
    if (!allowed) { expect(button).toBeUndefined(); return }
    expect(button).toBeTruthy(); await click('发起退货')
    expect(useWorkspaceStore.getState().activeKey).toBe('/returns/sale/new?sourceId=80&sourceNo=SO80')
    expect(host.querySelector('[data-route]')?.textContent).toBe('/returns/sale/new?sourceId=80&sourceNo=SO80')
    expect(mocks.execute).not.toHaveBeenCalled()
  })
})

test('成套拣货和装箱沿普通订单表格保留条码、型号、数量、操作者和时间', async () => {
  const item = { id: 20, productId: 2, productCode: 'P20', productName: '真实组件', articleNumber: 'ART20', spec: 'M20', color: '本色', unit: '个', quantity: 8, unitPrice: 7, amount: 56, scans: [{ barcode: 'BOX20', qty: 4, operatorName: '拣货人', scannedAt: '2026-10-09 10:30:00' }] }
  await mount(async host => {
    await click('拣货明细')
    const scan = [...host.querySelectorAll('table')].find(table => !table.closest('[hidden]'))!
    expect(scan).not.toBeNull()
    for (const text of ['供应商型号', '操作时间', 'ART20', 'M20', 'BOX20', '拣货人', '4']) expect(scan.textContent).toContain(text)
    await click('装箱进度')
    expect(host.textContent).toContain('箱子总数')
    expect(host.textContent).toContain('装箱明细行数')
    const packing = [...host.querySelectorAll('table')].find(table => !table.closest('[hidden]'))!
    for (const text of ['ART20', 'M20', 'PACK20', '操作时间']) expect(host.textContent).toContain(text)
    expect(packing.textContent).toContain('4')
    expect(mocks.execute).not.toHaveBeenCalled()
  }, { ...order, taskNo: 'WT-A', items: [item], packages: [{ id: 1, barcode: 'PACK20', status: 2, items: [{ ...item, qty: 4, packedAt: '2026-10-09 11:00:00' }] }] })
})
test('成套操作记录沿原完整记录入口而不是仅显示订单时间线', async () => {
  mocks.activity.mockResolvedValue({ status: '执行中', sections: [], historyNote: '历史记录可能不完整', events: [{ id: 'record20', title: '原单操作记录', description: '操作说明', createdByName: '操作人', createdAt: '2026-10-09 10:30:00', source: '业务事件' }] })
  await mount(async host => {
    await click('操作记录')
    await flush()
    expect(host.textContent).toContain('原单操作记录')
    expect(host.textContent).toContain('事项 / 说明')
    expect(host.textContent).toContain('操作人')
    expect(mocks.activity.mock.calls[0].slice(0, 2)).toEqual(['sale', 80])
    expect(mocks.activity.mock.calls[0][3]).toEqual(owner)
    expect(mocks.execute).not.toHaveBeenCalled()
  })
})
