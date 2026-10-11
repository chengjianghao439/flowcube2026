// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, test, vi } from 'vitest'
import { InboundQuantitySummary } from './InboundQuantitySummary'
import { groupInboundQuantities } from './inboundQuantity'
import type { InboundQuantityGroup } from '@/types/inbound-tasks'
vi.mock('@/components/shared/AppDialog', () => ({ AppDialog: ({ open, children }: { open: boolean; children: React.ReactNode }) => open ? <div role="dialog">{children}</div> : null }))
vi.mock('@/components/shared/DataTable', () => ({ default: () => <p>分组明细</p> }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let cleanup: (() => Promise<void>) | undefined
const groups: InboundQuantityGroup[] = Array.from({ length: 4 }, (_, i) => ({ key: String(i), productId: i + 1, productName: `商品${i}`, unit: i % 2 ? '米' : '个', orderedQty: 2, receivedQty: 0, putawayQty: 0 }))
async function render(props: Parameters<typeof InboundQuantitySummary>[0]) {
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host)
  cleanup = async () => { await act(async () => root.unmount()); host.remove() }
  await act(async () => root.render(<InboundQuantitySummary {...props} />)); return host
}
afterEach(async () => { await cleanup?.() })
test.each(['orderedQty', 'receivedQty', 'putawayQty'] as const)('详情%s所有分组严格零显示普通0', async field => {
  const host = await render({ groups: groups.map(g => ({ ...g, [field]: 0 })), field, label: '汇总', collapseZero: true })
  expect(host.querySelector('[aria-label="汇总"]')?.textContent).toBe('0')
  expect(host.querySelector('button')).toBeNull(); expect(host.querySelector('[role="dialog"]')).toBeNull()
})
test('混合单位中有非零仍可查看全部分组；不得用相抵合计判零', async () => {
  const host = await render({ groups: groups.map((g, i) => ({ ...g, receivedQty: i === 0 ? 2 : i === 1 ? -2 : 0 })), field: 'receivedQty', label: '已收', collapseZero: true })
  expect(host.querySelector('button')?.textContent).toBe('已收 · 4 组')
  await act(async () => host.querySelector('button')!.click()); expect(host.querySelector('[role="dialog"]')).not.toBeNull()
})
test.each([undefined, []])('空或未知数据保持原口径', async rows => {
  const host = await render({ groups: rows, collapseZero: true, label: '已收' }); expect(host.textContent).toBe(rows ? '已收 —' : '已收待核对')
})
test('列表默认全零仍保留分组入口', async () => {
  const host = await render({ groups, field: 'receivedQty', label: '已收' }); expect(host.querySelector('button')?.textContent).toBe('已收 · 4 组')
})

const rawLine = { productId: 1, productName: '合成商品', unit: '个', orderedQty: 1, receivedQty: 0, putawayQty: 0 }
test.each([null, undefined, NaN, Infinity])('完整原明细%s不被聚合为0；未知摘要显示—且已知其他量保持', async invalid => {
  const raw = { ...rawLine, receivedQty: invalid } as unknown as Parameters<typeof groupInboundQuantities>[0][number]
  const host = await render({ groups: groupInboundQuantities([raw, rawLine]), field: 'receivedQty', label: '已收', collapseZero: true })
  expect(host.querySelector('[aria-label="已收"]')?.textContent).toContain('合成商品：—')
  expect(host.querySelector('[aria-label="已收"]')?.textContent).not.toBe('0')
})
test('完整明细同组+1/-1只保留分组净量，不能声明全零', async () => {
  const host = await render({ groups: groupInboundQuantities([{ ...rawLine, receivedQty: 1 }, { ...rawLine, receivedQty: -1 }]), field: 'receivedQty', label: '已收', collapseZero: true })
  expect(host.querySelector('[aria-label="已收"]')?.textContent).toBe('合成商品：0 个')
})
test('多个同组抵消仍有分组入口，正常逐行严格零仍无按钮', async () => {
  const rows = Array.from({ length: 4 }, (_, id) => [{ ...rawLine, productId: id + 1, receivedQty: 1 }, { ...rawLine, productId: id + 1, receivedQty: -1 }]).flat()
  const host = await render({ groups: groupInboundQuantities(rows), field: 'receivedQty', label: '已收', collapseZero: true })
  expect(host.querySelector('button')?.textContent).toBe('已收 · 4 组')
})

test.each(['orderedQty', 'receivedQty', 'putawayQty'] as const)('真实聚合%s未知不判零，正常全量每行0才简化', async field => {
  const normal = Array.from({ length: 4 }, (_, id) => ({ ...rawLine, productId: id + 1, [field]: 0 }))
  const host = await render({ groups: groupInboundQuantities(normal), field, label: '汇总', collapseZero: true })
  expect(host.querySelector('[aria-label="汇总"]')?.textContent).toBe('0')
  expect(host.querySelector('button')).toBeNull()
  await cleanup?.()
  const invalid = { ...normal[0], [field]: null } as unknown as Parameters<typeof groupInboundQuantities>[0][number]
  const invalidHost = await render({ groups: groupInboundQuantities([invalid]), field, label: '汇总', collapseZero: true })
  expect(invalidHost.querySelector('[aria-label="汇总"]')?.textContent).toContain('—')
})
test('remainingQty来自未知原量时不推断0，正常已知净量仍沿原口径', async () => {
  const unknown = { ...rawLine, orderedQty: null } as unknown as Parameters<typeof groupInboundQuantities>[0][number]
  const host = await render({ groups: groupInboundQuantities([unknown]), field: 'remainingQty', label: '剩余', collapseZero: true })
  expect(host.querySelector('[aria-label="剩余"]')?.textContent).toContain('—')
})
