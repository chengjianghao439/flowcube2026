// @vitest-environment jsdom
// Independent detail read, real query cache/API/dialog; only transport is
// synthetic. No database or real business request is sent.
import { act, type ComponentProps } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { StatementDetailDialog } from './StatementDetailDialog'
import apiClient, { setApiClientBaseURL } from '@/api/client'
import { SectionVisibilityContext } from '@/components/layout/SectionVisibilityContext'

const capture = vi.hoisted(() => ({ removes: [] as (() => void)[] }))
// Observe delayed callbacks while preserving the real button and dialog graph.
vi.mock('@/components/ui/button', async original => {
  const { Button } = await original<typeof import('@/components/ui/button')>()
  return { Button: (props: ComponentProps<typeof Button>) => {
    if (props.children === '移出' && props.onClick) capture.removes.push(() => props.onClick!({} as never))
    return <Button {...props} />
  } }
})
vi.mock('@/hooks/usePermission', () => ({ usePermission: () => ({ can: () => true }) }))
vi.mock('@/lib/toast', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

let host: HTMLDivElement, root: Root, query: QueryClient
let respond: (url: URL) => Response | Promise<Response>
let allowDelete = false
const reads: string[] = [], deletes: string[] = [], unexpected: string[] = []
const oldAdapter = apiClient.defaults.adapter, oldEnv = apiClient.defaults.env
const transport = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
  const method = (typeof input === 'object' && 'method' in input ? input.method : init?.method) || 'GET'
  if (method === 'GET' && /^\/api\/payments\/statements\/\d+$/.test(url.pathname)) { reads.push(url.pathname); return respond(url) }
  if (method === 'DELETE' && /^\/api\/payments\/statements\/\d+\/items\/\d+$/.test(url.pathname)) {
    deletes.push(url.pathname)
    return allowDelete ? response(null) : failure(403)
  }
  unexpected.push(`${method} ${url.pathname}`); return failure(403)
})
function response(data: unknown) { return new Response(JSON.stringify({ success: true, data }), { status: 200, headers: { 'Content-Type': 'application/json' } }) }
function failure(status: number) { return new Response(JSON.stringify({ success: false, code: 'SYNTHETIC_DETAIL_READ_REJECTED', message: '合成明细读取失败' }), { status, headers: { 'Content-Type': 'application/json' } }) }
function detail(type: 1 | 2, id = 42, status = 1, recordId = 7) {
  return { id, type, statementNo: `ST-SYN-${id}`, partyName: `合成往来方${id}`, status, statusName: status === 1 ? '草稿' : '已确认', totalAmount: 20.37, settledAmount: 0, balance: 20.37,
    items: [{ recordId, orderId: 8, type, orderNo: `ORDER-SYN-${recordId}`, totalAmount: 20.37, paidAmount: 0, balance: 20.37 }] }
}
const cache = () => query.getQueryCache().find({ queryKey: ['payment-statement-detail'], exact: false, type: 'active' })
async function wait(assertion: () => void) { await vi.waitFor(async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)) }); assertion() }) }
async function render(type: 1 | 2, id = 42, open = true, active = true) {
  await act(async () => root.render(<QueryClientProvider client={query}><MemoryRouter initialEntries={['/payments']}><SectionVisibilityContext.Provider value={active}>
    <StatementDetailDialog type={type} statementId={id} open={open} onClose={() => {}} />
  </SectionVisibilityContext.Provider></MemoryRouter></QueryClientProvider>))
}
function button(name: string) { return [...document.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent?.trim() === name) }
async function refresh() { await act(async () => { await query.invalidateQueries({ queryKey: ['payment-statement-detail'] }) }) }
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  localStorage.clear(); capture.removes.length = 0; reads.length = 0; deletes.length = 0; unexpected.length = 0; allowDelete = false
  setApiClientBaseURL('http://statement-detail.fixture.invalid/api'); apiClient.defaults.adapter = 'fetch'; apiClient.defaults.env = { ...oldEnv, fetch: transport }
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  query = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } })
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); query.clear(); apiClient.defaults.adapter = oldAdapter; apiClient.defaults.env = oldEnv; setApiClientBaseURL('/api'); expect(unexpected).toEqual([]) })

test.each([1, 2] as const)('%s 明细自身首读失败可重试，未有旧金额或移出动作', async type => {
  respond = () => failure(500); await render(type); await wait(() => expect(cache()?.state.status).toBe('error'))
  expect(document.body.textContent).toContain('合成明细读取失败'); expect(button('重试')).toBeTruthy(); expect(button('移出')).toBeUndefined()
  respond = () => response(detail(type)); await act(async () => button('重试')!.click()); await wait(() => expect(document.body.textContent).toContain('ST-SYN-42'))
  expect(reads).toEqual(['/api/payments/statements/42', '/api/payments/statements/42'])
})
test.each([{ type: 1 as const, status: 403 }, { type: 2 as const, status: 500 }])('$type 自身缓存读取$status后隐藏旧明细和旧移出，旧回调不可发请求', async ({ type, status }) => {
  respond = () => response(detail(type)); await render(type); await wait(() => expect(button('移出')).toBeTruthy())
  const old = capture.removes.at(-1)!
  respond = () => failure(status); await refresh(); await wait(() => expect(cache()?.state.status).toBe('error'))
  expect(cache()?.state.data).toBeTruthy(); expect(document.body.textContent).not.toMatch(/ST-SYN-42|合成往来方42|ORDER-SYN-7|20\.37/)
  expect(button('移出')).toBeUndefined(); await act(async () => old()); expect(deletes).toEqual([])
  respond = () => response(detail(type)); await act(async () => button('重试')!.click()); await wait(() => expect(button('移出')).toBeTruthy())
})
test.each([1, 2] as const)('%s 自身缓存错误不保留旧确认单导出入口', async type => {
  respond = () => response(detail(type, 42, 2)); await render(type); await wait(() => expect(button('导出对账单（发对方核对）')).toBeTruthy())
  respond = () => failure(500); await refresh(); await wait(() => expect(cache()?.state.status).toBe('error'))
  expect(button('导出对账单（发对方核对）')).toBeUndefined(); expect(document.body.textContent).not.toContain('ST-SYN-42')
})
test.each(['closed', 'hidden', 'different-id', 'terminal', 'missing-record', 'unmounted'] as const)('已保留移出回调在%s后不能提交旧目标', async state => {
  respond = () => response(detail(1)); await render(1); await wait(() => expect(button('移出')).toBeTruthy())
  const old = capture.removes.at(-1)!
  if (state === 'closed') await render(1, 42, false)
  else if (state === 'unmounted') { await act(async () => root.unmount()); root = createRoot(host) }
  else if (state === 'hidden') await render(1, 42, true, false)
  else if (state === 'different-id') { respond = () => response(detail(1, 43)); await render(1, 43); await wait(() => expect(document.body.textContent).toContain('ST-SYN-43')) }
  else {
    respond = () => response(detail(1, 42, state === 'terminal' ? 2 : 1, state === 'missing-record' ? 9 : 7)); await refresh()
    await wait(() => state === 'terminal' ? expect(button('移出')).toBeUndefined() : expect(document.body.textContent).toContain('ORDER-SYN-9'))
  }
  await act(async () => old()); expect(deletes).toEqual([])
})
test.each([1, 2] as const)('%s 当前已核明细仍允许原记录移出一次', async type => {
  respond = () => response(detail(type)); allowDelete = true; await render(type); await wait(() => expect(button('移出')).toBeTruthy())
  await act(async () => button('移出')!.click()); await wait(() => expect(deletes).toEqual(['/api/payments/statements/42/items/7']))
})
