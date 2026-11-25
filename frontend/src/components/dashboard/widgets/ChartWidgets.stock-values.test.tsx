// @vitest-environment jsdom
import { act, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, test, vi } from 'vitest'
import { ChartTopStock, ChartWarehouseStock } from './ChartWidgets'

const chart = vi.hoisted(() => ({
  barRows: [] as Array<{ name: string; 价值: number }>,
  format: undefined as ((value: number) => [string, string]) | undefined,
}))
vi.mock('recharts', async original => ({
  ...await original<typeof import('recharts')>(),
  BarChart: ({ data, children }: { data: typeof chart.barRows; children: ReactNode }) => {
    chart.barRows = data
    return <>{children}</>
  },
  Tooltip: ({ formatter }: { formatter: typeof chart.format }) => { chart.format = formatter; return null },
  XAxis: () => null, YAxis: () => null, CartesianGrid: () => null, Bar: () => null,
}))
vi.mock('@/components/shared/ChartContainer', () => ({
  ChartContainer: ({ children }: { children: ReactNode }) => <>{children}</>,
}))
vi.mock('@/hooks/useDashboard', () => ({
  useTopStock: () => ({ data: [{ name: '合成商品', value: 242.9616 }], isLoading: false }),
  useInventoryStats: () => ({ data: { byWarehouse: [
    { warehouseName: '合成仓', totalValue: 442.9616 },
    ...Array.from({ length: 7 }, (_, i) => ({ warehouseName: '合成仓' + (i + 1), totalValue: 200 + i })),
    { warehouseName: '待归并仓甲', totalValue: 21.623 },
    { warehouseName: '待归并仓乙', totalValue: 18.128 },
  ] }, isLoading: false }),
}))

test.each([
  { Component: ChartTopStock, name: '合成商品', raw: 242.9616, amount: '¥242.96' },
  { Component: ChartWarehouseStock, name: '合成仓', raw: 442.9616, amount: '¥442.96' },
  { Component: ChartWarehouseStock, name: '其他 2 个仓', raw: 39.751, amount: '¥39.75' },
])('库存价值图保留 $name 的来源精度并按分显示', async ({ Component, name, raw, amount }) => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const host = document.createElement('div')
  const root = createRoot(host)
  try {
    await act(async () => root.render(<Component />))
    const row = chart.barRows.find(item => item.name === name)!
    expect(row.价值).toBeCloseTo(raw, 4)
    expect(chart.format!(row.价值)).toEqual([amount, '库存价值'])
  } finally {
    await act(async () => root.unmount())
  }
})
