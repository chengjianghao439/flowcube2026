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
import { useWorkspaceTabTitle } from '@/hooks/useWorkspaceTabTitle'
import { useActiveWorkspaceTab } from '@/hooks/useActiveWorkspaceTab'
import { useWorkspaceStore } from '@/store/workspaceStore'
import { buildWorkspaceTabRegistration } from '@/router/workspaceRouteMeta'
import { resolveRouteTitle } from '@/router/routeDefinitions'
import type { LogisticsWaybill } from '@/types/logistics'
import { confirmAction } from '@/lib/confirm'
import { ActionBar } from '@/components/shared/ActionBar'
import { OrderFact, OrderFacts } from '@/components/shared/OrderFacts'
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

export default function LogisticsDetailPage() {
  // 多标签 keep-alive 下页面路径来自 TabPathContext（/* catch-all，useParams 取不到 id）
  const tabPath = useContext(TabPathContext)
  const params = useParams<{ id?: string }>()
  const rawId = (tabPath?.split(/[?#]/)[0] || params.id || '').split('/').filter(Boolean).pop() ?? ''
  const waybillId = Number(rawId)
  const validId = /^[1-9]\d*$/.test(rawId) && Number.isSafeInteger(waybillId) && waybillId > 0
  const isActiveTab = useActiveWorkspaceTab()
  const addTab = useWorkspaceStore(s => s.addTab)
  const nav = useNavigate()
  const qc = useQueryClient()
  const { can } = usePermission()
  const canManage = can(PERMISSIONS.LOGISTICS_MANAGE)

  const [shipmentTarget, setShipmentTarget] = useState<LogisticsWaybill | null>(null)
  const [trackTarget, setTrackTarget] = useState<LogisticsWaybill | null>(null)
  const [trackingInput, setTrackingInput] = useState('')

  const query = useQuery({
    queryKey: ['waybill', waybillId],
    queryFn: () => getWaybillDetailApi(waybillId),
    enabled: validId && isActiveTab,
    staleTime: 0,
    refetchOnMount: 'always',
    retry: false,
  })
  const { isLoading, isError, error, refetch } = query
  const wb = validId && query.data?.id === waybillId ? query.data : undefined
  const readReady = isActiveTab && !!wb && !query.isFetching && !query.isPaused && !isError
  const knownStatus = !!wb && [1, 2, 3, 4, 5, 6].includes(wb.status)
  const canOperate = readReady && knownStatus
  useWorkspaceTabTitle(readReady ? wb?.waybillNo : undefined)

  function openPath(pathname: string, search = '') {
    if (!canOperate) return
    const target = buildWorkspaceTabRegistration(pathname, search)
    addTab({ ...target, title: resolveRouteTitle(pathname) || '详情' })
    nav(target.path)
  }

  function invalidate() {
    qc.invalidateQueries({ queryKey: ['waybill', waybillId] })
    qc.invalidateQueries({ queryKey: ['waybill-track', waybillId] })
    qc.invalidateQueries({ queryKey: ['waybills'] })
  }

  const trackMut = useMutation({
    mutationFn: () => {
      if (!canOperate || !canManage || !canRecord || trackTarget?.id !== waybillId) throw new Error('请先重新读取原运单，草稿已保留')
      return setWaybillTrackingApi(trackTarget.id, trackingInput.trim(), { skipGlobalError: true })
    },
    onSuccess: () => { toast.success('已录入快递单号'); invalidate(); setTrackTarget(null); setTrackingInput('') },
    onError: (e: unknown) => toast.error(e instanceof Error && e.message ? e.message : '录入失败'),
  })
  const retryMut = useMutation({
    mutationFn: (id: number) => {
      if (!canOperate || !canManage || !canRetry || id !== waybillId) throw new Error('请先重新读取原运单')
      return retryWaybillApi(id, { skipGlobalError: true })
    },
    onSuccess: () => { toast.success('已提交处理；已发送的平台订单仅查询原单'); invalidate() },
    onError: (e: unknown) => toast.error(e instanceof Error && e.message ? e.message : '操作失败'),
  })
  const voidMut = useMutation({
    mutationFn: (id: number) => {
      if (!canOperate || !canManage || !canVoid || id !== waybillId) throw new Error('请先重新读取原运单')
      return voidWaybillApi(id, undefined, { skipGlobalError: true })
    },
    onSuccess: () => { toast.success('运单本地记录已作废'); invalidate() },
    onError: (e: unknown) => toast.error(e instanceof Error && e.message ? e.message : '操作失败'),
  })

  const direct = wb && ['sf', 'deppon'].includes(wb.platformCode || '')
  const canEditShipment = canOperate && direct && !wb.submittedToPlatform && [1, 4].includes(wb.status) && wb.shipment
  const canRecord = canOperate && wb && !direct && (wb.status === 1 || wb.status === 4)
  const canRetry = canOperate && wb && [4, 6].includes(wb.status) && wb.platformCode
  const canVoid = canOperate && wb && ![2, 5].includes(wb.status) && !(direct && (wb.submittedToPlatform || [3, 6].includes(wb.status)))
  const saleOrderId = wb?.saleOrderId
  const safeSaleId = typeof saleOrderId === 'number' && Number.isSafeInteger(saleOrderId) && saleOrderId > 0
  const nextStep = !knownStatus ? '状态暂无法确认，请重新读取原运单后核对。'
    : wb?.status === 5 ? '本地记录已作废，不代表快递官方订单已取消；官方取消结果需另行核实。'
    : wb?.status === 3 ? `已取号不等于面单已出纸。${wb.printDataRef === 'official_platform' ? '请通过快递官方打印面单，并在现场核对纸张。' : '请现场核对面单和纸张。'}`
    : wb?.status === 2 ? '取号正在处理中，请等待并核对原运单，避免重复提交。'
    : wb?.submittedToPlatform && wb.status === 1 ? '先核对原单取号进度，不重复新建；进入取号失败或下单待核实时可用查询原单。'
    : wb?.submittedToPlatform || wb?.status === 6 ? '请查询原单核实平台结果，不新建订单或更换取号身份；取消请通过快递官方处理。'
    : direct ? '尚未向平台提交，可补充寄件资料；取号失败时核对资料后使用既有重试取号。'
    : wb?.platformCode ? '已配置快递平台，请核对取号进度；失败时先核查原因，再使用原重试或录入已有快递单号。'
    : '待取号或取号失败时，请手工录入快递单号后核对面单。'

  return (
    <div className="desktop-document-detail flex flex-col gap-3">
      <ActionBar
        title={wb ? `运单 ${wb.waybillNo}` : '运单详情'}
        description={readReady ? nextStep : <span role="status">{!validId ? '运单标识无效，无法读取。' : query.isPaused ? '网络已暂停，恢复后重新读取原运单。' : isError ? '最新状态待核对，旧记录暂不提供操作；已打开的草稿保留。' : query.isFetching ? '正在重新读取原运单，旧记录暂不提供操作。' : '原运单尚未核实，暂不提供操作。'}</span>}
        subtitle={wb ? <SoftStatusLabel label={wb.statusLabel} tone={wb.statusTone} /> : undefined}
        rightActions={canManage && <>
          {canVoid && (
            <div role="group" aria-label="运单作废操作" className="flex items-center gap-2 border-r border-border pr-2 last:border-r-0 last:pr-0">
              <Button variant="outline" className="text-destructive-ink border-destructive/30 hover:bg-destructive/5" onClick={() => confirmAction({
                title: '作废运单本地记录', description: `确认作废运单 ${wb?.waybillNo} 的本地记录？此操作不代表快递官方订单已取消。`, variant: 'destructive', confirmText: '确认作废',
                onConfirm: () => voidMut.mutate(wb!.id),
              })}>作废</Button>
            </div>
          )}
          {canEditShipment && <Button variant={canRetry ? 'outline' : 'default'} onClick={() => setShipmentTarget(wb!)}>补充寄件资料</Button>}
          {canRecord && <Button variant={canRetry ? 'outline' : 'default'} onClick={() => { setTrackingInput(wb?.trackingNo ?? ''); setTrackTarget(wb!) }}>手工录入快递单号</Button>}
          {canRetry && <Button onClick={() => retryMut.mutate(wb!.id)} disabled={retryMut.isPending}>{wb?.submittedToPlatform || wb?.status === 6 ? '查询原单' : '重试取号'}</Button>}
        </>}
      />

      {isError && validId && isActiveTab && <QueryErrorState error={error} onRetry={() => { if (validId && isActiveTab) void refetch() }} title="运单加载失败" compact />}
      <OrderDetailSections type="logistics" id={wb?.id || 0}>
      <div className="space-y-4">
        <SectionCard title="运单信息" compact>
          <OrderFacts>
            <OrderFact label="快递单号">{wb?.trackingNo ? <span className="text-doc-code">{wb.trackingNo}</span> : '—'}</OrderFact>
            <OrderFact label="承运商">{wb?.carrierName ?? '—'}</OrderFact>
            <OrderFact label="对接平台">{wb?.platformCode ?? '未对接'}</OrderFact>
            <OrderFact label="预估运费">{wb?.estFreight != null ? Number(wb.estFreight).toFixed(2) : '—'}</OrderFact>
            <OrderFact label="运费方式">{wb?.freightTypeLabel ?? '—'}</OrderFact>
            <OrderFact label="面单数据">{wb?.printDataRef === 'official_platform' ? '请通过快递官方打印面单' : wb?.printDataRef ?? '—'}</OrderFact>
            <OrderFact label="销售单">{canOperate && safeSaleId && can(PERMISSIONS.SALE_ORDER_VIEW) ? <Button size="sm" variant="link" className="h-auto justify-start p-0 text-doc-code" onClick={() => openPath(`/sale/${saleOrderId}`)}>{wb?.saleOrderNo || `销售单 #${saleOrderId}`}</Button> : wb?.saleOrderNo ?? '—'}</OrderFact>
            <OrderFact label="包裹条码">{wb?.shipment?.packages.map(p => p.barcode || p.id).join('、') || wb?.packageBarcode || '—'}</OrderFact>
            <OrderFact label="仓库">{wb?.warehouseName ?? '—'}</OrderFact>
            {direct && <OrderFact label="实际打包件数">{wb?.shipment?.packages.length ?? '—'}</OrderFact>}
            {direct && <OrderFact label="发货产品">{shippingProductLabel(wb?.platformCode, wb?.shipment?.productCode)}</OrderFact>}
            {direct && <OrderFact label="重量">由快递员称重确认</OrderFact>}
            {!!wb?.trackingNumbers?.length && <OrderFact label="本批全部快递单号" className="col-span-full">{wb.trackingNumbers.join('、')}</OrderFact>}
            <OrderFact label="创建时间">{wb ? formatDisplayDateTime(wb.createdAt) : '—'}</OrderFact>
          </OrderFacts>
          {canOperate && can(PERMISSIONS.PRINT_JOB_VIEW) && (
            <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border pt-3">
              <Button size="sm" variant="outline" onClick={() => openPath('/settings/barcode-print-query', '?category=logistics')}>查看物流标签记录</Button>
              <p className="text-xs text-muted-foreground">进入物流类别查询，需按记录核对；此入口不定位本运单的原打印任务。</p>
            </div>
          )}
          <div className="mt-4 border-t border-border pt-4">
            <OrderFacts>
              <OrderFact label="收件人">{wb?.receiverName ?? '—'}</OrderFact>
              <OrderFact label="收件电话">{wb?.receiverPhone ?? '—'}</OrderFact>
              <OrderFact label="收件地址" className="col-span-full">{wb?.receiverAddress ?? '—'}</OrderFact>
            </OrderFacts>
          </div>
          {wb && [4, 6].includes(wb.status) && wb.errorMessage && (
            <div className="mt-4 rounded-md border border-danger/20 bg-danger/10 px-3 py-2 text-sm text-danger">
              {wb.statusLabel}：{wb.errorMessage}（已重试 {wb.retryCount} 次）
            </div>
          )}
        </SectionCard>
      </div>

      </OrderDetailSections>

      {shipmentTarget && <DirectShipmentDialog waybill={shipmentTarget} submitDisabled={!canManage || !canEditShipment || shipmentTarget.id !== waybillId} onClose={() => setShipmentTarget(null)} onSaved={invalidate} />}
      <Dialog open={!!trackTarget} onOpenChange={v => { if (!v) { setTrackTarget(null); setTrackingInput('') } }}>
        <DialogContent className="fc-form-dialog max-w-lg">
          <DialogHeader description={<>{<>保留原运单草稿，核实最新状态后保存。</>} {<>运单 {trackTarget?.waybillNo}｜{trackTarget?.carrierName ?? '未指定承运商'}</>}</>}><DialogTitle>录入快递单号</DialogTitle></DialogHeader>
          <div className="fc-form-dialog-body space-y-4 py-3">

            {(!canRecord || trackTarget?.id !== waybillId) && <p className="text-sm text-muted-foreground" role="status">原运单最新状态待核对，已输入的单号保留，暂不能保存。</p>}
            <div>
              <Label htmlFor="logistics-detail-tracking-number">快递单号</Label>
              <Input id="logistics-detail-tracking-number" className="mt-2 font-mono" placeholder="输入承运商快递单号" value={trackingInput} onChange={e => setTrackingInput(e.target.value)} autoFocus />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setTrackTarget(null); setTrackingInput('') }}>取消</Button>
            <Button disabled={!canManage || !canRecord || trackTarget?.id !== waybillId || !trackingInput.trim() || trackMut.isPending} onClick={() => trackMut.mutate()}>保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {isLoading && <div className="text-sm text-muted-foreground">加载中…</div>}
    </div>
  )
}
