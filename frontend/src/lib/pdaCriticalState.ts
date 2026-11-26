import { WT_STATUS } from '@/generated/status'
import type { WarehouseTask } from '@/api/warehouse-tasks'

export function taskReachedStatus(task: WarehouseTask | null | undefined, expectedStatus: number) {
  const status = Number(task?.status)
  return Number.isInteger(status) && status >= WT_STATUS.PENDING && status <= WT_STATUS.SHIPPED
    && Number.isInteger(expectedStatus) && expectedStatus >= WT_STATUS.PENDING && status >= expectedStatus
}

export function stateConfirmedMessage(label: string, statusName?: string | null) {
  return statusName
    ? `${label}已成功，任务状态已更新为「${statusName}」。`
    : `${label}已成功，任务状态已更新。`
}
