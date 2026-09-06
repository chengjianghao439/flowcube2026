import { DirectShipmentDialog } from './DirectShipmentDialog'
import { shippingProductLabel } from '@/lib/shippingProducts'
import { OrderDetailSections } from '@/components/shared/OrderDetailSections'
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
import { getWaybillDetailApi, setWaybillTrackingApi, retryWaybillApi, voidWaybillApi } from '@/api/logistics'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 flex flex-col gap-1.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="break-words text-sm text-foreground">{children ?? '—'}</span>
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

  const [shipmentOpen, setShipmentOpen] = useState(false)
  const [trackOpen, setTrackOpen] = useState(false)
  const [trackingInput, setTrackingInput] = useState('')

  const { data: wb, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['waybill', waybillId],
    queryFn: () => getWaybillDetailApi(waybillId),
    enabled: Number.isFinite(waybillId) && waybillId > 0,
  })

  function invalidate() {
    qc.invalidateQueries({ queryKey: ['waybill', waybillId] })
    qc.invalidateQueries({ queryKey: ['waybill-track', waybillId] })
    qc.invalidateQueries({ queryKey: ['waybills'] })
  }

  const trackMut = useMutation({
    mutationFn: () => setWaybillTrackingApi(waybillId, trackingInput.trim(), { skipGlobalError: true }),
    onSuccess: () => { toast.success('已录入快递单号'); invalidate(); setTrackOpen(false); setTrackingInput('') },
    onError: (e: unknown) => toast.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? '录入失败'),
  })
  const retryMut = useMutation({
    mutationFn: () => retryWaybillApi(waybillId, { skipGlobalError: true }),
    onSuccess: () => { toast.success('已提交处理；已发送的平台订单仅查询原单'); invalidate() },
    onError: (e: unknown) => toast.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? '操作失败'),
  })
  const voidMut = useMutation({
    mutationFn: () => voidWaybillApi(waybillId, undefined, { skipGlobalError: true }),
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

  const direct = wb && ['sf', 'deppon'].includes(wb.platformCode || '')
  const canEditShipment = direct && !wb.submittedToPlatform && [1, 4].includes(wb.status) && wb.shipment
  const canRecord = wb && !direct && (wb.status === 1 || wb.status === 4)
  const canRetry = wb && [4, 6].includes(wb.status) && wb.platformCode
  const canVoid = wb && ![2, 5].includes(wb.status) && !(direct && (wb.submittedToPlatform || [3, 6].includes(wb.status)))

  return (
    <div className="space-y-4">
      <PageHeader
        title={wb ? `运单 ${wb.waybillNo}` : '运单详情'}
        description={wb ? <SoftStatusLabel label={wb.statusLabel} tone={wb.statusTone} /> : undefined}
        actions={
          <div className="flex items-center gap-2">
            {canManage && canEditShipment && <Button variant="outline" onClick={() => setShipmentOpen(true)}>补充寄件资料</Button>}
            {canManage && canRecord && <Button variant="outline" onClick={() => { setTrackingInput(wb?.trackingNo ?? ''); setTrackOpen(true) }}>手工录入快递单号</Button>}
            {canManage && canRetry && <Button variant="outline" onClick={() => retryMut.mutate()} disabled={retryMut.isPending}>{wb?.submittedToPlatform || wb?.status === 6 ? '查询原单' : '重试取号'}</Button>}
            {canManage && canVoid && <Button variant="outline" className="text-destructive" onClick={() => confirmAction({
              title: '作废运单', description: `确认作废运单 ${wb?.waybillNo}？`, variant: 'destructive', confirmText: '确认作废',
              onConfirm: () => voidMut.mutate(),
            })}>作废</Button>}
            <Button variant="outline" onClick={() => nav('/logistics')}>返回列表</Button>
          </div>
        }
      />

      <OrderDetailSections type="logistics" id={wb?.id || 0}>
      <div className="space-y-4">
        <SectionCard title="运单信息" compact>
          <div className="grid grid-cols-3 gap-x-6 gap-y-5">
            <Field label="快递单号">{wb?.trackingNo ? <span className="text-doc-code">{wb.trackingNo}</span> : '—'}</Field>
            <Field label="承运商">{wb?.carrierName}</Field>
            <Field label="对接平台">{wb?.platformCode ?? '未对接'}</Field>
            <Field label="预估运费">{wb?.estFreight != null ? Number(wb.estFreight).toFixed(2) : '—'}</Field>
            <Field label="运费方式">{wb?.freightTypeLabel}</Field>
            <Field label="面单数据">{wb?.printDataRef === 'official_platform' ? '请通过快递官方打印面单' : wb?.printDataRef ?? '—'}</Field>
            <Field label="销售单">{wb?.saleOrderNo}</Field>
            <Field label="包裹条码">{wb?.shipment?.packages.map(p => p.barcode || p.id).join('、') || wb?.packageBarcode}</Field>
            <Field label="仓库">{wb?.warehouseName}</Field>
            {direct && <Field label="实际打包件数">{wb?.shipment?.packages.length ?? '—'}</Field>}
            {direct && <Field label="发货产品">{shippingProductLabel(wb?.platformCode, wb?.shipment?.productCode)}</Field>}
            {direct && <Field label="重量">由快递员称重确认</Field>}
            {!!wb?.trackingNumbers?.length && <div className="col-span-3"><Field label="本批全部快递单号">{wb.trackingNumbers.join('、')}</Field></div>}
            <Field label="创建时间">{wb ? formatDisplayDateTime(wb.createdAt) : '—'}</Field>
          </div>
          <div className="mt-4 border-t border-border pt-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="收件人">{wb?.receiverName}</Field>
              <Field label="收件电话">{wb?.receiverPhone}</Field>
              <div className="sm:col-span-2"><Field label="收件地址">{wb?.receiverAddress}</Field></div>
            </div>
          </div>
          {wb && [4, 6].includes(wb.status) && wb.errorMessage && (
            <div className="mt-4 rounded-md border border-danger/20 bg-danger/10 px-3 py-2 text-sm text-danger">
              {wb.statusLabel}：{wb.errorMessage}（已重试 {wb.retryCount} 次）
            </div>
          )}
        </SectionCard>
      </div>

      </OrderDetailSections>

      {shipmentOpen && wb && <DirectShipmentDialog waybill={wb} onClose={() => setShipmentOpen(false)} onSaved={invalidate} />}
      <Dialog open={trackOpen} onOpenChange={v => { if (!v) { setTrackOpen(false); setTrackingInput('') } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>录入快递单号</DialogTitle></DialogHeader>
          <div className="space-y-4 py-3">
            <p className="text-sm text-muted-foreground">运单 {wb?.waybillNo}｜{wb?.carrierName ?? '未指定承运商'}</p>
            <div>
              <Label htmlFor="logistics-detail-tracking-number">快递单号</Label>
              <Input id="logistics-detail-tracking-number" className="mt-2 font-mono" placeholder="输入承运商快递单号" value={trackingInput} onChange={e => setTrackingInput(e.target.value)} autoFocus />
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
