import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { toast } from '@/lib/toast'
import { getTaskShortagesApi, resolveShortageApi, type TaskShortage } from '@/api/warehouse-tasks'
import { useInvalidate } from '@/hooks/useInvalidate'

interface Props { open: boolean; onClose: () => void; taskId: number | null; taskNo?: string | null }

/**
 * 拣货缺货上报处理：仓库现场上报"拣不出 N 件"后任务挂起，由这里决策——
 * 按实拣改单（销售单减掉缺口量，改单立即生效）或驳回（线下已补货，现场继续拣）。
 */
export default function ShortageResolveDialog({ open, onClose, taskId, taskNo }: Props) {
  const qc = useQueryClient()
  const invalidate = useInvalidate()
  const { data: shortages, isLoading } = useQuery({
    queryKey: ['task-shortages', taskId],
    queryFn: () => getTaskShortagesApi(taskId!),
    enabled: open && !!taskId,
  })
  const resolve = useMutation({
    mutationFn: ({ shortageId, action }: { shortageId: number; action: 'adjustToPicked' | 'dismiss' }) =>
      resolveShortageApi(shortageId, action),
    onSuccess: (_, v) => {
      qc.invalidateQueries({ queryKey: ['task-shortages', taskId] })
      invalidate('sale_adjust')
      toast.success(v.action === 'adjustToPicked' ? '已按实拣改单并关闭上报' : '已驳回，现场可继续拣货')
    },
  })
  const [confirm, setConfirm] = useState<{ shortage: TaskShortage; action: 'adjustToPicked' | 'dismiss' } | null>(null)

  const openOnes = (shortages || []).filter(s => s.status === 1)
  const closedOnes = (shortages || []).filter(s => s.status !== 1)

  return (
    <>
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>缺货上报处理{taskNo ? ` — ${taskNo}` : ''}</DialogTitle>
        </DialogHeader>
        {isLoading && <p className="py-6 text-center text-muted-foreground">加载中...</p>}
        {!isLoading && !openOnes.length && !closedOnes.length && (
          <p className="py-6 text-center text-muted-foreground">该任务没有缺货上报记录</p>
        )}
        {openOnes.length > 0 && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              仓库现场拣不出以下商品，任务已挂起。「按实拣改单」将把销售单数量减去缺口（立即生效）；
              「驳回」表示已线下补货，现场继续拣。
            </p>
            {openOnes.map(s => (
              <div key={s.id} className="border rounded-md p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="font-medium">{s.productName}</span>
                    <span className="ml-2 text-red-600 font-semibold">缺 {s.missingQty}</span>
                    {s.reason && <span className="ml-2 text-xs text-muted-foreground">备注：{s.reason}</span>}
                  </div>
                  <Badge variant="destructive">{s.statusName}</Badge>
                </div>
                <p className="text-xs text-muted-foreground">上报人：{s.reportedByName || '-'} · {s.createdAt}</p>
                <div className="flex gap-2">
                  <Button size="sm" disabled={resolve.isPending}
                    onClick={() => setConfirm({ shortage: s, action: 'adjustToPicked' })}>按实拣改单</Button>
                  <Button size="sm" variant="outline" disabled={resolve.isPending}
                    onClick={() => setConfirm({ shortage: s, action: 'dismiss' })}>驳回（已补货）</Button>
                </div>
              </div>
            ))}
          </div>
        )}
        {closedOnes.length > 0 && (
          <div className="mt-2 space-y-1">
            <p className="text-xs font-medium text-muted-foreground">历史记录</p>
            {closedOnes.map(s => (
              <p key={s.id} className="text-xs text-muted-foreground">
                {s.productName} 缺 {s.missingQty} — {s.statusName}（{s.resolvedByName || '-'}）
              </p>
            ))}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>关闭</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <ConfirmDialog
      open={!!confirm}
      title={confirm?.action === 'adjustToPicked' ? '按实拣改单' : '驳回缺货上报'}
      description={confirm?.action === 'adjustToPicked'
        ? `将把销售单中「${confirm?.shortage.productName}」的数量减少 ${confirm?.shortage.missingQty}（缺口部分不再发货），改单立即生效，是否继续？`
        : `确认已线下补货？驳回后现场需继续把「${confirm?.shortage.productName}」拣齐。`}
      confirmText="确认"
      loading={resolve.isPending}
      onConfirm={() => { if (confirm) { resolve.mutate({ shortageId: confirm.shortage.id, action: confirm.action }); setConfirm(null) } }}
      onCancel={() => setConfirm(null)}
    />
    </>
  )
}
