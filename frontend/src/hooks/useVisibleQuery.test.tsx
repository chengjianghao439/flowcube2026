// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, test, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SectionVisibilityContext } from '@/components/layout/SectionVisibilityContext'
import { useVisibleQuery } from './useVisibleQuery'
const host = document.createElement('div')
let root: ReturnType<typeof createRoot> | undefined
let qc: QueryClient
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
afterEach(() => { act(() => root?.unmount()); qc?.clear() })
test('隐藏时取消独占的未完成读取，后台失效不发请求，显示后继续读取', async () => {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const aborted = vi.fn(), request = vi.fn(({ signal }: { signal: AbortSignal }) => new Promise<string>(resolve => { signal.addEventListener('abort', aborted); if (request.mock.calls.length > 1) resolve('完成') }))
  function Probe() { const result = useVisibleQuery({ queryKey: ['visible-list'], queryFn: request }); return <span>{result.data}</span> }
  root = createRoot(host)
  const render = async (active: boolean) => { await act(async () => { root!.render(<QueryClientProvider client={qc}><SectionVisibilityContext.Provider value={active}><Probe /></SectionVisibilityContext.Provider></QueryClientProvider>) }) }
  await render(true); expect(request).toHaveBeenCalledTimes(1)
  await render(false); expect(aborted).toHaveBeenCalledTimes(1)
  await act(async () => { await qc.invalidateQueries({ queryKey: ['visible-list'] }) }); expect(request).toHaveBeenCalledTimes(1)
  await render(true); expect(request).toHaveBeenCalledTimes(2)
})
test('隐藏的查询不取消同 key 的另一个可见消费者', async () => {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } }); root = createRoot(host)
  const aborted = vi.fn(), request = vi.fn(({ signal }: { signal: AbortSignal }) => new Promise<string>(() => { signal.addEventListener('abort', aborted) }))
  function Probe() { useVisibleQuery({ queryKey: ['shared-list'], queryFn: request }); return null }
  const render = async (active: boolean) => { await act(async () => { root!.render(<QueryClientProvider client={qc}><SectionVisibilityContext.Provider value={active}><Probe /></SectionVisibilityContext.Provider><Probe /></QueryClientProvider>) }) }
  await render(true); await render(false); expect(request).toHaveBeenCalledTimes(1); expect(aborted).not.toHaveBeenCalled()
})

test('页内总览切换为流水时，enabled=false 同样解除独占请求订阅', async () => {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } }); root = createRoot(host)
  const aborted = vi.fn(), request = vi.fn(({ signal }: { signal: AbortSignal }) => new Promise<string>(() => { signal.addEventListener('abort', aborted) }))
  function Probe({ enabled }: { enabled: boolean }) { useVisibleQuery({ queryKey: ['section-list'], queryFn: request, enabled }); return null }
  const render = async (enabled: boolean) => { await act(async () => root!.render(<QueryClientProvider client={qc}><Probe enabled={enabled} /></QueryClientProvider>)) }
  await render(true); await render(false); expect(aborted).toHaveBeenCalledTimes(1)
})
