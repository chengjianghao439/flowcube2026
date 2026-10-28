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
import { createPreviewFreezeStore } from './previewFreeze'
import { SectionVisibilityContext } from '@/components/layout/SectionVisibilityContext'

const transport = vi.hoisted(() => ({ baseURL: '/api', listeners: new Set<() => void>() }))
vi.mock('@/api/client', () => {
  class ApiClientError extends Error {
    status?: number; code?: string
    constructor(message: string, status: number, code?: string) { super(message); this.status = status; this.code = code }
  }
  return {
    ApiClientError, getApiClientBaseURL: () => transport.baseURL, subscribeApiClientBaseURL: (listener: () => void) => { transport.listeners.add(listener); return () => transport.listeners.delete(listener) },
    default: { request: async (config: { url: string; method: string; data?: unknown; signal?: AbortSignal }) => {
      const response = await fetch(config.url, { method: config.method, body: config.data === undefined ? undefined : JSON.stringify(config.data), signal: config.signal })
      const data = await response.json()
      if (!response.ok) throw new ApiClientError(data.error, response.status, data.code)
      return { data: { success: true, data } }
    } },
  }
})
let root: Root, host: HTMLDivElement
let sectionActive = true
const fetchMock = vi.fn<typeof fetch>()
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
const preview = (qty = 4) => ({ title: '销售草稿', customer: { name: '测试客户' }, warehouseName: '测试仓', totalCents: 1235 * qty, lines: [{ productId: 1, productName: '测试商品', qty, unitPrice: 12.35 }], confirmLabel: '确认建单', expiresAt: '2099-10-26T12:00:00Z' })
const task = (extra = {}) => ({ id: 'task-1', graph: 'B-sale-draft', state: 'AWAITING_CONFIRM', userText: '给测试客户开单四个', revision: 1, preview: preview(), ...extra })
let tasks: unknown[], chat: unknown, confirmed: unknown
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, ResizeObserver: class { observe() {} unobserve() {} disconnect() {} } })
  localStorage.clear(); transport.baseURL = '/api'; transport.listeners.clear()
  useAuthStore.setState({ token: 'synthetic-token', user: { id: 1, username: 'owner', roleId: 1, permissions: [] } as unknown as User, sessionGeneration: 1 })
  tasks = []; chat = {}; confirmed = {}; sectionActive = true
  fetchMock.mockReset().mockImplementation(async (input, init) => {
    const url = String(input)
    if (url.endsWith('/health')) return response({ planner: 'llm' })
    if (url.endsWith('/me')) return response({ realName: '测试人员', roleName: '测试岗位', warehouseScope: '全部仓库' })
    if (url.endsWith('/tasks')) return response({ tasks })
    if (url.endsWith('/chat')) return response(chat)
    if (url.endsWith('/confirm')) return response(confirmed)
    if (init?.method === 'GET' || !init?.method) return response({ task: tasks.find(row => (row as { id: string }).id === decodeURIComponent(url.split('/').at(-1)!)) })
    throw new Error('Unexpected synthetic request')
  })
  vi.stubGlobal('fetch', fetchMock)
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks() })
async function render() { await act(async () => root.render(<MemoryRouter initialEntries={['/assistant']}><SectionVisibilityContext.Provider value={sectionActive}><AgentWorkspace /></SectionVisibilityContext.Provider></MemoryRouter>)) }
async function setActive(value: boolean) { sectionActive = value; await render() }
async function restoreFirstRecord() {
  if (!host.querySelector('.xiaoman-history-item[aria-current="true"]')) {
    const row = host.querySelector<HTMLButtonElement>('.xiaoman-history-item')
    if (row) await act(async () => row.click())
  }
}
async function renderAndRestore() { await render(); await restoreFirstRecord() }
async function remountAndRestore() { await act(async () => root.unmount()); root = createRoot(host); await renderAndRestore() }
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
  await renderAndRestore()
  expect(getByRole(host, 'heading', { name: '小满', level: 1 })).toBeTruthy()
  expect(getByRole(host, 'textbox', { name: '告诉小满要做什么' })).toBeTruthy()
  expect(queryByRole(host, 'dialog')).toBeNull()
})
test('预览呈现完整客户价格来源，保留自定义、未知来源与旧等级回退', async () => {
  tasks = [task({ preview: { ...preview(), lines: [
    { productName: '等级甲', qty: 1, unitPrice: 1.2345, priceSource: { level: 'A', source: 'price_level', name: '价格A' } },
    { productName: '等级乙', qty: 1, unitPrice: 2, priceSource: { level: 'B', source: 'price_level' } },
    { productName: '自定义', qty: 1, unitPrice: 3, priceSource: { source: 'price_list', name: '合成客户专价表' } },
    { productName: '未知', qty: 1, unitPrice: 4, priceSource: { level: 'X', source: 'future_source', name: '合成未来来源' } },
    { productName: '旧快照', qty: 1, unitPrice: 5, priceSource: { level: 'A' } },
  ] } })]
  await renderAndRestore()
  for (const fact of ['客户等级价：价格A', '客户等级价：价格B', '客户价格表：合成客户专价表', '来源未识别', 'future_source', '合成未来来源', '来源未记录（价格A）', '1.2345']) expect(host.textContent).toContain(fact)
  expect(host.textContent).not.toMatch(/VIP|默认价/)
})
test('采购卡保留分组小计，占库卡保留单号与逐行可用事实', async () => {
  tasks = [task({ graph: 'C-purchase-draft', preview: { totalCents: 300, drafts: [{ supplierName: '合成供应商甲', totalCents: 100, lines: [{ productName: '合成商品甲', qty: 1 }] }, { supplierName: '合成供应商乙', totalCents: 200, lines: [{ productName: '合成商品乙', qty: 2 }] }] } })]
  await renderAndRestore()
  expect(host.textContent).toContain('本批草稿2张')
  expect(host.textContent).toContain('小计¥1.00')
  expect(host.textContent).toContain('小计¥2.00')
  for (const state of ['DONE', 'CANCELLED']) {
    tasks = [task({ graph: 'C-purchase-draft', state, preview: { totalCents: 300, drafts: [{ supplierName: '合成供应商甲', totalCents: 100, lines: [{ productName: '合成商品甲', qty: 1 }] }, { supplierName: '合成供应商乙', totalCents: 200, lines: [{ productName: '合成商品乙', qty: 2 }] }] } })]
    await remountAndRestore()
    expect(host.textContent).toContain('本批草稿2张')
    expect(host.textContent).not.toContain('将建')
  }
  tasks = [task({ graph: 'B2-reserve', preview: { orderNo: 'SL-SYN-12', totalRemain: 3, lines: [{ productName: '合成商品', qty: 3, available: 8 }] } })]
  await remountAndRestore()
  expect(host.textContent).toContain('SL-SYN-12')
  expect(host.textContent).toContain('可用 8')
  expect(host.textContent).toContain('待占合计3')
})
test('刷新后手动从当前用户任务列表恢复原预览，确认携带原任务与版本', async () => {
  tasks = [task()]; await renderAndRestore()
  confirmed = { reply: '合成销售单已创建', task: { id: 'task-1', graph: 'B-sale-draft', state: 'DONE' }, result: { orderId: 3, orderNo: 'SL-SYNTHETIC' } }
  await click('确认建单')
  const call = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/tasks/task-1/confirm'))!
  expect(JSON.parse(String(call[1]?.body))).toMatchObject({ revision: 1 })
  expect(host.textContent).toContain('合成销售单已创建')
  expect(queryByRole(host, 'button', { name: '确认建单' })).toBeNull()
})
test('同名候选可以点击，接续原任务只传候选稳定ID', async () => {
  chat = { reply: '请选择商品', task: { id: 'choose-1', graph: 'A-inventory', state: 'DISAMBIGUATING' }, candidates: [{ id: 7, title: '铰链长款', subtitle: 'P007' }, { id: 8, title: '铰链短款', subtitle: 'P008' }] }
  await renderAndRestore(); await send('查铰链库存')
  chat = { reply: '铰链长款库存20', task: { id: 'choose-1', graph: 'A-inventory', state: 'DONE' } }
  await click('铰链长款 P007')
  const calls = fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/chat'))
  expect(JSON.parse(String(calls.at(-1)![1]?.body))).toMatchObject({ taskId: 'choose-1', choiceId: 7 })
  expect(host.textContent).toContain('铰链长款库存20')
})
test('修改预览替换同任务卡片，始终只有一个有效确认入口', async () => {
  tasks = [task()]; await renderAndRestore()
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
  tasks = [task({ graph: 'D-receipt', preview: receiptPreview })]; await renderAndRestore()
  expect(getByRole(host, 'button', { name: '确认登记收款' }).hasAttribute('disabled')).toBe(true)
  chat = { reply: '已选择账户乙', task: { id: 'task-1', graph: 'D-receipt', state: 'AWAITING_CONFIRM', revision: 2 }, preview: { ...receiptPreview, account: { id: 2, name: '测试账户乙' } } }
  await click('测试账户乙')
  expect(getAllByRole(host, 'button', { name: '确认登记收款' })).toHaveLength(1)
  expect(getByRole(host, 'button', { name: '确认登记收款' }).hasAttribute('disabled')).toBe(false)
})
test('收款第一段进入核销第二段，原登记入口停止生效', async () => {
  tasks = [task({ graph: 'D-receipt', preview: { ...preview(), account: { id: 1, name: '测试账户' }, amountCents: 100, confirmLabel: '确认登记收款' } })]; await renderAndRestore()
  confirmed = { reply: '已登记，请核对核销分配', task: { id: 'stage-2', graph: 'D-settle', state: 'AWAITING_CONFIRM', revision: 1 }, preview: { title: '核销分配', totalCents: 100, lines: [], allocations: [], confirmLabel: '确认核销' } }
  await click('确认登记收款')
  expect(queryByRole(host, 'button', { name: '确认登记收款' })).toBeNull()
  expect(getByRole(host, 'button', { name: '确认核销' })).toBeTruthy()
})
test('发送失败保留草稿，任务恢复失败明确提示重试', async () => {
  await renderAndRestore(); fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
  await send('查测试商品库存')
  expect(getByRole(host, 'textbox')).toHaveProperty('value', '查测试商品库存')
  expect(host.textContent).toContain('连接失败')
})
test('改量响应丢失冻结旧卡，GET仍是旧版时必须澄清或继续原版', async () => {
  tasks = [task()]; await renderAndRestore()
  fetchMock.mockRejectedValueOnce(new TypeError('Connection lost'))
  await send('改成3个吧')
  expect(getByRole(host, 'textbox')).toHaveProperty('value', '改成3个吧')
  expect(getByRole(host, 'button', { name: '确认建单' }).hasAttribute('disabled')).toBe(true)
  await click('重新核对预览')
  expect(getByRole(host, 'button', { name: '确认建单' }).hasAttribute('disabled')).toBe(true)
  await click('刷新最近记录')
  await click('打开记录：销售草稿，给测试客户开单四个')
  expect(getByRole(host, 'button', { name: '确认建单' }).hasAttribute('disabled')).toBe(true)
  expect(host.textContent).toContain('继续原版')
  expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/confirm'))).toBe(false)
  chat = { task: task({ revision: 2, confirmationBlocked: null }), preview: preview(), reply: '已按原数量重新试算' }
  await send('继续原版')
  expect(getByRole(host, 'button', { name: '确认建单' }).hasAttribute('disabled')).toBe(false)
})
test('改量响应丢失后GET已是新版本，展示最新数量但仍须明确重试解除冻结', async () => {
  tasks = [task()]; await renderAndRestore()
  tasks = [task({ revision: 2, preview: preview(3), confirmationBlocked: null, reply: '数量4→3，已重新试算' })]
  fetchMock.mockRejectedValueOnce(new TypeError('Connection lost'))
  await send('改成3个吧')
  expect(host.textContent).toContain('×3')
  expect(host.textContent).not.toContain('×4')
  expect(getByRole(host, 'button', { name: '确认建单' }).hasAttribute('disabled')).toBe(true)
  expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/confirm'))).toBe(false)
})
for (const action of ['改量', '放弃']) {
  test(`${action}请求未达服务端且GET仍同版，卸载重挂后旧确认仍禁用`, async () => {
    tasks = [task()]; await renderAndRestore()
    fetchMock.mockRejectedValueOnce(new TypeError('Request not delivered'))
    if (action === '改量') await send('改成3个吧')
    else await click('放弃预览')
    await remountAndRestore()
    expect(getByRole(host, 'button', { name: '确认建单' }).hasAttribute('disabled')).toBe(true)
    await click('确认建单')
    await click('重新核对预览')
    expect(getByRole(host, 'button', { name: '确认建单' }).hasAttribute('disabled')).toBe(true)
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/confirm'))).toBe(false)
  })
}
test('改量发出后尚未进入catch即卸载，重挂也恢复冻结且迟到回复不能清除', async () => {
  tasks = [task()]; await renderAndRestore()
  let finish!: (value: Response) => void
  fetchMock.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  await send('改成3个吧')
  await remountAndRestore()
  expect(getByRole(host, 'button', { name: '确认建单' }).hasAttribute('disabled')).toBe(true)
  await act(async () => finish(response({ task: task({ revision: 2 }), preview: preview(3), reply: '已修改' })))
  expect(getByRole(host, 'button', { name: '确认建单' }).hasAttribute('disabled')).toBe(true)
})
test('冻结按账号与服务器隔离，同用户刷新或重登仍保留原任务冻结', async () => {
  tasks = [task()]; await renderAndRestore()
  fetchMock.mockRejectedValueOnce(new TypeError('Request not delivered'))
  await send('改成3个吧')
  await act(async () => useAuthStore.getState().setTokens('renewed-synthetic-token', null))
  await remountAndRestore()
  expect(getByRole(host, 'button', { name: '确认建单' }).hasAttribute('disabled')).toBe(true)
  await act(async () => useAuthStore.setState({ user: { id: 2, username: 'other', roleId: 1, permissions: [] } as unknown as User, sessionGeneration: 2 }))
  await restoreFirstRecord()
  expect(getByRole(host, 'button', { name: '确认建单' }).hasAttribute('disabled')).toBe(false)
  await act(async () => useAuthStore.setState({ user: { id: 1, username: 'owner', roleId: 1, permissions: [] } as unknown as User, sessionGeneration: 3 }))
  expect(getByRole(host, 'button', { name: '确认建单' }).hasAttribute('disabled')).toBe(true)
  await act(async () => { transport.baseURL = 'https://synthetic-other.invalid/api'; transport.listeners.forEach(listener => listener()) })
  await restoreFirstRecord()
  expect(getByRole(host, 'button', { name: '确认建单' }).hasAttribute('disabled')).toBe(false)
  await act(async () => { transport.baseURL = '/api'; transport.listeners.forEach(listener => listener()) })
  await restoreFirstRecord()
  expect(getByRole(host, 'button', { name: '确认建单' }).hasAttribute('disabled')).toBe(true)
  await act(async () => useAuthStore.setState({ sessionGeneration: 0 }))
  expect(getByRole(host, 'button', { name: '确认建单' }).hasAttribute('disabled')).toBe(true)
})
test('已有冻结不能被同版成功闲聊或文字确认解除', async () => {
  tasks = [task()]; await renderAndRestore()
  fetchMock.mockRejectedValueOnce(new TypeError('Request not delivered'))
  await send('改成3个吧')
  await remountAndRestore()
  chat = { task: task(), reply: '请点击卡片确认' }
  await send('确认')
  expect(getByRole(host, 'button', { name: '确认建单' }).hasAttribute('disabled')).toBe(true)
  await remountAndRestore()
  expect(getByRole(host, 'button', { name: '确认建单' }).hasAttribute('disabled')).toBe(true)
})
test('本轮成功但未修订的回复只清本轮临时冻结，正常卡片仍可确认', async () => {
  tasks = [task()]; await renderAndRestore()
  chat = { task: null, reply: '这一步请到原业务页面办理。' }
  await send('单价改3')
  await remountAndRestore()
  expect(getByRole(host, 'button', { name: '确认建单' }).hasAttribute('disabled')).toBe(false)
})
for (const outcome of ['服务端暂停', '取消']) {
  test(`持久冻结读取可信${outcome}后才解除本地标记`, async () => {
    tasks = [task()]; await renderAndRestore()
    fetchMock.mockRejectedValueOnce(new TypeError('Request not delivered'))
    await send('改成3个吧')
    await remountAndRestore()
    tasks = [task(outcome === '服务端暂停' ? { confirmationBlocked: '请明确行号' } : { state: 'CANCELLED' })]
    await click('重新核对预览')
    expect(Object.keys(localStorage).filter(key => key.startsWith('flowcube-assistant-preview-freeze-v2:'))).toHaveLength(0)
    if (outcome === '取消') expect(queryByRole(host, 'button', { name: '确认建单' })).toBeNull()
    else expect(getByRole(host, 'button', { name: '确认建单' }).hasAttribute('disabled')).toBe(outcome === '服务端暂停')
  })
}
test('冻结存储不可写时明确拒发修改与放弃，重挂仍不能确认', async () => {
  const originalSet = Storage.prototype.setItem
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
    if (this === localStorage) throw new DOMException('Storage unavailable', 'QuotaExceededError')
    originalSet.call(this, key, value)
  })
  tasks = [task()]; await renderAndRestore()
  await send('改成3个吧')
  expect(getByRole(host, 'textbox')).toHaveProperty('value', '改成3个吧')
  expect(host.textContent).toMatch(/存储|保存.*失败/)
  await click('放弃预览')
  await remountAndRestore()
  expect(getByRole(host, 'button', { name: '确认建单' }).hasAttribute('disabled')).toBe(true)
  expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false)
})
test('冻结记录损坏时保留原字节并禁止修改取消和确认', async () => {
  tasks = [task()]; await renderAndRestore()
  fetchMock.mockRejectedValueOnce(new TypeError('Request not delivered'))
  await send('改成3个吧')
  const key = Object.keys(localStorage).find(key => key.startsWith('flowcube-assistant-preview-freeze-v2:'))!
  expect(key).toBeTruthy()
  localStorage.setItem(key, '{malformed')
  await remountAndRestore()
  const posts = fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST').length
  await send('继续原版'); await click('放弃预览'); await click('确认建单')
  expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(posts)
  expect(localStorage.getItem(key)).toBe('{malformed')
  expect(host.textContent).toMatch(/存储|冻结记录/)
})
test('存储静默拒写也必须在发请求前拒绝，不假定setItem成功', async () => {
  const originalSet = Storage.prototype.setItem
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
    if (this !== localStorage) originalSet.call(this, key, value)
  })
  tasks = [task()]; await renderAndRestore(); await send('改成3个吧'); await click('放弃预览')
  expect(getByRole(host, 'button', { name: '确认建单' }).hasAttribute('disabled')).toBe(true)
  expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false)
  expect(host.textContent).toContain('存储')
})
test('冻结读取失败明确阻断；不会把读失败当作没有原标记', async () => {
  createPreviewFreezeStore().begin(task())
  const originalGet = Storage.prototype.getItem
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (this: Storage, key) {
    if (this === localStorage && key.startsWith('flowcube-assistant-preview-freeze-v2:')) throw new Error('Unreadable synthetic storage')
    return originalGet.call(this, key)
  })
  tasks = [task()]; await renderAndRestore(); await send('改成3个吧')
  expect(getByRole(host, 'button', { name: '确认建单' }).hasAttribute('disabled')).toBe(true)
  expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false)
})
test('明确重试成功但清理冻结失败时保持禁用，成功重试清理后才放开', async () => {
  tasks = [task()]; await renderAndRestore()
  fetchMock.mockRejectedValueOnce(new TypeError('Request not delivered'))
  await send('改成3个吧')
  const key = Object.keys(localStorage).find(key => key.startsWith('flowcube-assistant-preview-freeze-v2:'))!
  expect(localStorage.getItem(key)).not.toMatch(/synthetic-token|改成3个|测试客户|测试商品/)
  const originalRemove = Storage.prototype.removeItem
  const remove = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(function (this: Storage, target) {
    if (this !== localStorage || target !== key) originalRemove.call(this, target)
  })
  chat = { task: task({ revision: 2, preview: preview(3) }), reply: '已明确重新试算' }
  await send('继续原版')
  expect(getByRole(host, 'button', { name: '确认建单' }).hasAttribute('disabled')).toBe(true)
  expect(localStorage.getItem(key)).not.toBeNull()
  remove.mockRestore()
  chat = { task: task({ revision: 3, preview: preview(3) }), reply: '已明确重新试算' }
  await send('继续原版')
  expect(getByRole(host, 'button', { name: '确认建单' }).hasAttribute('disabled')).toBe(false)
  expect(localStorage.getItem(key)).toBeNull()
})
test('改量失败阻断随安全视图恢复，澄清成功新版本才恢复确认', async () => {
  tasks = [task({ confirmationBlocked: '请明确要改哪一行，旧预览确认已暂停。' })]; await renderAndRestore()
  expect(getByRole(host, 'button', { name: '确认建单' }).hasAttribute('disabled')).toBe(true)
  chat = { task: task({ revision: 2, confirmationBlocked: null }), preview: preview(3), reply: '第1行 4→3' }
  await send('第1行改3个')
  expect(getByRole(host, 'button', { name: '确认建单' }).hasAttribute('disabled')).toBe(false)
  expect(host.textContent).toContain('×3')
})
test('放弃响应丢失只GET核对原任务，不通过confirm查询取消结果', async () => {
  tasks = [task()]; await renderAndRestore()
  fetchMock.mockRejectedValueOnce(new TypeError('Connection lost'))
  await click('放弃预览')
  expect(getByRole(host, 'button', { name: '确认建单' }).hasAttribute('disabled')).toBe(true)
  expect(queryByRole(host, 'button', { name: '查询原任务结果' })).toBeNull()
  tasks = [task({ state: 'CANCELLED', reply: '已放弃预览，尚未建单。' })]
  await click('重新核对预览')
  expect(queryByRole(host, 'button', { name: '确认建单' })).toBeNull()
  expect(host.textContent).toContain('已放弃预览')
  expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/cancel'))).toHaveLength(1)
  expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/confirm'))).toBe(false)
})
test('核销预览可放弃但保留已登记收款结果，未知结果不提供取消', async () => {
  tasks = [task({ graph: 'D-settle', preview: { ...preview(), receiptId: 7, receiptNo: 'RC-SYNTHETIC-7', confirmLabel: '确认核销' } })]; await renderAndRestore()
  fetchMock.mockResolvedValueOnce(response({ task: task({ graph: 'D-settle', state: 'CANCELLED' }), reply: '已放弃核销预览，收款已登记。' }))
  await click('放弃预览')
  expect(host.textContent).toContain('收款已登记')
  expect(queryByRole(host, 'button', { name: '确认核销' })).toBeNull()
  tasks = [task({ state: 'RESULT_UNKNOWN' })]
  await click('刷新最近记录')
  expect(queryByRole(host, 'button', { name: '放弃预览' })).toBeNull()
})
test('换用户时清除原对话，迟到响应不能进入新会话', async () => {
  await renderAndRestore()
  let finish!: (value: Response) => void
  fetchMock.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  await send('原用户私有任务')
  await act(async () => useAuthStore.setState({ token: 'other-synthetic-token', sessionGeneration: 2 }))
  await act(async () => finish(response({ reply: '原用户私有结果' })))
  expect(host.textContent).not.toContain('原用户私有任务')
  expect(host.textContent).not.toContain('原用户私有结果')
})
test('旧版本确认被拒时回读原任务的新预览，不重复执行', async () => {
  tasks = [task()]; await renderAndRestore()
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
  tasks = [task()]; await renderAndRestore()
  fetchMock.mockRejectedValueOnce(new TypeError('Connection lost'))
  await click('确认建单')
  confirmed = { reply: '原销售单已创建，已核对', task: { id: 'task-1', graph: 'B-sale-draft', state: 'DONE' } }
  await click('查询原任务结果')
  expect(host.textContent).toContain('原销售单已创建，已核对')
  expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/tasks/task-1/confirm'))).toHaveLength(2)
  expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/chat'))).toBe(false)
})
test('正式传输的网络错误状态0恢复原任务，不保留普通确认按钮', async () => {
  tasks = [task()]; await renderAndRestore()
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
  await renderAndRestore()
  expect(host.textContent).toContain('最近记录读取失败')
  fail = false; await click('重试读取任务'); await restoreFirstRecord()
  expect(getByRole(host, 'button', { name: '确认建单' })).toBeTruthy()
})
test('开发严格模式中初始化可重入，仍能找回任务且没有业务POST', async () => {
  tasks = [task()]
  await act(async () => root.render(<StrictMode><MemoryRouter initialEntries={['/assistant']}><AgentWorkspace /></MemoryRouter></StrictMode>))
  await restoreFirstRecord()
  expect(getAllByRole(host, 'button', { name: '确认建单' })).toHaveLength(1)
  expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false)
})
test('占库预览只显示商品数量，不显示无意义零金额', async () => {
  tasks = [task({ graph: 'B2-reserve', preview: { ...preview(), totalCents: 0, confirmLabel: '确认占库' } })]
  await renderAndRestore()
  expect(host.textContent).toContain('×4')
  expect(host.textContent).not.toContain('¥0.00')
})
test('极序说明的重点与列表可读，模型文本不会作为HTML执行', async () => {
  await renderAndRestore()
  chat = { reply: '先看**关键信息**。\n\n1. 统一标题\n2. 保留当前草稿\n\n<script>synthetic()</script>', task: { id: 'discuss-1', graph: 'G-chat', state: 'DONE' } }
  await send('极序页面设计怎样更清楚？')
  expect(host.querySelector('.xiaoman-message-text strong')?.textContent).toBe('关键信息')
  expect(getByRole(host, 'list').querySelectorAll('li')).toHaveLength(2)
  expect(host.querySelector('script')).toBeNull()
  expect(host.textContent).toContain('<script>synthetic()</script>')
})
test('服务端不再返回当前记录时，刷新移除原快照和确认入口', async () => {
  tasks = [task()]; await renderAndRestore()
  tasks = []; await click('刷新最近记录')
  expect(host.textContent).not.toContain('给测试客户开单四个')
  expect(queryByRole(host, 'button', { name: '确认建单' })).toBeNull()
})

