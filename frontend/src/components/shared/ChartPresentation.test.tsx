// @vitest-environment jsdom
import { renderToStaticMarkup } from 'react-dom/server'
import type { DefaultTooltipContentProps } from 'recharts'
import { expect, test, vi } from 'vitest'
import { ChartLegendContent, ChartTooltipContent, ChartValueLegend } from './ChartPresentation'

const item = (value: number, name = '金额') => ({ graphicalItemId: name, dataKey: name, name, value, color: '#123456' })
function tooltip(props: DefaultTooltipContentProps & { active?: boolean }) {
  const host = document.createElement('div')
  host.innerHTML = renderToStaticMarkup(<ChartTooltipContent {...props} />)
  return host
}

test('非活动、空和隐藏数据不显示提示框；零值与负数仍可查看', () => {
  expect(tooltip({ payload: [item(0)] }).textContent).toBe('')
  expect(tooltip({ active: true, payload: [] }).textContent).toBe('')
  const host = tooltip({ active: true, payload: [item(0, '收入'), item(-120, '净额'), { ...item(99, '隐藏'), hide: true }] })
  expect(host.textContent).toContain('收入0')
  expect(host.textContent).toContain('净额-120')
  expect(host.textContent).not.toContain('隐藏')
})

test('保留原完整名称、formatter金额及元组语义', () => {
  const payload = [item(1234.56)]
  const format = vi.fn(() => ['¥1,234.56', '库存价值'])
  const host = tooltip({ active: true, payload, label: '短名', labelFormatter: () => '完整商品名称与型号颜色', formatter: format })
  expect(host.querySelector('.fc-chart-tooltip-heading')?.textContent).toBe('完整商品名称与型号颜色')
  expect(host.querySelector('.fc-chart-tooltip-name')?.textContent).toBe('库存价值')
  expect(host.querySelector('.fc-chart-tooltip-value')?.textContent).toBe('¥1,234.56')
  expect(format).toHaveBeenCalledWith(1234.56, '金额', payload[0], 0, payload)
})

test('行级formatter优先，原单位保留；显式返回null不泄漏原始值', () => {
  const host = tooltip({ active: true, payload: [{ ...item(4), unit: ' 单', formatter: () => '4' }, { ...item(88, '忽略'), formatter: () => null }], formatter: () => '错误格式' })
  expect(host.textContent).toBe('金额4 单')
  expect(host.querySelectorAll('.fc-chart-tooltip-row')).toHaveLength(1)
})

test('空标签不补造日期，数字标签0仍展示', () => {
  expect(tooltip({ active: true, payload: [item(2)] }).querySelector('.fc-chart-tooltip-heading')).toBeNull()
  expect(tooltip({ active: true, label: 0, payload: [item(2)] }).querySelector('.fc-chart-tooltip-heading')?.textContent).toBe('0')
})

test('图例保留完整长名称和原formatter，折线与柱形使用不同标记', () => {
  const html = renderToStaticMarkup(<ChartLegendContent payload={[{ value: '完整的结算账户名称', type: 'rect', color: '#123456' }, { value: '净额', type: 'line', color: '#456789' }, { value: '不显示', type: 'none' }]} formatter={value => `${value}（元）`} />)
  const host = document.createElement('div'); host.innerHTML = html
  expect(host.querySelectorAll('li')).toHaveLength(2)
  expect(host.textContent).toContain('完整的结算账户名称（元）')
  expect(host.querySelectorAll('[data-line]')).toHaveLength(1)
})

test('环图外部图例按传入顺序保留长名称、负余额和其他聚合项', () => {
  const html = renderToStaticMarkup(<ChartValueLegend entries={[
    { key: 1, label: '用于跨区结算的完整账户名称', value: '¥-123.45', color: '#123456' },
    { key: -1, label: '其他 4 个账户', value: '¥2,000.00', color: '#666' },
  ]} />)
  expect(html).toContain('用于跨区结算的完整账户名称')
  expect(html).toContain('¥-123.45')
  expect(html).toContain('其他 4 个账户')
})
