// @vitest-environment jsdom
import { act, StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { getByRole, getAllByRole, queryByRole } from '@testing-library/dom'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { useAuthStore } from '@/store/authStore'
import { useWorkspaceStore, HOME_TAB } from '@/store/workspaceStore'
import type { User } from '@/types'
import AgentWorkspace from './AgentWorkspace'
import { AssistantRequestError } from '@/api/assistant'

vi.mock('@/hooks/useActiveWorkspaceTab', () => ({ useActiveWorkspaceTab: () => true }))
vi.mock('@/components/shared/payments/ReceiptDetailDialog', () => ({
  ReceiptDetailDialog: ({ open, receiptId, onClose }: { open: boolean, receiptId: number, onClose: () => void }) =>
    open ? <div role="dialog" aria-label={`收款明细 ${receiptId}`}><button onClick={onClose}>关闭收款明细</button></div> : null,
}))
vi.mock('@/api/client', () => {
  class ApiClientError extends Error {
    status?: number; code?: string
    constructor(message: string, status: number, code?: string) { super(message); this.status = status; this.code = code }
  }
  return {
    ApiClientError, getApiClientBaseURL: () => '/api', subscribeApiClientBaseURL: () => () => {},
    default: { request: async (config: { url: string; method: string; data?: unknown; signal?: AbortSignal }) => {
      const response = await fetch(config.url, { method: config.method, body: config.data === undefined ? undefined : JSON.stringify(config.data), signal: config.signal })
      const data = await response.json()
      if (!response.ok) throw new ApiClientError(data.error, response.status, data.code)
      return { data: { success: true, data } }
    } },
  }
})
let root: Root, host: HTMLDivElement
const fetchMock = vi.fn<typeof fetch>()
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
const preview = (qty = 4) => ({ title: '销售草稿', customer: { name: '测试客户' }, warehouseName: '测试仓', totalCents: 1235 * qty, lines: [{ productId: 1, productName: '测试商品', qty, unitPrice: 12.35 }], confirmLabel: '确认建单', expiresAt: '2099-10-26T12:00:00Z' })
const task = (extra = {}) => ({ id: 'task-1', graph: 'B-sale-draft', state: 'AWAITING_CONFIRM', userText: '给测试客户开单四个', revision: 1, preview: preview(), ...extra })
let tasks: unknown[], chat: unknown, confirmed: unknown, resumed: unknown, saleDraftChange: unknown
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, ResizeObserver: class { observe() {} unobserve() {} disconnect() {} } })
  useAuthStore.setState({ token: 'synthetic-token', user: { id: 1, username: 'owner', roleId: 1, permissions: [] } as unknown as User, sessionGeneration: 1 })
  tasks = []; chat = {}; confirmed = {}; resumed = {}; saleDraftChange = {}
  fetchMock.mockReset().mockImplementation(async (input, init) => {
    const url = String(input)
    if (url.endsWith('/health')) return response({ planner: 'llm' })
    if (url.endsWith('/me')) return response({ realName: '测试人员', roleName: '测试岗位', warehouseScope: '全部仓库' })
    if (url.endsWith('/tasks')) return response({ tasks })
    if (url.endsWith('/chat')) return response(chat)
    if (url.endsWith('/confirm')) return response(confirmed)
    if (url.endsWith('/resume')) return response(resumed)
    if (url.endsWith('/sale-draft')) return response(saleDraftChange)
    if (init?.method === 'GET' || !init?.method) return response({ task: tasks[0] })
    throw new Error('Unexpected synthetic request')
  })
  vi.stubGlobal('fetch', fetchMock)
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals() })
async function render() { await act(async () => root.render(<MemoryRouter initialEntries={['/assistant']}><AgentWorkspace /></MemoryRouter>)) }
async function click(name: string) { await act(async () => getByRole(host, 'button', { name }).click()) }
async function send(text: string) {
  act(() => {
    const input = getByRole(host, 'textbox', { name: '告诉小满要做什么' })
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, text)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await click('发送')
}

test('大页面直接展示小满与输入框，无须打开抽屉', async () => {
  await render()
  expect(getByRole(host, 'heading', { name: '小满', level: 1 })).toBeTruthy()
  expect(getByRole(host, 'textbox', { name: '告诉小满要做什么' })).toBeTruthy()
  expect(queryByRole(host, 'dialog')).toBeNull()
  expect(host.textContent).toContain('能做')
  expect(host.textContent).toContain('请到业务页面办理')
  expect(host.textContent).toContain('完整收款单号')
  expect(getByRole(host, 'button', { name: /岗位待办/ })).toBeTruthy()
  expect(host.textContent).toContain('最近记录只显示已进入业务流程的任务')
  expect(host.textContent).toContain('请在业务页面核对大额单据')
  expect(host.textContent).not.toMatch(/大额硬拦|不扩到商务|本地短回|闲聊不留/)
  expect(host.textContent).not.toContain('聊聊极序')
  expect(queryByRole(host, 'button', { name: '销售订单' })).toBeNull()
})
test('欢迎区停在顶部，已有对话跟随最新消息，新对话回到顶部', async () => {
  const scrollHeight = vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(500)
  try {
    await render()
    const thread = host.querySelector<HTMLDivElement>('.xiaoman-thread')!
    expect(thread.scrollTop).toBe(0)

    chat = { reply: '合成库存结果' }
    await send('查库存')
    expect(thread.scrollTop).toBe(500)

    await click('新对话')
    expect(thread.scrollTop).toBe(0)
    expect(getByRole(host, 'heading', { name: '今天想先办哪件事？' })).toBeTruthy()
  } finally {
    scrollHeight.mockRestore()
  }
})
test('拒答里的菜单可以点开，不把路径当普通文字丢掉', async () => {
  useWorkspaceStore.setState({ tabs: [HOME_TAB], activeKey: HOME_TAB.key, recentKeys: [HOME_TAB.key] })
  chat = { reply: '请到[[销售订单|/sale]]办理，我不会替你提交。' }
  await render()
  await send('把价格改成5块')
  await click('销售订单')
  expect(useWorkspaceStore.getState().tabs.some(tab => tab.path === '/sale')).toBe(true)
  expect(host.textContent).not.toContain('[[销售订单|/sale]]')
})
test('销售交接打开同一张原单并按当前权限控制入口', async () => {
  useWorkspaceStore.setState({ tabs: [HOME_TAB], activeKey: HOME_TAB.key, recentKeys: [HOME_TAB.key] })
  await act(async () => useAuthStore.setState(state => ({ user: { ...state.user!, roleId: 5 } })))
  const result = { orderId: 36, orderNo: 'SL20261122011', sources: ['sale'] }
  chat = {
    task: task({ graph: 'L-sale-handoff', state: 'DONE', preview: null }),
    result,
    reply: '已办：销售草稿已建。\n卡点：待占库。\n下一步：销售岗核对原单。'
  }
  await render()
  await send('交接销售单 SL20261122011')
  expect(queryByRole(host, 'button', { name: '查看销售原单' })).toBeNull()
  await act(async () => useAuthStore.setState(state => ({ user: { ...state.user!, permissions: ['sale.order.view'] } })))
  await click('查看销售原单')
  expect(useWorkspaceStore.getState().tabs.some(tab => tab.path === '/sale/36')).toBe(true)
  expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/confirm'))).toBe(false)
})
test('按销售原单追查时只打开已核对的退货单', async () => {
  useWorkspaceStore.setState({ tabs: [HOME_TAB], activeKey: HOME_TAB.key, recentKeys: [HOME_TAB.key] })
  await act(async () => useAuthStore.setState(state => ({ user: { ...state.user!, roleId: 5 } })))
  chat = {
    task: task({ graph: 'L-sale-handoff', state: 'DONE', preview: null }),
    result: { orderNo: 'SL20261122041', returnId: 91, sources: ['returns'] },
    reply: '已办：已核对原单和退货单。\n下一步：打开退货原单核对。'
  }
  await render()
  await send('查销售单 SL20261122041 的退货单 SR20261122091')
  expect(queryByRole(host, 'button', { name: '查看退货原单' })).toBeNull()
  await act(async () => useAuthStore.setState(state => ({ user: { ...state.user!, permissions: ['return.order.view'] } })))
  await click('查看退货原单')
  expect(useWorkspaceStore.getState().tabs.some(tab => tab.path === '/returns/sale/91')).toBe(true)
  expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/confirm'))).toBe(false)
})

test('刷新后从当前用户任务列表恢复原预览，确认携带原任务与版本', async () => {
  tasks = [task()]; await render()
  confirmed = { reply: '合成销售单已创建', task: { id: 'task-1', graph: 'B-sale-draft', state: 'DONE' }, result: { orderId: 3, orderNo: 'SL-SYNTHETIC' } }
  await click('确认建单')
  const call = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/tasks/task-1/confirm'))!
  expect(JSON.parse(String(call[1]?.body))).toMatchObject({ revision: 1 })
  expect(host.textContent).toContain('合成销售单已创建')
  expect(queryByRole(host, 'button', { name: '确认建单' })).toBeNull()
})

const handoffSnapshot = (extra = {}) => task({ id: 'handoff-factory', graph: 'L-sale-handoff', state: 'DONE',
  userText: '交接销售单 SL20261122011', reviewRequired: true, preview: undefined,
  reply: '旧交接 · 待打包', result: { orderNo: 'SL20261122011' }, ...extra })

test('刷新自动复核原交接，只展现当前仓库环节', async () => {
  tasks = [handoffSnapshot()]
  resumed = { task: handoffSnapshot({ reviewRequired: undefined }), reply: '新交接 · 待出库',
    result: { orderNo: 'SL20261122011' } }
  await render()
  expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/tasks/handoff-factory/resume'))).toHaveLength(1)
  expect(host.textContent).toContain('新交接 · 待出库')
  expect(host.textContent).not.toContain('旧交接 · 待打包')
  expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/confirm'))).toBe(false)
})

test('原交接暂时无法复核时不显示旧卡点或原单快捷入口', async () => {
  tasks = [handoffSnapshot()]
  resumed = { task: null, detachTask: true, reply: '暂时无法核对原交接，请稍后重开最近记录。' }
  await render()
  expect(host.textContent).toContain('暂时无法核对原交接')
  expect(host.textContent).not.toContain('旧交接 · 待打包')
  expect(queryByRole(host, 'button', { name: '打开销售单' })).toBeNull()
})

test('刷新恢复成功后只展示复核的新版本', async () => {
  tasks = [task({ reviewRequired: true })]
  resumed = { task: task({ revision: 2, preview: preview(5) }), reply: '按原任务已重新试算' }
  await render()
  expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/tasks/task-1/resume'))).toHaveLength(1)
  expect(getByRole(host, 'region', { name: '当前业务预览' }).textContent).toContain('×5')
  expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/confirm'))).toBe(false)
  confirmed = { task: task({ state: 'DONE' }), reply: '已确认' }
  await click('确认建单')
  const call = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/tasks/task-1/confirm'))!
  expect(JSON.parse(String(call[1]?.body))).toEqual({ revision: 2 })
})

test('重新进入有两张待办时没有默认确认卡，补客户名接续同一次历史查找', async () => {
  tasks = [task({ reviewRequired: true }), task({ id: 'task-2', userText: '给合成乙开单', reviewRequired: true })]
  await render()
  expect(queryByRole(host, 'button', { name: '确认建单' })).toBeNull()
  expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/resume'))).toBe(false)
  chat = { task: null, detachTask: true, historyLookup: true, historyQuery: '继续上次的销售草稿', reply: '请给出客户全称' }
  await send('继续上次的销售草稿')
  chat = { task: task({ id: 'task-2', revision: 2 }), reply: '按原任务已复核' }
  await send('合成乙')
  const calls = fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/chat'))
  const firstCall = JSON.parse(String(calls[0][1]?.body))
  expect(firstCall).toEqual({ message: '继续上次的销售草稿', conversationId: expect.any(String) })
  expect(JSON.parse(String(calls[1][1]?.body))).toEqual({ message: '合成乙', conversationId: firstCall.conversationId, historyLookup: true, historyQuery: '继续上次的销售草稿' })
  expect(queryByRole(host, 'button', { name: '确认建单' })).toBeTruthy()
})

test('空任务对话共用会话编号，新对话换号，打开历史恢复原编号', async () => {
  const previous = '11111111-2222-4333-8444-555555555555'
  const requests = () => fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/chat'))
    .map(([, init]) => JSON.parse(String(init?.body)))
  tasks = [task({ conversationId: previous })]
  await render()
  chat = { task: null, reply: '已查', detachTask: true }
  await send('接着查这件事')
  await send('再看一下')
  expect(requests().map(row => row.conversationId)).toEqual([previous, previous])
  await click('新对话')
  await send('在吗')
  const freshId = requests()[2].conversationId
  expect(freshId).toEqual(expect.any(String))
  expect(freshId).not.toBe(previous)
  await click('打开记录：销售草稿，给测试客户开单四个')
  await send('回到原单')
  expect(requests()[3].conversationId).toBe(previous)
})

test('恢复暂时无法复核时仅出现核对入口，重试找回原卡', async () => {
  tasks = [task({ reviewRequired: true })]
  resumed = { task: task({ reviewRequired: true }), reply: '暂时无法复核，请稍后' }
  await render()
  expect(queryByRole(host, 'button', { name: '确认建单' })).toBeNull()
  resumed = { task: task(), reply: '原预览已复核' }
  await click('核对原预览')
  expect(queryByRole(host, 'button', { name: '确认建单' })).toBeTruthy()
  expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/tasks/task-1/resume'))).toHaveLength(2)
})
test('两张草稿歧义时收起确认卡，明确上一张后只确认对应任务和版本', async () => {
  const first = task()
  const second = task({ id: 'task-2', userText: '给另一客户开单三个', revision: 2, preview: { ...preview(3), customer: { name: '另一客户' } } })
  const requests = () => fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/chat'))
    .map(([, init]) => JSON.parse(String(init?.body)))
  tasks = [first]
  await render()
  chat = { reply: '第二张草稿已试算', task: second }
  await send(second.userText)
  chat = { reply: '你指的是哪张单？', task: null, detachTask: true, keepReferences: true }
  await send('确认刚才那单')
  expect(requests().at(-1)).toEqual({ message: '确认刚才那单', taskId: 'task-2', previousTaskId: 'task-1', conversationId: expect.any(String) })
  expect(queryByRole(host, 'button', { name: '确认建单' })).toBeNull()
  expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/confirm'))).toBe(false)
  chat = { reply: '已回到第一张草稿', task: first }
  await send('上一张单')
  expect(requests().at(-1)).toEqual({ message: '上一张单', referenceTaskId: 'task-2', previousTaskId: 'task-1', conversationId: expect.any(String) })
  expect(getByRole(host, 'region', { name: '当前业务预览' }).textContent).toContain('测试客户')
  confirmed = { reply: '合成销售单已创建', task: { ...first, state: 'DONE' } }
  await click('确认建单')
  const confirmations = fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/confirm'))
  expect(confirmations).toHaveLength(1)
  expect(String(confirmations[0][0])).toMatch(/\/tasks\/task-1\/confirm$/)
  expect(JSON.parse(String(confirmations[0][1]?.body))).toEqual({ revision: 1 })
})

test('发送候选序号带上当前卡片的候选版本', async () => {
  const candidateKey = 'ab'.repeat(32)
  tasks = [task({ state: 'DISAMBIGUATING', preview: undefined, candidateKey, candidates: [{ id: 10, title: '甲客户' }, { id: 20, title: '乙客户' }] })]
  await render()
  chat = { reply: '已选乙客户', task: task() }
  await send('第二个')
  const call = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/chat'))!
  expect(JSON.parse(String(call[1]?.body))).toEqual({ message: '第二个', taskId: 'task-1', candidateKey, conversationId: expect.any(String) })
})
test('占库确认卡按明细显示实际行仓', async () => {
  tasks = [task({
    graph: 'B2-reserve',
    preview: { ...preview(), warehouseName: '订单头仓', confirmLabel: '确认占库', lines: [
      { productId: 1, productName: '商品甲', qty: 2, warehouseName: '行仓甲' },
      { productId: 2, productName: '商品乙', qty: 3, warehouseName: '行仓乙' },
    ] },
  })]
  await render()
  const card = getByRole(host, 'region', { name: '当前业务预览' })
  expect(card.textContent).toContain('商品甲行仓甲')
  expect(card.textContent).toContain('商品乙行仓乙')
  expect(card.textContent).not.toContain('订单头仓')
})
test('重选商品清除当前确认卡，仍可在原任务继续输入或作废', async () => {
  tasks = [task()]
  await render()
  saleDraftChange = { reply: '请重新输入商品和数量', task: { id: 'task-1', graph: 'B-sale-draft', state: 'DISAMBIGUATING', revision: 2 } }
  await click('重选商品')
  const call = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/tasks/task-1/sale-draft'))!
  expect(JSON.parse(String(call[1]?.body))).toEqual({ action: 'reselect', revision: 1 })
  expect(queryByRole(host, 'region', { name: '当前业务预览' })).toBeNull()
  expect(queryByRole(host, 'button', { name: '确认建单' })).toBeNull()
  expect(host.textContent).toContain('请重新输入商品和数量')
  expect(getByRole(host, 'button', { name: '作废草稿' })).toBeTruthy()
})
test('作废需要再确认，完成后清除原预览与确认入口', async () => {
  tasks = [task()]
  await render()
  saleDraftChange = { reply: '销售草稿已作废', task: { id: 'task-1', graph: 'B-sale-draft', state: 'CANCELLED', revision: 2 } }
  await click('作废草稿')
  const dialog = getByRole(document.body, 'dialog', { name: '作废销售草稿' })
  expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/sale-draft'))).toBe(false)
  await act(async () => getByRole(dialog, 'button', { name: '确认作废' }).click())
  const call = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/tasks/task-1/sale-draft'))!
  expect(JSON.parse(String(call[1]?.body))).toEqual({ action: 'cancel', revision: 1 })
  expect(queryByRole(host, 'region', { name: '当前业务预览' })).toBeNull()
  expect(queryByRole(host, 'button', { name: '确认建单' })).toBeNull()
  expect(host.textContent).toContain('销售草稿已作废')
})
test('重选响应丢失时只回读同一草稿，从服务端移除旧确认卡', async () => {
  tasks = [task()]
  await render()
  tasks = [task({ state: 'DISAMBIGUATING', revision: 2, preview: undefined, reply: '已保留客户，请重新输入商品和数量' })]
  const originalFetch = fetchMock.getMockImplementation()!
  fetchMock.mockImplementation((url, init) => String(url).endsWith('/sale-draft')
    ? Promise.reject(new TypeError('lost response'))
    : originalFetch(url, init))
  await click('重选商品')
  expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/sale-draft'))).toHaveLength(1)
  expect(fetchMock.mock.calls.some(([url, init]) => String(url).endsWith('/tasks/task-1') && init?.method === 'GET')).toBe(true)
  expect(host.textContent).toContain('已保留客户，请重新输入商品和数量')
  expect(queryByRole(host, 'button', { name: '确认建单' })).toBeNull()
})
test('同名候选可以点击，接续原任务只传候选稳定ID', async () => {
  chat = { reply: '请选择商品', task: { id: 'choose-1', graph: 'A-inventory', state: 'DISAMBIGUATING' }, candidates: [{ id: 7, title: '铰链长款', subtitle: 'P007' }, { id: 8, title: '铰链短款', subtitle: 'P008' }] }
  await render(); await send('查铰链库存')
  chat = { reply: '铰链长款库存20', task: { id: 'choose-1', graph: 'A-inventory', state: 'DONE' } }
  await click('铰链长款 P007')
  const calls = fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/chat'))
  expect(JSON.parse(String(calls.at(-1)![1]?.body))).toMatchObject({ taskId: 'choose-1', choiceId: 7 })
  expect(host.textContent).toContain('铰链长款库存20')
})
test('修改预览替换同任务卡片，始终只有一个有效确认入口', async () => {
  tasks = [task()]; await render()
  chat = { reply: '已改为五个，请重新确认', task: { id: 'task-1', graph: 'B-sale-draft', state: 'AWAITING_CONFIRM', revision: 2 }, preview: preview(5) }
  await send('把刚才数量改成五个')
  expect(getAllByRole(host, 'button', { name: '确认建单' })).toHaveLength(1)
  const call = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/chat'))!
  expect(JSON.parse(String(call[1]?.body))).toMatchObject({ taskId: 'task-1' })
  expect(host.textContent).toContain('×5')
  expect(host.textContent).not.toContain('×4')
})
test('收款未选账户时不允许确认，选定后只显示一张当前预览', async () => {
  const receiptPreview = { title: '登记收款', totalCents: 1975, amountCents: 1975, paymentDate: '2026-10-26', customer: { name: '测试客户' }, lines: [], accounts: [{ id: 1, name: '测试账户甲' }, { id: 2, name: '测试账户乙' }], account: null, confirmLabel: '确认登记收款' }
  tasks = [task({ graph: 'D-receipt', preview: receiptPreview })]; await render()
  expect(getByRole(host, 'button', { name: '确认登记收款' }).hasAttribute('disabled')).toBe(true)
  chat = { reply: '已选择账户乙', task: { id: 'task-1', graph: 'D-receipt', state: 'AWAITING_CONFIRM', revision: 2 }, preview: { ...receiptPreview, account: { id: 2, name: '测试账户乙' } } }
  await click('测试账户乙')
  expect(getAllByRole(host, 'button', { name: '确认登记收款' })).toHaveLength(1)
  expect(getByRole(host, 'button', { name: '确认登记收款' }).hasAttribute('disabled')).toBe(false)
})
test('收款第一段进入核销第二段，原登记入口停止生效', async () => {
  tasks = [task({ graph: 'D-receipt', preview: { ...preview(), account: { id: 1, name: '测试账户' }, amountCents: 100, confirmLabel: '确认登记收款' } })]; await render()
  confirmed = { reply: '已登记，请核对核销分配', task: { id: 'stage-2', graph: 'D-settle', state: 'AWAITING_CONFIRM', revision: 1 }, preview: { title: '核销分配', totalCents: 100, lines: [], allocations: [], confirmLabel: '确认核销' } }
  await click('确认登记收款')
  expect(queryByRole(host, 'button', { name: '确认登记收款' })).toBeNull()
  expect(getByRole(host, 'button', { name: '确认核销' })).toBeTruthy()
})
test('月结核销卡同时显示两个来源和逐单金额，确认发送当前版本', async () => {
  const monthly = task({ id: 'monthly-1', graph: 'D-settle', revision: 4, preview: {
    statementNo: 'SC20261122001', receiptNo: 'RC20261122005', totalCents: 503, confirmLabel: '确认核销',
    statementBalanceBeforeCents: 4800, receiptBalanceBeforeCents: 1200,
    allocations: [{ recordId: 7, orderNo: 'SL20261122008', amountCents: 503, balanceBeforeCents: 2200 }],
  } })
  tasks = [monthly]; await render()
  const card = getByRole(host, 'region', { name: '当前业务预览' })
  for (const value of ['SC20261122001', 'RC20261122005', 'SL20261122008', '5.03', '16.97']) expect(card.textContent).toContain(value)
  expect(card.textContent).toContain('¥12.00 → ¥6.97')
  expect(card.textContent).toContain('¥48.00 → ¥42.97')
  expect(card.textContent).toContain('¥22.00 → ¥16.97')
  confirmed = { task: { ...monthly, state: 'DONE' }, reply: '原对账单核销完成' }
  await click('确认核销')
  const call = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/tasks/monthly-1/confirm'))!
  expect(JSON.parse(String(call[1]?.body))).toEqual({ revision: 4 })
  expect(queryByRole(host, 'button', { name: '确认核销' })).toBeNull()
})
test('退款卡显示原退款、销售、月结、账户和金额，点击只发送原任务版本', async () => {
  const refund = task({ id: 'refund-1', graph: 'P-refund-execute', revision: 3, preview: {
    refundNo: 'RF20261122001', saleOrderNo: 'SL20261122001', statementNo: 'SC20261122001',
    account: { id: 3, name: '账户 #3' }, paymentDate: '2026-11-22', totalCents: 275, confirmLabel: '确认退款出账',
  } })
  tasks = [refund]; await render()
  const card = getByRole(host, 'region', { name: '当前业务预览' })
  for (const value of ['RF20261122001', 'SL20261122001', 'SC20261122001', '账户 #3', '2.75']) expect(card.textContent).toContain(value)
  confirmed = { task: { ...refund, state: 'DONE' }, reply: '原退款出账完成' }
  await click('确认退款出账')
  const call = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/tasks/refund-1/confirm'))!
  expect(JSON.parse(String(call[1]?.body))).toEqual({ revision: 3 })
  expect(queryByRole(host, 'button', { name: '确认退款出账' })).toBeNull()
})
test('补录重试卡分别显示原业务期间与原审批月，并确认当前预览版本', async () => {
  const backfill = task({ id: 'backfill-1', graph: 'R-backfill-action', revision: 5, preview: {
    applicationNo: 'BF-20261122-0012', refundNo: 'RF20261122001', saleOrderNo: 'SL20261122001',
    paymentDate: '2026-10-09', businessPeriod: '202610', postingMonth: '2026年11月',
    totalCents: 275, confirmLabel: '重试执行',
  } })
  tasks = [backfill]; await render()
  const card = getByRole(host, 'region', { name: '当前业务预览' })
  for (const value of ['BF-20261122-0012', 'RF20261122001', 'SL20261122001', '2026-10-09', '2026年11月', '2.75']) expect(card.textContent).toContain(value)
  confirmed = { task: { ...backfill, state: 'DONE' }, reply: '已记账，调整凭证归属2026年11月。' }
  await click('重试执行')
  const call = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/tasks/backfill-1/confirm'))!
  expect(JSON.parse(String(call[1]?.body))).toEqual({ revision: 5 })
  expect(queryByRole(host, 'button', { name: '重试执行' })).toBeNull()
})
test('发送失败保留草稿，任务恢复失败明确提示重试', async () => {
  await render(); fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
  await send('查测试商品库存')
  expect(getByRole(host, 'textbox')).toHaveProperty('value', '查测试商品库存')
  expect(host.textContent).toContain('连接失败')
})
test('换用户时清除原对话，迟到响应不能进入新会话', async () => {
  await render()
  let finish!: (value: Response) => void
  fetchMock.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  await send('原用户私有任务')
  await act(async () => useAuthStore.setState({ token: 'other-synthetic-token', sessionGeneration: 2 }))
  await act(async () => finish(response({ reply: '原用户私有结果' })))
  expect(host.textContent).not.toContain('原用户私有任务')
  expect(host.textContent).not.toContain('原用户私有结果')
})
test('旧版本确认被拒时回读原任务的新预览，不重复执行', async () => {
  tasks = [task()]; await render()
  const originalFetch = fetchMock.getMockImplementation()!
  fetchMock.mockImplementation(async (url, init) => String(url).endsWith('/confirm')
    ? response({ error: '预览已更新，请重新核对', code: 'PREVIEW_REVISION_CONFLICT' }, 409) : originalFetch(url, init))
  tasks = [task({ revision: 2, preview: preview(5), reply: '当前数量五个，请核对' })]
  await click('确认建单')
  expect(host.textContent).toContain('×5')
  expect(host.textContent).not.toContain('×4')
  expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/confirm'))).toHaveLength(1)
})
test('确认响应丢失只能查询同一个原任务，不重新发起聊天建单', async () => {
  tasks = [task()]; await render()
  fetchMock.mockRejectedValueOnce(new TypeError('Connection lost'))
  await click('确认建单')
  resumed = { reply: '原销售单已创建，已核对', task: { id: 'task-1', graph: 'B-sale-draft', state: 'DONE' } }
  await click('查询原任务结果')
  expect(host.textContent).toContain('原销售单已创建，已核对')
  expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/tasks/task-1/confirm'))).toHaveLength(1)
  expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/tasks/task-1/resume'))).toHaveLength(1)
  expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/chat'))).toBe(false)
})
test('正式传输的网络错误状态0恢复原任务，不保留普通确认按钮', async () => {
  tasks = [task()]; await render()
  fetchMock.mockRejectedValueOnce(new AssistantRequestError('网络超时', 0))
  await click('确认建单')
  expect(queryByRole(host, 'button', { name: '确认建单' })).toBeNull()
  expect(getByRole(host, 'button', { name: '查询原任务结果' })).toBeTruthy()
})
test('任务读取失败呈现重试，恢复后找回待确认卡', async () => {
  tasks = [task()]
  let fail = true
  const originalFetch = fetchMock.getMockImplementation()!
  fetchMock.mockImplementation(async (url, init) => String(url).endsWith('/tasks') && fail ? response({ error: '暂不可用' }, 503) : originalFetch(url, init))
  await render()
  expect(host.textContent).toContain('最近记录读取失败')
  fail = false; await click('重试读取任务')
  expect(getByRole(host, 'button', { name: '确认建单' })).toBeTruthy()
})
test('开发严格模式中初始化可重入，仍能找回任务且没有业务POST', async () => {
  tasks = [task()]
  await act(async () => root.render(<StrictMode><MemoryRouter initialEntries={['/assistant']}><AgentWorkspace /></MemoryRouter></StrictMode>))
  expect(getAllByRole(host, 'button', { name: '确认建单' })).toHaveLength(1)
  expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false)
})
test('占库预览只显示商品数量，不显示无意义零金额', async () => {
  tasks = [task({ graph: 'B2-reserve', preview: { ...preview(), totalCents: 0, confirmLabel: '确认占库' } })]
  await render()
  expect(host.textContent).toContain('×4')
  expect(host.textContent).not.toContain('¥0.00')
})
test('占库确认卡逐行显示本次量及预计变化，过期后等待重新试算', async () => {
  const reserve = (revision: number, reservedQty: number, state = 'AWAITING_CONFIRM') => task({
    graph: 'B2-reserve', state, revision, preview: {
      orderId: 36, orderNo: 'SL20261122011', confirmLabel: '确认占库',
      lines: [{ productId: 2, productName: '测试铰链', warehouseName: '二仓', qty: 0.75, unit: '盒', reservedQty }],
    },
  })
  tasks = [reserve(1, 1.25, 'EXPIRED')]
  resumed = { task: reserve(2, 2.25), reply: '本次已按最新数量重新试算' }
  await render()
  expect(host.textContent).not.toContain('1.25 → 2')
  expect(queryByRole(host, 'button', { name: '确认占库' })).toBeNull()
  await click('核对原预览')
  const card = getByRole(host, 'region', { name: '当前业务预览' })
  expect(card.textContent).toContain('SL20261122011')
  expect(card.textContent).toContain('二仓')
  expect(card.textContent).toContain('2.25 → 3 盒')
  expect(card.textContent).toContain('本次占库 0.75 盒')
  expect(getByRole(card, 'button', { name: '确认占库' })).toBeTruthy()
  expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/confirm'))).toBe(false)
})
test('核销原单入口按当前权限及正式身份开启，无链接也保留单号', async () => {
  useWorkspaceStore.setState({ tabs: [HOME_TAB], activeKey: HOME_TAB.key, recentKeys: [HOME_TAB.key] })
  await act(async () => useAuthStore.setState(state => ({ user: { ...state.user!, roleId: 5 } })))
  tasks = [task({ graph: 'D-settle', preview: {
    receiptId: 61, receiptNo: 'RC20261122061', receiptBalanceBeforeCents: 80000, totalCents: 20000,
    confirmLabel: '确认核销',
    allocations: [{ orderId: 36, recordId: 8, orderNo: 'SL20261122011', amountCents: 20000, balanceBeforeCents: 50000 }],
  } })]
  await render()
  const card = getByRole(host, 'region', { name: '当前业务预览' })
  expect(card.textContent).toContain('RC20261122061')
  expect(card.textContent).toContain('SL20261122011')
  expect(card.textContent).toContain('¥800.00 → ¥600.00')
  expect(queryByRole(card, 'button', { name: /RC20261122061/ })).toBeNull()
  expect(queryByRole(card, 'button', { name: 'SL20261122011' })).toBeNull()
  await act(async () => useAuthStore.setState(state => ({ user: { ...state.user!, permissions: ['sale.order.view', 'payment.view'] } })))
  await click('查看原收款单 RC20261122061')
  expect(getByRole(host, 'dialog', { name: '收款明细 61' })).toBeTruthy()
  await click('关闭收款明细')
  await click('SL20261122011')
  expect(useWorkspaceStore.getState().tabs.some(tab => tab.path === '/sale/36')).toBe(true)
  expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/confirm'))).toBe(false)
})
test('业务回复的重点与列表可读，模型文本不会作为HTML执行', async () => {
  await render()
  chat = { reply: '先看**关键信息**。\n\n1. 统一标题\n2. 保留当前草稿\n\n<script>synthetic()</script>', task: { id: 'brief-1', graph: 'F-briefing', state: 'DONE' } }
  await send('给我一份经营简报')
  expect(host.querySelector('.xiaoman-message-text strong')?.textContent).toBe('关键信息')
  expect(getByRole(host, 'list').querySelectorAll('li')).toHaveLength(2)
  expect(host.querySelector('script')).toBeNull()
  expect(host.textContent).toContain('<script>synthetic()</script>')
})
test('服务端不再返回当前记录时，刷新移除原快照和确认入口', async () => {
  tasks = [task()]; await render()
  tasks = []; await click('刷新最近记录')
  expect(host.textContent).not.toContain('给测试客户开单四个')
  expect(queryByRole(host, 'button', { name: '确认建单' })).toBeNull()
})