test('不能代办的反馈显示白名单业务页入口，不把模型链接当入口', async () => {
  chat = { reply: '这一步我目前不能代办。请到原页面办理。https://untrusted.example/ [按钮](https://untrusted.example/)', businessPages: ['sale', 'price-change', 'https://untrusted.example/', '__proto__'] }
  await renderAndRestore(); await send('删掉这张草稿')
  expect(getByRole(host, 'button', { name: '前往销售订单' })).toBeTruthy()
  expect(getByRole(host, 'button', { name: '前往商品改价申请' })).toBeTruthy()
  expect(host.querySelectorAll('a')).toHaveLength(0)
  expect(host.textContent).not.toContain('前往https:')
})
test('业务页入口按当前查看权限隐藏，撤权后立即收回', async () => {
  useAuthStore.setState({ user: { id: 1, username: 'owner', roleId: 5, permissions: ['sale.order.view'] } as unknown as User })
  chat = { reply: '我目前不能代办。', businessPages: ['sale', 'price-change', 'payable', 'approvals'] }
  await renderAndRestore(); await send('删掉这张草稿')
  expect(getByRole(host, 'button', { name: '前往销售订单' })).toBeTruthy()
  expect(queryByRole(host, 'button', { name: '前往商品改价申请' })).toBeNull()
  expect(queryByRole(host, 'button', { name: '前往供应商往来' })).toBeNull()
  await act(async () => useAuthStore.setState({ user: { id: 1, username: 'owner', roleId: 5, permissions: [] } as unknown as User }))
  expect(queryByRole(host, 'button', { name: '前往销售订单' })).toBeNull()
})


