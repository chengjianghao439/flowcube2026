// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { useInvalidate, type InvalidationEvent } from './useInvalidate'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const invalidateQueries = vi.hoisted(() => vi.fn())
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries }) }))

let invoke: (event: InvalidationEvent) => void
const hosts: HTMLDivElement[] = []
function Harness() { invoke = useInvalidate(); return null }
afterEach(() => { hosts.splice(0).forEach(h => h.remove()); invalidateQueries.mockClear() })

it('改变库存或预占的业务事件都失效商品查找器，纯单据事件不触发', async () => {
  const host = document.createElement('div'); document.body.append(host); hosts.push(host)
  const root = createRoot(host)
  await act(async () => root.render(<Harness />))
  const affecting: InvalidationEvent[] = [
    'sale_reserve', 'sale_cancel', 'sale_delete', 'sale_adjust', 'sale_ship', 'task_ship',
    'inbound_putaway', 'inbound_void_receipt', 'stockcheck_submit', 'transfer_complete',
    'return_complete', 'disposal_execute', 'inventory_change',
  ]
  for (const event of affecting) {
    invalidateQueries.mockClear()
    invoke(event)
    expect(invalidateQueries, event).toHaveBeenCalledWith({ queryKey: ['products', 'finder'] })
  }
  invalidateQueries.mockClear()
  invoke('purchase_create')
  expect(invalidateQueries).not.toHaveBeenCalledWith({ queryKey: ['products', 'finder'] })
  await act(async () => root.unmount())
})
