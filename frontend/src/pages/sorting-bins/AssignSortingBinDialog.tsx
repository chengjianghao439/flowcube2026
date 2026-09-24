import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getPendingSortingBinTasksApi, assignSortingBinApi } from '@/api/warehouse-tasks'
import { createRequestKey } from '@/lib/requestKey'
import { toast } from '@/lib/toast'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'

interface Props {
  open: boolean
  onClose: () => void
  warehouseId?: number | null
  onAssigned?: () => void
}

export default function AssignSortingBinDialog({ open, onClose, warehouseId, onAssigned }: Props) {
  const qc = useQueryClient()
  const [page, setPage] = useState(1)
  const requestKeys = useRef(new Map<number, string>())
  useEffect(() => { if (open) setPage(1) }, [open, warehouseId])
  const query = useQuery({
    queryKey: ['sorting-bin-pending', warehouseId, page],
    queryFn: () => getPendingSortingBinTasksApi({ warehouseId: warehouseId ?? undefined, page, pageSize: 20 }),
    enabled: open,
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
    onError: (error: Error) => toast.error(error.message || '分拣格补分配失败'),
  })
  const pending = query.data
  const total = pending?.pagination.total ?? 0
  const maxPage = Math.max(1, Math.ceil(total / 20))

  return <Dialog open={open} onOpenChange={next => { if (!next) onClose() }}>
    <DialogContent className="max-w-2xl">
      <DialogHeader><DialogTitle>补分配分拣格</DialogTitle></DialogHeader>
      <p className="text-sm text-muted-foreground">仅列出拣货中或待分拣、尚未占格且无取消或改单挂起的任务。系统从任务所属仓库选择空闲格。</p>
      {query.isPending && <p role="status" className="text-sm">正在加载待分配任务…</p>}
      {query.isError && <div role="alert" className="text-sm">读取失败：{query.error.message}<Button variant="outline" size="sm" onClick={() => void query.refetch()}>重试</Button></div>}
      {pending && pending.list.length === 0 && <p className="text-sm text-muted-foreground">当前筛选范围内没有待分配任务。</p>}
      {pending && pending.list.length > 0 && <div className="max-h-96 divide-y overflow-y-auto rounded-md border">
        {pending.list.map(task => <div key={task.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
          <div className="min-w-0">
            <p className="font-medium">{task.taskNo} <span className="font-normal text-muted-foreground">{task.statusName}</span></p>
            <p className="text-xs text-muted-foreground">{task.warehouseName} · {task.customerName}</p>
          </div>
          <Button size="sm" disabled={mutation.isPending} onClick={() => mutation.mutate(task.id)}>补分配</Button>
        </div>)}
      </div>}
      {pending && total > 20 && <div className="flex items-center justify-end gap-2 text-sm">
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(value => value - 1)}>上一页</Button>
        <span>{page} / {maxPage}</span>
        <Button variant="outline" size="sm" disabled={page >= maxPage} onClick={() => setPage(value => value + 1)}>下一页</Button>
      </div>}
    </DialogContent>
  </Dialog>
}