// T13: 首次加载与危险恢复分开验证；恢复动作必须真实点击原记录。
test('T13普通待确认和普通最近记录不自动展开，待办可手动恢复原ID', async () => {
  tasks = [task({ id: 'latest', state: 'DONE', userText: '最新已完成' }), task()]
  await render()
  expect(queryByRole(host, 'button', { name: '确认建单' })).toBeNull()
  expect(queryByRole(host, 'log')).toBeNull()
  expect(host.textContent).toContain('1 项待办')
  await click('打开记录：销售草稿，给测试客户开单四个')
  expect(getByRole(host, 'button', { name: '确认建单' })).toBeTruthy()
  expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/tasks/task-1'))).toBe(true)
  expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false)
})
for (const status of ['CONFIRMED', 'EXECUTING', 'RESULT_UNKNOWN', 'VERIFYING', 'ESCALATED']) {
  test(`T13危险状态${status}优先可见且保留原任务回查，新对话也不能隐藏提醒`, async () => {
    tasks = [task({ id: 'ordinary', state: 'AWAITING_CONFIRM', userText: '普通待确认' }), task({ id: 'risk', state: status, userText: '执行结果待核' })]
    await render()
    expect(getByRole(host, 'button', { name: '查询原任务结果' })).toBeTruthy()
    expect(getByRole(host, 'button', { name: /核对原任务：.*执行结果待核/ })).toBeTruthy()
    await click('新对话')
    expect(queryByRole(host, 'button', { name: '查询原任务结果' })).toBeNull()
    await click(getByRole(host, 'button', { name: /核对原任务：.*执行结果待核/ }).getAttribute('aria-label')!)
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/tasks/risk'))).toBe(true)
    expect(getByRole(host, 'button', { name: '查询原任务结果' })).toBeTruthy()
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false)
  })
}
test('T13只读未找到有独立状态，写失败和旧失败不能被显示成查询成功', async () => {
  tasks = [task({ id: 'not-found', graph: 'A-inventory', state: 'FAILED_FINAL', queryOutcome: 'not_found', preview: undefined, userText: '查合成缺货库存' }),
    task({ id: 'write-failed', state: 'FAILED_FINAL', queryOutcome: 'not_found', userText: '合成建单失败' }),
    task({ id: 'old-failed', graph: 'A-inventory', state: 'FAILED_FINAL', preview: undefined, error: '未找到或网络失败', userText: '旧记录' })]
  await render()
  const history = getByRole(host, 'complementary', { name: '最近记录' })
  const rows = getAllByRole(history, 'button', { name: /^打开记录：/ })
  expect(rows[0].textContent).toContain('未找到')
  expect(rows[1].textContent).toContain('未完成')
  expect(rows[2].textContent).toContain('未完成')
  expect(rows.some(row => /已完成|已答复/.test(row.textContent || ''))).toBe(false)
})
test('T13历史标题显示类型对象与收款阶段，仅显式关联的两个任务展示同笔收款', async () => {
  const receipt = task({ id: 'receipt-1', graph: 'D-receipt', state: 'DONE', userText: '测试客户到账25元核销', result: { receiptId: 71, receiptNo: 'RC-SYN-71', stage2TaskId: 'settle-1' } })
  const settle = task({ id: 'settle-1', graph: 'D-settle', userText: receipt.userText, preview: { customer: { name: '测试客户' }, receiptId: 71, receiptNo: 'RC-SYN-71', totalCents: 2500, allocations: [], confirmLabel: '确认核销' } })
  const unrelated = task({ id: 'same-text', graph: 'D-settle', userText: receipt.userText, preview: { ...settle.preview, receiptId: 72, receiptNo: 'RC-SYN-72' } })
  tasks = [settle, unrelated, receipt]
  await render()
  const group = getByRole(host, 'group', { name: '同笔收款：RC-SYN-71' })
  const stages = getAllByRole(group, 'button')
  expect(stages).toHaveLength(2)
  expect(stages[0].textContent).toContain('第1段')
  expect(stages[0].textContent).toContain('登记收款')
  expect(stages[1].textContent).toContain('第2段')
  expect(stages[1].textContent).toContain('核销分配')
  for (const row of stages) expect(row.textContent).toContain('测试客户')
  const all = getAllByRole(host, 'button', { name: /^打开记录：/ })
  expect(all).toHaveLength(3)
  expect(group.contains(all.find(row => row.textContent?.includes('RC-SYN-72'))!)).toBe(false)
  await act(async () => stages[0].click())
  await act(async () => stages[1].click())
  const readIds = fetchMock.mock.calls.filter(([url]) => /\/tasks\/(receipt-1|settle-1)$/.test(String(url))).map(([url]) => String(url))
  expect(readIds).toEqual(['/assistant/tasks/receipt-1', '/assistant/tasks/settle-1'])
  expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false)
})
test('T13同名同金额同时间与孤立stage ID不推断收款关联，仍最多30条', async () => {
  tasks = Array.from({ length: 35 }, (_, index) => task({ id: `row-${index}`, graph: index % 2 ? 'D-receipt' : 'D-settle', userText: '完全相同', updatedAt: '2026-10-28T00:00:00Z', preview: { customer: { name: '同名客户' }, amountCents: 100 }, result: index === 1 ? { stage2TaskId: 'invisible-stage' } : undefined }))
  await render()
  expect(queryByRole(host, 'group', { name: /^同笔收款/ })).toBeNull()
  expect(getAllByRole(host, 'button', { name: /^打开记录：/ })).toHaveLength(30)
  expect(host.textContent).toContain('显示最近30项记录')
})
test('T13历史读取失败可重试，成功后普通待办仍须手动恢复，过期不恢复确认', async () => {
  tasks = [task({ state: 'EXPIRED' })]
  const original = fetchMock.getMockImplementation()!
  let fail = true
  fetchMock.mockImplementation(async (url, init) => String(url).endsWith('/tasks') && fail ? response({ error: 'unavailable' }, 503) : original(url, init))
  await render()
  expect(host.textContent).toContain('最近记录读取失败')
  fail = false; await click('重试读取任务')
  expect(queryByRole(host, 'region', { name: '当前业务预览' })).toBeNull()
  await click('打开记录：销售草稿，给测试客户开单四个')
  expect(host.textContent).toContain('这份预览已失效')
  expect(queryByRole(host, 'button', { name: '确认建单' })).toBeNull()
})
test('T13换账号和服务器隔离手动选择，迟到历史不覆盖新身份记录', async () => {
  const original = fetchMock.getMockImplementation()!
  let finish!: (value: Response) => void
  fetchMock.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  await render()
  tasks = [task({ id: 'other', userText: '新用户任务' })]
  await act(async () => useAuthStore.setState({ user: { id: 2, username: 'other', roleId: 1, permissions: [] } as unknown as User, sessionGeneration: 2 }))
  await act(async () => finish(response({ tasks: [task({ userText: '原账号私有历史' })] })))
  expect(host.textContent).not.toContain('原账号私有历史')
  expect(queryByRole(host, 'button', { name: '确认建单' })).toBeNull()
  await click('打开记录：销售草稿，新用户任务')
  tasks = [task({ id: 'other-server', userText: '新服务器任务' })]
  await act(async () => { transport.baseURL = 'https://synthetic-other.invalid/api'; transport.listeners.forEach(listener => listener()) })
  expect(queryByRole(host, 'log')).toBeNull()
  expect(host.textContent).not.toContain('新用户任务')
  expect(getByRole(host, 'button', { name: '打开记录：销售草稿，新服务器任务' })).toBeTruthy()
  expect(fetchMock.getMockImplementation()).toBe(original)
})
test('T13并发初始化仅接受最新历史，迟到失败不能清除当前待核任务', async () => {
  const original = fetchMock.getMockImplementation()!
  let rejectFirst!: (cause: Error) => void
  let reads = 0
  tasks = [task({ id: 'current-risk', state: 'VERIFYING' })]
  fetchMock.mockImplementation(async (url, init) => {
    if (String(url).endsWith('/tasks') && ++reads === 1) return new Promise((_resolve, reject) => { rejectFirst = reject })
    return original(url, init)
  })
  await act(async () => root.render(<StrictMode><MemoryRouter initialEntries={['/assistant']}><AgentWorkspace /></MemoryRouter></StrictMode>))
  expect(getByRole(host, 'button', { name: '查询原任务结果' })).toBeTruthy()
  await act(async () => rejectFirst(new Error('late history error')))
  expect(getByRole(host, 'button', { name: '查询原任务结果' })).toBeTruthy()
  expect(host.textContent).not.toContain('最近记录读取失败')
})

