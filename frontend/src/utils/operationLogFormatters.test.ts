import { expect, test } from 'vitest'
import { formatApiPath } from './operationLogFormatters'

test('销售派发和仓库实物出库显示不同操作阶段', () => {
  expect(formatApiPath('/api/sale/3/ship', 'POST', 200)).toBe('销售单 · 发起出库')
  expect(formatApiPath('/api/warehouse-tasks/4/ship', 'POST', 200)).toBe('仓库任务出库')
})