test('明确换话题会收起旧预览，最近记录仍可打开原草稿', async () => {
  tasks = [task()]
  await render()
  expect(getByRole(host, 'button', { name: '确认建单' })).toBeTruthy()
  chat = { reply: '接下来想查什么或办哪件事？', task: null, detachTask: true }
  await send('换个话题')
  expect(queryByRole(host, 'button', { name: '确认建单' })).toBeNull()
  chat = { reply: '请说明要查询的对象', task: null }
  await send('查一下这张单')
  const calls = fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/chat'))
  expect(JSON.parse(String(calls.at(-1)?.[1]?.body))).toEqual({ message: '查一下这张单', conversationId: expect.any(String) })
  await click('打开记录：销售草稿，给测试客户开单四个')
  expect(getByRole(host, 'button', { name: '确认建单' })).toBeTruthy()
})

test('复合查询暂停时从原任务续办，候选仍用原任务选择', async () => {
  tasks = [task({ graph: 'K-sequence', state: 'PAUSED', preview: undefined, candidates: [{ id: 9, title: '长款铰链' }] })]
  await render()
  expect(getByRole(host, 'button', { name: '长款铰链' })).toBeTruthy()
  resumed = { reply: '两项均已完成', task: { id: 'task-1', graph: 'K-sequence', state: 'DONE' } }
  await click('继续原任务')
  expect(host.textContent).toContain('两项均已完成')
  expect(queryByRole(host, 'button', { name: '继续原任务' })).toBeNull()
  expect(queryByRole(host, 'button', { name: '长款铰链' })).toBeNull()
  expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/tasks/task-1/resume'))).toHaveLength(1)
  expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/confirm'))).toBe(false)
})

