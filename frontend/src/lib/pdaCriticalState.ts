import type { WarehouseTask } from '@/api/warehouse-tasks'

export function taskReachedStatus(task: WarehouseTask | null | undefined, expectedStatus: number) {
  return Number(task?.status) >= expectedStatus
}

export function stateConfirmedMessage(label: string, statusName?: string | null) {
  return statusName
    ? `${label}已成功，任务状态已更新为「${statusName}」。`
    : `${label}已成功，任务状态已更新。`
}
