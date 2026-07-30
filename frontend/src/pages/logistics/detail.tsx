/**
 * 物流运单详情页（含轨迹时间线）
 * 路由：/logistics/:id
 */
import { useState, useContext } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { TabPathContext } from '@/components/layout/TabPathContext'
import { toast } from '@/lib/toast'
import { confirmAction } from '@/lib/confirm'
import PageHeader from '@/components/shared/PageHeader'
import { SectionCard } from '@/components/shared/SectionCard'
import { QueryErrorState } from '@/components/shared/QueryErrorState'
import { SoftStatusLabel } from '@/components/shared/StatusBadge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { usePermission } from '@/hooks/usePermission'
import { PERMISSIONS } from '@/lib/permission-codes'
import { formatDisplayDateTime } from '@/lib/dateTime'
import { getWaybillDetailApi, getWaybillTrackApi, setWaybillTrackingApi, retryWaybillApi, voidWaybillApi } from '@/api/logistics'
import TrackTimeline from './components/TrackTimeline'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm text-foreground">{children ?? '—'}</span>
    </div>
  )
}

export default function LogisticsDetailPage() {
  // 多标签 keep-alive 下页面路径来自 TabPathContext（/* catch-all，useParams 取不到 id）
  const tabPath = useContext(TabPathContext)
  const params = useParams<{ id?: string }>()
  const rawId = (tabPath || params.id || '').split('/').filter(Boolean).pop() ?? ''
  const waybillId = Number(rawId)
  const nav = useNavigate()
  const qc = useQueryClient()
  const { can } = usePermission()
  const canManage = can(PERMISSIONS.LOGISTICS_MANAGE)

  const [trackOpen, setTrackOpen] = useState(false)
  const [trackingInput, setTrackingInput] = useState('')

  const { data: wb, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['waybill', waybillId],
    queryFn: () => getWaybillDetailApi(waybillId),
    enabled: Number.isFinite(waybillId) && waybillId > 0,
  })
  const { data: events } = useQuery({
    queryKey: ['waybill-track', waybillId],
    queryFn: () => getWaybillTrackApi(waybillId),
    enabled: Number.isFinite(waybillId) && waybillId > 0,
  })

  function invalidate() {
    qc.invalidateQueries({ queryKey: ['waybill', waybillId] })
    qc.invalidateQueries({ queryKey: ['waybill-track', waybillId] })
    qc.invalidateQueries({ queryKey: ['waybills'] })
  }

  const trackMut = useMutation({
    mutationFn: () => setWaybillTrackingApi(waybillId, trackingInput.trim()),
    onSuccess: () => { toast.success('已录入快递单号'); invalidate(); setTrackOpen(false); setTrackingInput('') },
    onError: (e: unknown) => toast.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? '录入失败'),
  })
  const retryMut = useMutation({
    mutationFn: () => retryWaybillApi(waybillId),
    onSuccess: () => { toast.success('已重新提交取号'); invalidate() },
    onError: (e: unknown) => toast.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? '操作失败'),
  })
  const voidMut = useMutation({
    mutationFn: () => voidWaybillApi(waybillId),
    onSuccess: () => { toast.success('运单已作废'); invalidate() },
    onError: (e: unknown) => toast.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? '操作失败'),
  })

  if (isError && !wb) {
    return (
      <div className="space-y-4">
        <PageHeader title="运单详情" actions={<Button variant="outline" onClick={() => nav('/logistics')}>返回列表</Button>} />
        <QueryErrorState error={error} onRetry={() => void refetch()} title="运单加载失败" compact />
      </div>
    )
  }

  const canRecord = wb && (wb.status === 1 || wb.status === 4)
  const canRetry = wb && wb.status === 4 && wb.platformCode
  const canVoid = wb && wb.status !== 5

  return (
    <div className="space-y-4">
      <PageHeader
        title={wb ? `运单 ${wb.waybillNo}` : '运单详情'}
        description={wb ? <SoftStatusLabel label={wb.statusLabel} tone={wb.statusTone} /> : undefined}
        actions={
          <div className="flex items-center gap-2">
            {canManage && canRecord && <Button variant="outline" onClick={() => { setTrackingInput(wb?.trackingNo ?? ''); setTrackOpen(true) }}>手工录号</Button>}
            {canManage && canRetry && <Button variant="outline" onClick={() => retryMut.mutate()} disabled={retryMut.isPending}>重试取号</Button>}
            {canManage && canVoid && <Button variant="outline" className="text-destructive" onClick={() => confirmAction({
              title: '作废运单', description: `确认作废运单 ${wb?.waybillNo}？`, variant: 'destructive', confirmText: '确认作废',
              onConfirm: () => voidMut.mutate(),
            })}>作废</Button>}
            <Button variant="outline" onClick={() => nav('/logistics')}>返回列表</Button>
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <SectionCard title="运单信息">
          <div className="grid grid-cols-2 gap-4">
            <Field label="快递单号">{wb?.trackingNo ? <span className="text-doc-code">{wb.trackingNo}</span> : '—'}</Field>
            <Field label="承运商">{wb?.carrierName}</Field>
            <Field label="对接平台">{wb?.platformCode ?? '未对接'}</Field>
            <Field label="预估运费">{wb?.estFreight != null ? Number(wb.estFreight).toFixed(2) : '—'}</Field>
            <Field label="运费方式">{wb?.freightTypeLabel}</Field>
            <Field label="面单数据">{wb?.printDataRef ?? '—'}</Field>
            <Field label="销售单">{wb?.saleOrderNo}</Field>
            <Field label="包裹条码">{wb?.packageBarcode}</Field>
            <Field label="仓库">{wb?.warehouseName}</Field>
            <Field label="创建时间">{wb ? formatDisplayDateTime(wb.createdAt) : '—'}</Field>
          </div>
          <div className="mt-4 border-t border-border pt-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="收件人">{wb?.receiverName}</Field>
              <Field label="收件电话">{wb?.receiverPhone}</Field>
              <div className="sm:col-span-2"><Field label="收件地址">{wb?.receiverAddress}</Field></div>
            </div>
          </div>
          {wb?.status === 4 && wb.errorMessage && (
            <div className="mt-4 rounded-md border border-danger/20 bg-danger/10 px-3 py-2 text-sm text-danger">
              取号失败：{wb.errorMessage}（已重试 {wb.retryCount} 次）
            </div>
          )}
        </SectionCard>

        <SectionCard title="物流轨迹">
          <TrackTimeline events={events ?? []} />
        </SectionCard>
      </div>

      <Dialog open={trackOpen} onOpenChange={v => { if (!v) { setTrackOpen(false); setTrackingInput('') } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>手工录快递单号</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">运单 {wb?.waybillNo}｜{wb?.carrierName ?? '未指定承运商'}</p>
            <div>
              <Label>快递单号</Label>
              <Input className="mt-1" placeholder="输入承运商快递单号" value={trackingInput} onChange={e => setTrackingInput(e.target.value)} autoFocus />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setTrackOpen(false); setTrackingInput('') }}>取消</Button>
            <Button disabled={!trackingInput.trim() || trackMut.isPending} onClick={() => trackMut.mutate()}>保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {isLoading && <div className="text-sm text-muted-foreground">加载中…</div>}
    </div>
  )
}
