// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, expect, test, vi } from 'vitest'
import Page from './index'
import { useWorkspaceStore } from '@/store/workspaceStore'
import { PERMISSIONS, PERMISSION_GROUPS } from '@/lib/permission-codes'
import type { InboundTask } from '@/types/inbound-tasks'
const fixture = vi.hoisted(() => ({ row: { id: 21, taskNo: 'IN-21', status: 1, submittedAt: null, draftEditable: true } as InboundTask, allowed: true, error: null as unknown }))
vi.mock('@/hooks/useVisibleQuery', () => ({ useVisibleQuery: () => ({ data: { list: [fixture.row], pagination: { total: 1 } }, isLoading: false, error: fixture.error, refetch: vi.fn() }) }))
vi.mock('@/hooks/usePermission', () => ({ usePermission: () => ({ can: (permission: string) => permission === 'inbound.order.update' ? fixture.allowed : true }) }))
vi.mock('@/hooks/useInboundTasks', () => Object.fromEntries(['useSubmitInboundTask', 'useCancelInbound', 'useVoidInboundReceipt'].map(name => [name, () => ({ mutate: vi.fn() })])))
vi.mock('@/hooks/useActiveWorkspaceTab', () => ({ useActiveWorkspaceTab: () => true }))
vi.mock('./InboundTaskQueryDialog', () => ({ default: () => null }))
vi.mock('./CloseReceivingDialog', () => ({ default: () => null }))
vi.mock('@/components/shared/TableActionsMenu', () => ({ default: ({ items }: { items: { label: string; disabled?: boolean; onClick: () => void }[] }) => <>{items.map(item => <button key={item.label} disabled={item.disabled} onClick={item.onClick}>{item.label}</button>)}</> }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let cleanup: (() => Promise<void>) | undefined
afterEach(async () => { await cleanup?.(); fixture.allowed = true; fixture.error = null; fixture.row = { id: 21, taskNo: 'IN-21', status: 1, submittedAt: null, draftEditable: true } as InboundTask })
async function setup() { const host = document.createElement('div'); document.body.append(host); const root = createRoot(host); const draw = () => act(async () => root.render(<MemoryRouter><Page /></MemoryRouter>)); cleanup = async () => { await act(async () => root.unmount()); host.remove() }; await draw(); return { host, draw } }
test('列表编辑仅独立UPDATE和后端可编辑草稿，保留独立任务编辑标签', async () => {
  expect(PERMISSIONS.INBOUND_ORDER_UPDATE).toBe('inbound.order.update'); const { host, draw } = await setup(); const edit = () => [...host.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === '编辑')
  expect(edit()).toBeDefined(); await act(async () => edit()!.click()); expect(useWorkspaceStore.getState().tabs.some(tab => tab.path === '/inbound-tasks/21/edit')).toBe(true)
  fixture.allowed = false; await draw(); expect(edit()).toBeUndefined(); fixture.allowed = true
  for (const update of [{ status: 2 }, { status: 1, submittedAt: '2026-10-09' }, { submittedAt: null, draftEditable: false }]) { fixture.row = { ...fixture.row, ...update } as InboundTask; await draw(); expect(edit()).toBeUndefined() }
})

test('独立收货草稿编辑权限在授权catalog中可单独勾选', () => { expect(PERMISSION_GROUPS.flatMap(group => group.items).filter(item => item.code === PERMISSIONS.INBOUND_ORDER_UPDATE)).toEqual([{ code: PERMISSIONS.INBOUND_ORDER_UPDATE, label: '编辑收货草稿' }]) })