for (const frozen of [false, true]) {
  test(`T13同归属历史503保留${frozen ? '本地冻结' : '结果未知'}的原ID恢复入口`, async () => {
    tasks = [task(frozen ? {} : { state: 'RESULT_UNKNOWN' })]
    await render()
    if (frozen) {
      await click('打开记录：销售草稿，给测试客户开单四个')
      fetchMock.mockRejectedValueOnce(new TypeError('lost modification'))
      await send('改成3个吧')
    }
    const original = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation(async (url, init) => String(url).endsWith('/tasks') ? response({ error: 'temporary' }, 503) : original(url, init))
    await click('刷新最近记录')
    expect(host.textContent).toContain('最近记录读取失败')
    expect(getByRole(host, 'button', { name: '打开记录：销售草稿，给测试客户开单四个' })).toBeTruthy()
    if (frozen) {
      expect(getByRole(host, 'button', { name: '确认建单' }).hasAttribute('disabled')).toBe(true)
      await click('重新核对预览')
      expect(getByRole(host, 'button', { name: '确认建单' }).hasAttribute('disabled')).toBe(true)
    } else {
      confirmed = { task: task({ state: 'DONE' }), reply: '原结果已核实' }
      await click('查询原任务结果')
      expect(host.textContent).toContain('原结果已核实')
    }
    const posts = fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST').map(([url]) => String(url))
    expect(posts).toEqual([frozen ? '/assistant/chat' : '/assistant/tasks/task-1/confirm'])
  })
}
for (const denied of [401, 403]) {
  test(`T13同归属历史${denied}仍收回原敏感任务与恢复入口`, async () => {
    tasks = [task({ state: 'RESULT_UNKNOWN' })]; await render()
    fetchMock.mockResolvedValueOnce(response({ error: 'denied' }, denied))
    await click('刷新最近记录')
    expect(queryByRole(host, 'button', { name: '查询原任务结果' })).toBeNull()
    expect(queryByRole(host, 'button', { name: /核对原任务：/ })).toBeNull()
    expect(host.textContent).not.toContain('测试客户')
    expect(host.textContent).toContain('最近记录读取失败')
  })
}
test('T13原选中未知任务移出最近30条后只GET原ID复核并继续原回执入口', async () => {
  const originalTask = task({ state: 'RESULT_UNKNOWN', reply: '原任务执行结果待核' })
  tasks = [originalTask]; await render()
  tasks = Array.from({ length: 30 }, (_, index) => task({ id: `new-${index}`, state: 'DONE', userText: `新记录${index}` }))
  const original = fetchMock.getMockImplementation()!
  fetchMock.mockImplementation(async (url, init) => String(url).endsWith('/tasks/task-1') ? response({ task: originalTask }) : original(url, init))
  await click('刷新最近记录')
  expect(getAllByRole(host, 'button', { name: /^打开记录：/ })).toHaveLength(30)
  expect(getByRole(host, 'button', { name: '查询原任务结果' })).toBeTruthy()
  expect(getByRole(host, 'button', { name: /核对原任务：/ })).toBeTruthy()
  expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/tasks/task-1'))).toHaveLength(1)
  confirmed = { task: task({ state: 'DONE' }), reply: '原键回执已核实' }
  await click('查询原任务结果')
  expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST').map(([url]) => String(url))).toEqual(['/assistant/tasks/task-1/confirm'])
})
for (const status of [503, 403, 404]) {
  test(`T13最近窗口外原任务GET${status}${status === 503 ? '保留危险恢复并说明失败' : '收回旧快照'}`, async () => {
    tasks = [task({ state: 'RESULT_UNKNOWN' })]; await render()
    tasks = Array.from({ length: 30 }, (_, index) => task({ id: `new-${index}`, state: 'DONE' }))
    const original = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation(async (url, init) => String(url).endsWith('/tasks/task-1') ? response({ error: 'cannot read original' }, status) : original(url, init))
    await click('刷新最近记录')
    if (status === 503) {
      expect(getByRole(host, 'button', { name: '查询原任务结果' })).toBeTruthy()
      expect(host.textContent).toContain('原任务暂时无法复核')
    } else {
      expect(queryByRole(host, 'button', { name: '查询原任务结果' })).toBeNull()
      expect(queryByRole(host, 'button', { name: /核对原任务：/ })).toBeNull()
    }
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false)
  })
}
test('T13只读已完成任务遇存储不可用不误报危险恢复', async () => {
  const original = Storage.prototype.setItem
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
    if (this === localStorage) throw new Error('synthetic storage failure')
    original.call(this, key, value)
  })
  tasks = [task({ graph: 'A-inventory', state: 'DONE', preview: undefined })]
  await render()
  expect(queryByRole(host, 'log')).toBeNull()
  expect(queryByRole(host, 'button', { name: /核对原任务：/ })).toBeNull()
  expect(getByRole(host, 'button', { name: /^打开记录：/ }).textContent).toContain('已完成')
})

