// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, test } from 'vitest'
import { ProcurementArrivalStatus, ProcurementSupplyExplanation } from './ProcurementSupplyExplanation'
import type { ProcurementSupply } from '@/api/procurement-supply'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const supply: ProcurementSupply = { id:'1-2', productId:1, productCode:'P1', productName:'测试商品', unit:'件', warehouseId:2, warehouseName:'目标仓', supplierId:null, supplierName:null, onHand:10, reserved:0, confirmedDemand:83, draftSalesDemand:3, forecastDemand:0, residualForecast:0, grossDemand:83, safetyStock:0, targetStock:0, inTransit:0, expectedBound:0, provisionalCoverage:0, netRequirement:73, suggestedQty:108, excessQty:35, packMultiple:12, minimumOrderQty:100, entryUnit:'箱', conversionRate:12, transferCandidates:[] }
const host = document.createElement('div')
document.body.append(host)
let root = createRoot(host)
afterEach(() => { act(() => root.unmount()); root = createRoot(host) })

test('展示服务端结果及基本单位，不把包装数误当采购单位数量', () => {
  act(() => root.render(<ProcurementSupplyExplanation supply={supply} />))
  expect(host.textContent).toContain('净需求 73 件')
  expect(host.textContent).toContain('建议采购 108 件')
  expect(host.textContent).toContain('多购 35 件')
  expect(host.textContent).toContain('包装倍数 12 件')
  expect(host.textContent).toContain('最低起订 100 件')
  expect(host.textContent).toContain('1 箱 = 12 件')
  expect(host.textContent).toContain('需求与库存缓冲')
  expect(host.textContent).toContain('已有实物与采购')
  expect(host.textContent).toContain('尚未转为正式采购的覆盖')
})
test('历史快照缺字段显示未知，零与未知不同；补货只解释目标库存', () => {
  const old = { ...supply, netRequirement:90, suggestedQty:96, planCoverage:undefined }
  act(() => root.render(<ProcurementSupplyExplanation supply={{...supply, planCoverage:0, targetStock:20, packMultiple:0, minimumOrderQty:0}} snapshot={old} mode="replenishment" />))
  const table = host.querySelector('table')!
  expect(table.textContent).toContain('生成时')
  expect(table.textContent).toContain('当前')
  expect(table.textContent).toContain('90 件73 件')
  expect(table.textContent).toContain('其他采购计划—0 件')
  expect(host.textContent).toContain('目标库存（已含安全库存）')
  expect(host.textContent).toContain('包装倍数不限')
})
test('无销售日期及缺到货字段不能显示按期或零风险', () => {
  act(() => root.render(<ProcurementArrivalStatus supply={{...supply, inTransit:10}} />))
  expect(host.textContent).toContain('销售交期待确认')
  expect(host.textContent).toContain('到货信息待核对')
  expect(host.textContent).not.toContain('按期')
})
test('同时展示晚于需求与未确认数量，有日期无风险也不承诺到货', () => {
  act(() => root.render(<ProcurementArrivalStatus supply={{...supply, earliestDemandDate:'2026-09-15', inTransit:20, arrivalUnconfirmedQty:5, lateSupplyQty:10}} />))
  expect(host.textContent).toContain('晚于需求 10 件')
  expect(host.textContent).toContain('到货日待确认 5 件')
  act(() => root.render(<ProcurementArrivalStatus supply={{...supply, earliestDemandDate:'2026-09-15', inTransit:20, arrivalUnconfirmedQty:0, lateSupplyQty:0}} />))
  expect(host.textContent).toContain('仍需核对实际到货')
  expect(host.textContent).not.toContain('按期')
})

test('无历史快照时明确缺少依据，不合成生成时数值', () => {
  act(() => root.render(<ProcurementSupplyExplanation supply={supply} snapshot={null} />))
  expect(host.textContent).toContain('没有保存生成时的需求数据')
  expect(host.querySelector('table')).toBeNull()
})
