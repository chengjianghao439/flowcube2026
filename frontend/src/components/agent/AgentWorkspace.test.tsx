// @vitest-environment jsdom
import { act, StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { getByRole, getAllByRole, queryByRole } from '@testing-library/dom'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { useAuthStore } from '@/store/authStore'
import type { User } from '@/types'
import AgentWorkspace from './AgentWorkspace'
import { AssistantRequestError } from '@/api/assistant'

vi.mock('@/hooks/useActiveWorkspaceTab', () => ({ useActiveWorkspaceTab: () => true }))
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
let tasks: unknown[], chat: unknown, confirmed: unknown
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, ResizeObserver: class { observe() {} unobserve() {} disconnect() {} } })
  useAuthStore.setState({ token: 'synthetic-token', user: { id: 1, username: 'owner', roleId: 1, permissions: [] } as unknown as User, sessionGeneration: 1 })
  tasks = []; chat = {}; confirmed = {}
  fetchMock.mockReset().mockImplementation(async (input, init) => {
    const url = String(input)
    if (url.endsWith('/health')) return response({ planner: 'llm' })
    if (url.endsWith('/me')) return response({ realName: '测试人员', roleName: '测试岗位', warehouseScope: '全部仓库' })
    if (url.endsWith('/tasks')) return response({ tasks })
    if (url.endsWith('/chat')) return response(chat)
    if (url.endsWith('/confirm')) return response(confirmed)
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
  confirmed = { reply: '原销售单已创建，已核对', task: { id: 'task-1', graph: 'B-sale-draft', state: 'DONE' } }
  await click('查询原任务结果')
  expect(host.textContent).toContain('原销售单已创建，已核对')
  expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/tasks/task-1/confirm'))).toHaveLength(2)
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
test('极序说明的重点与列表可读，模型文本不会作为HTML执行', async () => {
  await render()
  chat = { reply: '先看**关键信息**。\n\n1. 统一标题\n2. 保留当前草稿\n\n<script>synthetic()</script>', task: { id: 'discuss-1', graph: 'G-chat', state: 'DONE' } }
  await send('极序页面设计怎样更清楚？')
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