test('T13窗口外预览的后续存储失败也保留冻结禁用，不能出现无效确认入口', async () => {
  const originalTask = task()
  tasks = [originalTask]; await render()
  await click('打开记录：销售草稿，给测试客户开单四个')
  tasks = Array.from({ length: 30 }, (_, index) => task({ id: `new-${index}`, state: 'DONE' }))
  const original = fetchMock.getMockImplementation()!
  fetchMock.mockImplementation(async (url, init) => String(url).endsWith('/tasks/task-1') ? response({ task: originalTask }) : original(url, init))
  await click('刷新最近记录')
  const originalSet = Storage.prototype.setItem
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
    if (this === localStorage) throw new Error('synthetic storage blocked')
    originalSet.call(this, key, value)
  })
  await send('改成3个吧')
  expect(getByRole(host, 'button', { name: '确认建单' }).hasAttribute('disabled')).toBe(true)
  expect(getByRole(host, 'button', { name: /核对原任务：/ })).toBeTruthy()
  await click('放弃预览'); await click('确认建单')
  expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false)
})

test('T13本地确认未知在新对话与手动恢复后仍保留原结果查询入口', async () => {
  tasks = [task()]; await render()
  await click('打开记录：销售草稿，给测试客户开单四个')
  fetchMock.mockRejectedValueOnce(new TypeError('lost confirm'))
  await click('确认建单')
  await click('新对话')
  expect(getByRole(host, 'button', { name: /核对原任务：/ })).toBeTruthy()
  await click('打开记录：销售草稿，给测试客户开单四个')
  expect(getByRole(host, 'button', { name: '查询原任务结果' })).toBeTruthy()
  expect(queryByRole(host, 'button', { name: '确认建单' })).toBeNull()
  confirmed = { task: task({ state: 'DONE' }), reply: '原执行已核实' }
  await click('查询原任务结果')
  expect(queryByRole(host, 'button', { name: /核对原任务：/ })).toBeNull()
  expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/tasks/task-1/confirm'))).toHaveLength(2)
})

