import { expect, test } from 'vitest'
import { WT_STATUS } from '@/generated/status'
import type { WarehouseTask } from '@/api/warehouse-tasks'
import { taskReachedStatus } from './pdaCriticalState'

test('仅有效的作业进度能证明已达到预期阶段', () => {
  const task = (status: number) => ({ status }) as WarehouseTask
  for (const expected of [WT_STATUS.CHECKING, WT_STATUS.PACKING, WT_STATUS.SHIPPED]) {
    expect(taskReachedStatus(task(WT_STATUS.CANCELLED), expected)).toBe(false)
    expect(taskReachedStatus(task(WT_STATUS.SHIPPED), expected)).toBe(true)
    expect(taskReachedStatus(task(WT_STATUS.PICKING), expected)).toBe(false)
    for (const invalid of [9, Infinity, NaN, 6.5]) expect(taskReachedStatus(task(invalid), expected)).toBe(false)
    expect(taskReachedStatus(undefined, expected)).toBe(false)
  }
})
