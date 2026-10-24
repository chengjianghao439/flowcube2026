import { useRef } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getPendingSortingBinTasksApi, assignSortingBinApi } from '@/api/warehouse-tasks'
import { collectAllRecords } from '@/api/allRecords'
import { getApiClientBaseURL } from '@/api/client'
import { useAuthStore } from '@/store/authStore'
import DataTable from '@/components/shared/DataTable'
import type { TableColumn } from '@/types'
import type { PendingSortingBinTask } from '@/api/warehouse-tasks'
import { useSectionActive } from '@/components/layout/SectionVisibilityContext'
import { createRequestKey } from '@/lib/requestKey'
import { toast } from '@/lib/toast'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'

interface Props {
  open: boolean
  onClose: () => void
  warehouseId?: number | null
  taskId?: number
  onAssigned?: () => void
}

function readIdentity() {
  const state = useAuthStore.getState()
  return JSON.stringify([state.sessionGeneration, state.user?.id, state.user?.roleId, state.user?.permissions, getApiClientBaseURL()])
}

export default function AssignSortingBinDialog({ open, onClose, warehouseId, taskId, onAssigned }: Props) {
  const qc = useQueryClient()
  const active = useSectionActive()
  const requestKeys = useRef(new Map<number, string>())
  const query = useQuery({
    queryKey: ['sorting-bin-pending', warehouseId, taskId, taskId ? 1 : 'all'],
    queryFn: ({ signal }) => {
      if (taskId) return getPendingSortingBinTasksApi({ warehouseId: warehouseId ?? undefined, taskId, page: 1, pageSize: 20 })
      const identity = readIdentity()
      return collectAllRecords(async (page, pageSize = 200) => {
        if (identity !== readIdentity()) throw new Error('待分配任务读取上下文已变化，请重试')
        const result = await getPendingSortingBinTasksApi({ warehouseId: warehouseId ?? undefined, page, pageSize })
        if (identity !== readIdentity()) throw new Error('待分配任务读取上下文已变化，请重试')
        return result
      }, signal)
    },
    enabled: open && active,
    subscribed: open && active,
    staleTime: 0,
    refetchOnMount: 'always',
  })
  const mutation = useMutation({
    mutationFn: (taskId: number) => {
      let key = requestKeys.current.get(taskId)
      if (!key) { key = createRequestKey('sorting-bin-assign'); requestKeys.current.set(taskId, key) }
      return assignSortingBinApi(taskId, key)
    },
    onSuccess: (data, taskId) => {
      requestKeys.current.delete(taskId)
      void qc.invalidateQueries({ queryKey: ['sorting-bin-pending'] })
      void qc.invalidateQueries({ queryKey: ['sorting-bins'] })
      void qc.invalidateQueries({ queryKey: ['sale'] })
      onAssigned?.()
      toast.success(`任务已分配至分拣格 ${data.binCode}`)
    },
    onError: (error: Error) => {
      toast.error(error.message || '分拣格补分配失败')
      void qc.invalidateQueries({ queryKey: ['sorting-bin-pending'] })
    },
  })
  const pending = query.isError ? undefined : query.data
  const rows = pending?.list.filter(task => !taskId || (task.id === taskId && task.warehouseId === warehouseId)) ?? []
  const canAssign = open && active && query.isSuccess && !query.isFetching && !query.isPaused && !mutation.isPending
  const eligibleIds = useRef(new Set<number>())
  eligibleIds.current = new Set(canAssign ? rows.map(task => task.id) : [])
  const total = pending?.pagination.total ?? 0
  const columns: TableColumn<PendingSortingBinTask>[] = [
    { key: 'taskNo', title: '任务', render: (_, task) => <div><p className="font-medium">{task.taskNo}</p><p className="text-xs text-muted-foreground">{task.statusName}</p></div> },
    { key: 'warehouseName', title: '仓库 / 客户', render: (_, task) => <div>{task.warehouseName}<p className="text-xs text-muted-foreground">{task.customerName}</p></div> },
    { key: 'id', title: '操作', width: 100, render: (_, task) => <Button size="sm" disabled={!canAssign} onClick={() => { if (eligibleIds.current.has(task.id)) mutation.mutate(task.id) }}>补分配</Button> },
  ]

  return <Dialog open={open} onOpenChange={next => { if (!next) onClose() }}>
    <DialogContent className="max-w-2xl">
      <DialogHeader description={<>
        {query.isFetching && <span role="status">正在加载待分配任务… </span>}
        {pending && !query.isFetching && rows.length === 0 && <span role="status">{taskId ? '已刷新：该任务已不符合补分配条件或不在可访问范围内，请返回订单刷新进度。' : '当前筛选范围内没有待分配任务。'} </span>}
        {pending && !query.isFetching && !taskId && pending.truncated && <span role="status">{`仅显示前 ${rows.length.toLocaleString()} 条，共 ${total.toLocaleString()} 条，候选未全部读取；请缩小仓库范围或处理后重新打开。`} </span>}
        仅列出拣货中或待分拣、尚未占格且无取消或改单挂起的任务。系统从任务所属仓库选择空闲格。
      </>}><DialogTitle>补分配分拣格</DialogTitle></DialogHeader>

      {query.isError && <div role="alert" className="text-sm">读取失败：{query.error.message}<Button variant="outline" size="sm" onClick={() => void query.refetch()}>重试</Button></div>}
      {taskId && <Button variant="outline" size="sm" disabled={query.isFetching || mutation.isPending} onClick={() => void query.refetch()}>刷新任务</Button>}
      {pending && rows.length > 0 && <div data-workspace-scroll className="max-h-96 overflow-y-auto rounded-md border"><DataTable columns={columns} data={rows} virtualized preserveFocus /></div>}
      {pending && !query.isFetching && !taskId && !pending.truncated && <p role="status" className="text-xs text-muted-foreground">共 {total.toLocaleString()} 条待分配任务</p>}
    </DialogContent>
  </Dialog>
}