test.each([
  ['B2-reserve', '确认占库'],
  ['D-settle', '确认核销'],
  ['P-refund-execute', '确认退款出账'],
])('过期的 %s 只能核对原任务，取得新版后才显示确认', async (graph, confirmLabel) => {
  const old = task({ graph, state: 'EXPIRED', revision: 2, preview: { ...preview(), confirmLabel } })
  const current = task({ graph, revision: 3, preview: { ...preview(5), confirmLabel } })
  tasks = [old]
  resumed = { task: current, reply: '第 3 版已按原单重新试算' }
  await render()
  expect(queryByRole(host, 'button', { name: confirmLabel })).toBeNull()
  await click('核对原预览')
  expect(getByRole(host, 'button', { name: confirmLabel })).toBeTruthy()
  expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/tasks/task-1/resume'))).toHaveLength(1)
  expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/confirm'))).toBe(false)
})

test.each([[408, undefined], [409, 'TASK_BUSY']] as const)('确认返回 %s 时只允许查询原任务结果', async (status, code) => {
  tasks = [task()]
  await render()
  fetchMock.mockRejectedValueOnce(new AssistantRequestError('暂未取得确认结果', status, code))
  await click('确认建单')
  expect(queryByRole(host, 'button', { name: '确认建单' })).toBeNull()
  resumed = { task: task({ state: 'RESULT_UNKNOWN' }), reply: '暂未核实到原请求回执' }
  await click('查询原任务结果')
  expect(queryByRole(host, 'button', { name: '确认建单' })).toBeNull()
  expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/tasks/task-1/confirm'))).toHaveLength(1)
  expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/tasks/task-1/resume'))).toHaveLength(1)
})

test.each([['B2-reserve', '原占库已释放，当前仍占 0 个'], ['D-settle', '原核销已冲回 ¥4.00，当前欠款 ¥39.00']])(
  '恢复已完成的 %s 先读取当前原单，避免显示旧确认卡', async (graph, reply) => {
    tasks = [task({ graph, state: 'DONE', reviewRequired: true, reply: '打开后核对当前状态', preview: undefined })]
    resumed = { task: task({ graph, state: 'DONE', preview: undefined }), reply }
    await render()
    expect(host.textContent).toContain(reply)
    expect(queryByRole(host, 'button', { name: '确认建单' })).toBeNull()
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/tasks/task-1/resume'))).toHaveLength(1)
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/confirm'))).toBe(false)
  },
)
