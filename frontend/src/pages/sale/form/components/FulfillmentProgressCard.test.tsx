// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { beforeEach, afterEach, expect, test, vi } from 'vitest'
import { FulfillmentProgressCard } from './FulfillmentProgressCard'
import type { SaleOrder, SaleOrderTask } from '@/types/sale'
import { PERMISSIONS } from '@/lib/permission-codes'

const auth = vi.hoisted(() => ({ assign: true }))
vi.mock('@/hooks/usePermission', () => ({ usePermission: () => ({ can: (code: string) => code === PERMISSIONS.WAREHOUSE_TASK_ASSIGN && auth.assign }) }))
let host: HTMLDivElement, root: Root
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); auth.assign = true; host = document.createElement('div'); document.body.append(host); root = createRoot(host) })
afterEach(() => { act(() => root.unmount()); host.remove() })
const task = (taskId: number, warehouseId: number, extra: Partial<SaleOrderTask> = {}): SaleOrderTask => ({ taskId, warehouseId, taskNo: `WT-${taskId}`, warehouseName: `仓库${warehouseId}`, status: 2, statusName: '拣货中', sortingBinId: null, ...extra })
function Path() { const location = useLocation(); return <output>{location.pathname}{location.search}</output> }
function render(tasks: SaleOrderTask[]) { act(() => root.render(<MemoryRouter initialEntries={['/sale/5']}><FulfillmentProgressCard order={{ taskNo: 'WT-11', warehouseTaskStatus: 2, tasks } as SaleOrder} /><Path /></MemoryRouter>)) }
test('主管单仓交接只导航注册入口并带准确任务与仓库', () => {
  render([task(11, 3)])
  const button = [...host.querySelectorAll('button')].find(node => node.textContent === '去分配分拣格')
  expect(button).toBeTruthy()
  act(() => button!.click())
  expect(host.querySelector('output')!.textContent).toBe('/sorting-bins?taskId=11&warehouseId=3')
})
test('多仓交接逐任务独立，挂起、已分配与后续阶段不显示入口', () => {
  render([task(11, 3), task(22, 8), task(33, 3, { cancelRequestedAt: 'now' }), task(44, 3, { adjustmentRequestedAt: 'now' }), task(55, 3, { sortingBinId: 4 }), task(66, 3, { status: 4 })])
  const buttons = [...host.querySelectorAll('button')].filter(node => node.textContent === '去分配分拣格')
  expect(buttons).toHaveLength(2)
  act(() => buttons[1].click())
  expect(host.querySelector('output')!.textContent).toBe('/sorting-bins?taskId=22&warehouseId=8')
})
test('普通员工只提示主管处理，非法身份不生成入口', () => {
  auth.assign = false; render([task(11, 3)])
  expect(host.querySelector('button')).toBeNull(); expect(host.textContent).toContain('联系主管')
  auth.assign = true; render([task(0, 3), task(22, null as unknown as number)])
  expect(host.querySelector('button')).toBeNull()
})
