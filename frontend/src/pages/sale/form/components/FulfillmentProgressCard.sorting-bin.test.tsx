// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { FulfillmentProgressCard } from './FulfillmentProgressCard'
import type { SaleOrder } from '@/types/sale'

let host: HTMLDivElement
let root: Root
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); host = document.createElement('div'); document.body.append(host); root = createRoot(host) })
afterEach(() => { act(() => root.unmount()); host.remove() })

test('销售进度卡对尚未分配分拣格的执行中任务提示主管补分配', () => {
  const order = {
    taskNo: 'WT-001', warehouseTaskStatus: 3,
    tasks: [{ taskId: 1, taskNo: 'WT-001', warehouseId: 1, warehouseName: '主仓', status: 3, statusName: '待分拣', sortingBinId: null, sortingBinCode: null }],
  } as SaleOrder
  act(() => root.render(<FulfillmentProgressCard order={order} />))
  expect(host.textContent).toContain('待分配分拣格')
  expect(host.textContent).toContain('主管')
  act(() => root.render(<FulfillmentProgressCard order={{ ...order, tasks: [{ ...order.tasks![0], sortingBinId: 8, sortingBinCode: 'A08' }] }} />))
  expect(host.textContent).not.toContain('待分配分拣格')
})