test('T13登记阶段可按显式第二段ID恢复窗口外原核销，过期仍无新确认或业务POST', async () => {
  const first = task({ id: 'registered', graph: 'D-receipt', state: 'DONE', result: { receiptId: 81, stage2TaskId: 'original-settle' } })
  tasks = [first]; await render()
  const original = fetchMock.getMockImplementation()!
  fetchMock.mockImplementation(async (url, init) => String(url).endsWith('/tasks/original-settle') ? response({ task: task({ id: 'original-settle', graph: 'D-settle', state: 'EXPIRED', preview: { receiptId: 81, receiptNo: 'RC-SYN-81', confirmLabel: '确认核销' } }) }) : original(url, init))
  await click('打开记录：登记收款，给测试客户开单四个')
  await click('恢复原核销任务')
  expect(host.textContent).toContain('这份预览已失效')
  expect(queryByRole(host, 'button', { name: '确认核销' })).toBeNull()
  expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/tasks/original-settle'))).toHaveLength(1)
  expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false)
})


for (const source of ['列表', '窗口外详情']) {
  for (const terminal of ['DONE', 'FAILED_FINAL', 'EXPIRED', 'CANCELLED']) {
    test(`T13同ID权威${source}终态${terminal}清除本地确认未知提醒`, async () => {
      tasks = [task()]; await renderAndRestore()
      fetchMock.mockRejectedValueOnce(new TypeError('lost confirm'))
      await click('确认建单')
      expect(getByRole(host, 'button', { name: '查询原任务结果' })).toBeTruthy()
      tasks = [task({ state: 'RESULT_UNKNOWN' })]
      await click('刷新最近记录')
      expect(getByRole(host, 'button', { name: '查询原任务结果' })).toBeTruthy()
      const terminalTask = task({ state: terminal })
      if (source === '列表') tasks = [terminalTask]
      else {
        tasks = Array.from({ length: 30 }, (_, index) => task({ id: `recent-${index}`, state: 'DONE' }))
        const original = fetchMock.getMockImplementation()!
        fetchMock.mockImplementation(async (url, init) => String(url).endsWith('/tasks/task-1') ? response({ task: terminalTask }) : original(url, init))
      }
      await click('刷新最近记录')
      expect(queryByRole(host, 'button', { name: '查询原任务结果' })).toBeNull()
      expect(queryByRole(host, 'button', { name: /核对原任务：/ })).toBeNull()
      expect(queryByRole(host, 'button', { name: '确认建单' })).toBeNull()
      if (source === '窗口外详情') expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/tasks/task-1'))).toHaveLength(2) // 手动恢复一次，窗口外复核一次
      expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST').map(([url]) => String(url))).toEqual(['/assistant/tasks/task-1/confirm'])
    })
  }
}
test('T13其他ID终态和同ID非终态均不解除原确认未知提醒', async () => {
  tasks = [task()]; await renderAndRestore()
  fetchMock.mockRejectedValueOnce(new TypeError('lost confirm'))
  await click('确认建单')
  tasks = [task({ state: 'AWAITING_CONFIRM' }), task({ id: 'other-done', state: 'DONE' })]
  await click('刷新最近记录')
  expect(getByRole(host, 'button', { name: '查询原任务结果' })).toBeTruthy()
  expect(queryByRole(host, 'button', { name: '确认建单' })).toBeNull()
  expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1)
})


for (const kind of ['server', 'local', 'freeze', 'storage']) {
  for (const action of ['新对话', '其他记录']) {
    test(`T13窗口外${kind}恢复独立于选中卡，切到${action}仍可按原ID恢复`, async () => {
      const originalTask = task({ id: 'risk-original', userText: '待核甲', state: kind === 'server' ? 'RESULT_UNKNOWN' : 'AWAITING_CONFIRM' })
      if (kind === 'freeze') createPreviewFreezeStore().begin(originalTask)
      if (kind === 'storage') vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('synthetic unavailable storage') })
      tasks = [originalTask]; await render()
      if (kind === 'local') {
        await click('打开记录：销售草稿，待核甲')
        fetchMock.mockRejectedValueOnce(new TypeError('lost confirmation'))
        await click('确认建单')
      }
      const original = fetchMock.getMockImplementation()!
      fetchMock.mockImplementation(async (url, init) => String(url).endsWith('/tasks/risk-original') ? response({ task: originalTask }) : original(url, init))
      tasks = Array.from({ length: 30 }, (_, index) => task({ id: `recent-${index}`, state: 'DONE', userText: `新记录${index}` }))
      await click('刷新最近记录')
      expect(getAllByRole(host, 'button', { name: /^打开记录：/ })).toHaveLength(30)
      expect(getByRole(host, 'button', { name: /核对原任务：.*待核甲/ })).toBeTruthy()
      await click(action === '新对话' ? '新对话' : '打开记录：销售草稿，新记录0')
      const recovery = getByRole(host, 'button', { name: /核对原任务：.*待核甲/ })
      await act(async () => recovery.click())
      if (kind === 'server' || kind === 'local') expect(getByRole(host, 'button', { name: '查询原任务结果' })).toBeTruthy()
      else {
        expect(getByRole(host, 'button', { name: '确认建单' }).hasAttribute('disabled')).toBe(true)
        expect(getByRole(host, 'button', { name: '重新核对预览' })).toBeTruthy()
      }
      expect(getAllByRole(host, 'region', { name: '当前业务预览' })).toHaveLength(1)
      expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(kind === 'local' ? 1 : 0)
    })
  }
}
for (const kind of ['RESULT_UNKNOWN', 'freeze', 'local']) {
  test(`T13多个窗口外${kind}保留独立原ID，权威撤回只移除对应项`, async () => {
    const originals = [task({ id: 'risk-a', userText: '待核甲', state: kind === 'RESULT_UNKNOWN' ? kind : 'AWAITING_CONFIRM' }), task({ id: 'risk-b', userText: '待核乙', state: kind === 'RESULT_UNKNOWN' ? kind : 'AWAITING_CONFIRM' })]
    if (kind === 'freeze') { const store = createPreviewFreezeStore(); originals.forEach(row => store.begin(row)) }
    tasks = originals; await render()
    await click('打开记录：销售草稿，待核乙')
    if (kind === 'local') {
      for (const row of originals) {
        await click(`打开记录：销售草稿，${row.userText}`)
        fetchMock.mockRejectedValueOnce(new TypeError('lost confirmation'))
        await click('确认建单')
      }
    }
    const originalFetch = fetchMock.getMockImplementation()!
    const fresh = new Map(originals.map(row => [row.id, row]))
    let revoked = false
    fetchMock.mockImplementation(async (url, init) => {
      const id = String(url).split('/').at(-1)!
      if (fresh.has(id)) return revoked && id === 'risk-b' ? response({ error: 'revoked' }, 403) : response({ task: fresh.get(id) })
      return originalFetch(url, init)
    })
    tasks = Array.from({ length: 30 }, (_, index) => task({ id: `recent-${index}`, state: 'DONE', userText: `新记录${index}` }))
    await click('刷新最近记录'); await click('新对话')
    expect(getByRole(host, 'button', { name: /核对原任务：.*待核甲/ })).toBeTruthy()
    expect(getByRole(host, 'button', { name: /核对原任务：.*待核乙/ })).toBeTruthy()
    revoked = true; await click('刷新最近记录')
    expect(getByRole(host, 'button', { name: /核对原任务：.*待核甲/ })).toBeTruthy()
    expect(queryByRole(host, 'button', { name: /核对原任务：.*待核乙/ })).toBeNull()
    expect(host.textContent).toContain('勿另发重复请求')
    fresh.set('risk-a', { ...originals[0], state: 'DONE' }); await click('刷新最近记录')
    expect(queryByRole(host, 'button', { name: /核对原任务：/ })).toBeNull()
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(kind === 'local' ? 2 : 0)
  })
}

for (const status of [401, 403, 404]) {
  test(`T13危险原任务GET${status}撤敏感快照但不暗示未执行或可重办`, async () => {
    tasks = [task({ state: 'RESULT_UNKNOWN', userText: '敏感待核对象' })]; await render()
    fetchMock.mockResolvedValueOnce(response({ error: '任务不可读' }, status))
    await click('打开记录：销售草稿，敏感待核对象')
    expect(host.textContent).not.toContain('敏感待核对象')
    expect(host.textContent).toContain('原任务暂不可读取，请核对原业务结果，勿另发重复请求')
    expect(queryByRole(host, 'button', { name: /核对原任务：/ })).toBeNull()
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false)
  })
}
test('T13普通只读记录404保持原未找到错误，不冒充执行未知', async () => {
  tasks = [task({ graph: 'A-inventory', state: 'DONE', preview: undefined })]; await render()
  fetchMock.mockResolvedValueOnce(response({ error: '查询记录未找到' }, 404))
  await click('打开记录：库存查询，给测试客户开单四个')
  expect(host.textContent).toContain('查询记录未找到')
  expect(host.textContent).not.toContain('勿另发重复请求')
})

test('T13原确认未知的冲突回读被拒也撤回对应恢复快照并提示勿重复办理', async () => {
  tasks = [task()]; await renderAndRestore()
  fetchMock.mockRejectedValueOnce(new TypeError('lost confirmation'))
  await click('确认建单')
  const original = fetchMock.getMockImplementation()!
  fetchMock.mockImplementation(async (url, init) => String(url).endsWith('/confirm') ? response({ error: '预览变化', code: 'PREVIEW_REVISION_CONFLICT' }, 409) : String(url).endsWith('/tasks/task-1') ? response({ error: 'revoked' }, 403) : original(url, init))
  await click('查询原任务结果')
  expect(queryByRole(host, 'button', { name: /核对原任务：/ })).toBeNull()
  expect(host.textContent).toContain('勿另发重复请求')
  expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(2)
})


for (const inWindow of [false, true]) {
  for (const resolution of ['DONE', '403']) {
    test(`T13真实隐藏再激活的迟到历史不能${inWindow ? '用窗口旧版覆盖新详情' : '清除窗口外新选中卡'}，仍处理旁项${resolution}`, async () => {
      const known = task({ id: 'known-a', state: 'RESULT_UNKNOWN', userText: '后台待核A' })
      const oldB = task({ id: 'selected-b', userText: '手动恢复B', revision: 1, preview: preview(4) })
      const freshB = task({ ...oldB, revision: 2, preview: preview(9), reply: '已取得B的新详情' })
      tasks = [known, oldB]; await render(); await click('新对话')
      const original = fetchMock.getMockImplementation()!
      let finishB!: (value: Response) => void, finishKnown!: (value: Response) => void
      fetchMock.mockImplementation(async (url, init) => {
        if (String(url).endsWith('/tasks/selected-b')) return new Promise(resolve => { finishB = resolve })
        if (String(url).endsWith('/tasks/known-a')) return new Promise(resolve => { finishKnown = resolve })
        return original(url, init)
      })
      await click('打开记录：销售草稿，手动恢复B')
      await setActive(false)
      tasks = Array.from({ length: 30 }, (_, index) => task({ id: `other-${index}`, state: 'DONE', userText: `其他记录${index}` }))
      if (inWindow) tasks[0] = oldB
      await setActive(true)
      expect(finishKnown).toBeTypeOf('function')
      await act(async () => finishB(response({ task: freshB })))
      expect(host.textContent).toContain('×9')
      await act(async () => finishKnown(resolution === '403' ? response({ error: 'revoked' }, 403) : response({ task: { ...known, state: 'DONE' } })))
      expect(getByRole(host, 'region', { name: '当前业务预览' }).textContent).toContain('×9')
      expect(getByRole(host, 'region', { name: '当前业务预览' }).textContent).not.toContain('×4')
      expect(getByRole(host, 'log').textContent).toContain('已取得B的新详情')
      expect(queryByRole(host, 'button', { name: /核对原任务：.*后台待核A/ })).toBeNull()
      if (resolution === '403') expect(host.textContent).toContain('勿另发重复请求')
      expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false)
      confirmed = { task: { ...freshB, state: 'DONE' }, reply: '原版本已确认' }
      await click('确认建单')
      const posts = fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')
      expect(posts).toHaveLength(1)
      expect(String(posts[0][0])).toBe('/assistant/tasks/selected-b/confirm')
      expect(JSON.parse(String(posts[0][1]?.body))).toMatchObject({ revision: 2 })
    })
  }
}


for (const resolution of ['DONE', '403']) {
  test(`T13质量旧EXPIRED1迟到不能覆盖后来手选AWAITING2或清原未知，旁项${resolution}仍生效`, async () => {
    const originalB = task({ id: 'b-versioned', userText: '原未知B' })
    const known = task({ id: 'known-a', userText: '旁项A', state: 'RESULT_UNKNOWN' })
    const freshB = task({ ...originalB, revision: 2, preview: preview(9) })
    tasks = [originalB, known]; await render(); await click('打开记录：销售草稿，原未知B')
    fetchMock.mockRejectedValueOnce(new TypeError('original confirm not delivered'))
    await click('确认建单')
    const originalFetch = fetchMock.getMockImplementation()!
    let finishB!: (value: Response) => void, finishKnown!: (value: Response) => void
    fetchMock.mockImplementation(async (url, init) => String(url).endsWith('/tasks/b-versioned') ? new Promise(resolve => { finishB = resolve }) : String(url).endsWith('/tasks/known-a') ? new Promise(resolve => { finishKnown = resolve }) : originalFetch(url, init))
    await click('打开记录：销售草稿，原未知B'); await setActive(false)
    tasks = [{ ...originalB, state: 'EXPIRED' }]; await setActive(true)
    expect(finishKnown).toBeTypeOf('function')
    await act(async () => finishB(response({ task: freshB })))
    expect(getByRole(host, 'button', { name: '查询原任务结果' })).toBeTruthy()
    await act(async () => finishKnown(resolution === '403' ? response({ error: 'revoked' }, 403) : response({ task: { ...known, state: 'DONE' } })))
    expect(getByRole(host, 'region', { name: '当前业务预览' }).textContent).toContain('×9')
    expect(getByRole(host, 'button', { name: '查询原任务结果' })).toBeTruthy()
    expect(queryByRole(host, 'button', { name: '确认建单' })).toBeNull()
    expect(queryByRole(host, 'button', { name: /核对原任务：.*旁项A/ })).toBeNull()
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1)
  })
}
for (const action of ['新对话', '其他记录']) {
  test(`T13质量集合已见revision2后${action}仍拒绝revision1过期快照`, async () => {
    const old = task({ id: 'versioned', userText: '已修订待核' })
    const newer = task({ ...old, revision: 2, preview: preview(9) })
    const other = task({ id: 'ordinary', state: 'DONE', userText: '普通C' })
    tasks = [old, other]; await renderAndRestore()
    fetchMock.mockRejectedValueOnce(new TypeError('original confirmation missing'))
    await click('确认建单')
    tasks = [newer, other]; await click('打开记录：销售草稿，已修订待核')
    await click(action === '新对话' ? '新对话' : '打开记录：销售草稿，普通C')
    tasks = [{ ...old, state: 'EXPIRED' }, other]; await click('刷新最近记录')
    expect(getByRole(host, 'button', { name: /核对原任务：.*已修订待核/ })).toBeTruthy()
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1)
  })
}
test('T13质量文字确认同版AWAITING回复和非终态GET不解除原确认未知', async () => {
  tasks = [task()]; await renderAndRestore()
  fetchMock.mockRejectedValueOnce(new TypeError('confirmation response missing'))
  await click('确认建单')
  chat = { task: task(), reply: '请点击卡片确认，文字确认不会执行业务。' }
  await send('确认')
  expect(getByRole(host, 'button', { name: '查询原任务结果' })).toBeTruthy()
  expect(queryByRole(host, 'button', { name: '确认建单' })).toBeNull()
  await click('打开记录：销售草稿，给测试客户开单四个')
  expect(getByRole(host, 'button', { name: '查询原任务结果' })).toBeTruthy()
  expect(queryByRole(host, 'button', { name: '确认建单' })).toBeNull()
  expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/confirm'))).toHaveLength(1)
})
for (const originalRevision of [1, undefined]) {
  test(`T13质量原未知revision${originalRevision ?? '缺失'}读到新版后查询只GET不授权新版写入`, async () => {
    tasks = [task({ revision: originalRevision })]; await renderAndRestore()
    fetchMock.mockRejectedValueOnce(new TypeError('original confirmation never reached server'))
    await click('确认建单')
    tasks = [task({ revision: 2, preview: preview(9) })]
    await click('打开记录：销售草稿，给测试客户开单四个')
    confirmed = { task: task({ state: 'DONE', revision: 2 }), reply: '若误传当前revision2将首次创建数量9' }
    await click('查询原任务结果')
    const confirms = fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/confirm'))
    expect(confirms).toHaveLength(1)
    expect(JSON.parse(String(confirms[0][1]?.body))).toEqual(originalRevision == null ? {} : { revision: 1 })
    expect(host.textContent).toContain('×9')
    expect(getByRole(host, 'button', { name: '查询原任务结果' })).toBeTruthy()
    expect(queryByRole(host, 'button', { name: '确认建单' })).toBeNull()
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/tasks/task-1'))).toHaveLength(3)
  })
}

for (const state of ['CONFIRMED', 'EXECUTING', 'VERIFYING', 'RESULT_UNKNOWN', 'ESCALATED']) {
  test(`最终审查：冻结存储不可写不阻断服务端${state}原任务查询`, async () => {
    tasks = [task({ state })]
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('synthetic quota', 'QuotaExceededError') })
    await render()
    confirmed = { task: task({ state: 'RESULT_UNKNOWN' }), reply: '仍待核对原请求回执' }
    await click('查询原任务结果')
    const calls = fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/tasks/task-1/confirm'))
    expect(calls).toHaveLength(1)
    expect(JSON.parse(String(calls[0][1]?.body))).toEqual({ revision: 1 })
    expect(host.textContent).toContain('仍待核对原请求回执')
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1)
  })
}

for (const originalRevision of [1, undefined]) {
  test(`最终审查：存储失效与未知原版本${originalRevision ?? '缺失'}并存时跨版查询仅GET`, async () => {
    tasks = [task({ revision: originalRevision })]; await renderAndRestore()
    fetchMock.mockRejectedValueOnce(new TypeError('lost confirm'))
    await click('确认建单')
    tasks = [task({ revision: 2, preview: preview(9) })]
    await click('刷新最近记录')
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('synthetic quota', 'QuotaExceededError') })
    await click('刷新最近记录')
    const before = fetchMock.mock.calls.length
    await click('查询原任务结果')
    const after = fetchMock.mock.calls.slice(before)
    expect(after.map(([url, init]) => [String(url), init?.method])).toEqual([['/assistant/tasks/task-1', 'GET']])
    const confirms = fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/confirm'))
    expect(confirms).toHaveLength(1)
    expect(JSON.parse(String(confirms[0][1]?.body))).toEqual(originalRevision == null ? {} : { revision: 1 })
  })
}

test('最终审查：实际改量回复晚于另一实例同版尝试，重挂仍冻且明确继续原版才恢复', async () => {
  tasks = [task()]; await renderAndRestore()
  let finish!: (value: Response) => void
  fetchMock.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  await send('改成3个吧')
  createPreviewFreezeStore().begin(task())
  await act(async () => finish(response({ task: task({ revision: 2, preview: preview(3) }), reply: '已修改为3' })))
  expect(host.textContent).toContain('×3')
  expect(getByRole(host, 'button', { name: '确认建单' }).hasAttribute('disabled')).toBe(true)
  tasks = [task({ revision: 2, preview: preview(3) })]
  await remountAndRestore()
  expect(getByRole(host, 'button', { name: '确认建单' }).hasAttribute('disabled')).toBe(true)
  chat = { task: task({ revision: 3, preview: preview(3) }), reply: '已按原数量重新试算' }
  await send('继续原版')
  expect(getByRole(host, 'button', { name: '确认建单' }).hasAttribute('disabled')).toBe(false)
  expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/confirm'))).toBe(false)
})

test('最终审查：实际GET发出后才开始的尝试不被迟到服务端暂停解除', async () => {
  tasks = [task()]
  const other = createPreviewFreezeStore()
  other.begin(task())
  await render()
  let finish!: (value: Response) => void
  fetchMock.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  await click('重新核对预览')
  other.begin(task())
  await act(async () => finish(response({ task: task({ revision: 2, confirmationBlocked: '请明确数量' }) })))
  expect(other.reconcile(task())).toBe(true)
  expect(getByRole(host, 'button', { name: '确认建单' }).hasAttribute('disabled')).toBe(true)
})

for (const state of ['CONFIRMED', 'EXECUTING', 'VERIFYING', 'RESULT_UNKNOWN', 'ESCALATED']) {
  test(`最终审查：冻结存储不可读不阻断服务端${state}原任务查询`, async () => {
    createPreviewFreezeStore().begin(task())
    tasks = [task({ state })]
    const originalGet = Storage.prototype.getItem
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (this: Storage, key) {
      if (key.startsWith('flowcube-assistant-')) throw new DOMException('synthetic disabled storage', 'SecurityError')
      return originalGet.call(this, key)
    })
    await render()
    confirmed = { task: task({ state: 'RESULT_UNKNOWN' }), reply: '仍待核对原请求回执' }
    await click('查询原任务结果')
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/tasks/task-1/confirm'))).toHaveLength(1)
    expect(host.textContent).toContain('仍待核对原请求回执')
  })
}

test('最终审查：同版本地确认未知且存储故障时只GET，不把恢复当作首次写入', async () => {
  tasks = [task()]; await renderAndRestore()
  fetchMock.mockRejectedValueOnce(new TypeError('lost confirm'))
  await click('确认建单')
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('synthetic disabled storage') })
  const before = fetchMock.mock.calls.length
  await click('查询原任务结果')
  expect(fetchMock.mock.calls.slice(before).map(([url, init]) => [String(url), init?.method])).toEqual([['/assistant/tasks/task-1', 'GET']])
  expect(host.textContent).toContain('存储')
  expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/confirm'))).toHaveLength(1)
})

for (const text of ['确认', '换个话题，确认吧', '确认，然后改成5个']) {
  test(`最终审查：${text}回显服务端高版不证明未知修改完成`, async () => {
    tasks = [task()]; await renderAndRestore()
    fetchMock.mockRejectedValueOnce(new TypeError('lost edit'))
    await send('改成3个吧')
    chat = { task: task({ revision: 2, preview: preview(9) }), reply: '请核对当前预览后点击确认；文字确认未执行业务' }
    await send(text)
    expect(host.textContent).toContain('×9')
    expect(getByRole(host, 'button', { name: '确认建单' }).hasAttribute('disabled')).toBe(true)
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/confirm'))).toBe(false)
  })
}
