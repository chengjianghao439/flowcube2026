import { RecordIdentity } from '@/components/shared/RecordIdentity'
/**
 * 物流运单列表页
 * 路由：/logistics
 */
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { toast } from '@/lib/toast'
import { confirmAction } from '@/lib/confirm'
import { downloadExport } from '@/lib/exportDownload'
import PageHeader from '@/components/shared/PageHeader'
import DataTable from '@/components/shared/DataTable'
import ListSummary from '@/components/shared/ListSummary'
import { QueryErrorState } from '@/components/shared/QueryErrorState'
import { EmptyState } from '@/components/shared/EmptyState'
import { AppliedDateRange } from '@/components/shared/AppliedDateRange'
import TableActionsMenu from '@/components/shared/TableActionsMenu'
import { SoftStatusLabel } from '@/components/shared/StatusBadge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { usePermission } from '@/hooks/usePermission'
import { useCarriersActive } from '@/hooks/useCarriers'
import { PERMISSIONS } from '@/lib/permission-codes'
import { formatDisplayDateTime } from '@/lib/dateTime'
import { getWaybillsApi, setWaybillTrackingApi, retryWaybillApi, voidWaybillApi } from '@/api/logistics'
import { ApiClientError } from '@/api/client'
import type { LogisticsWaybill } from '@/types/logistics'
import type { TableColumn } from '@/types'
import WaybillQueryDialog, { type WaybillQueryValues } from './WaybillQueryDialog'
import { WAYBILL_STATUS_OPTIONS } from './constants'
import { todayYmd } from '@/lib/dateTime'

function fmtMoney(v: number | null): string {
  return v == null ? '—' : Number(v).toFixed(2)
}

export default function LogisticsPage() {
  const nav = useNavigate()
  const qc = useQueryClient()
  const { can } = usePermission()
  const canView = can(PERMISSIONS.LOGISTICS_VIEW)
  const canManage = can(PERMISSIONS.LOGISTICS_MANAGE)
  const canViewCarriers = can(PERMISSIONS.CARRIER_VIEW)

  const [applied, setApplied] = useState<{ keyword: string; status: string; carrierId: number | null; startDate: string; endDate: string }>({ keyword: '', status: 'all', carrierId: null, startDate: todayYmd(), endDate: todayYmd() })
  const [trackTarget, setTrackTarget] = useState<LogisticsWaybill | null>(null)
  const [trackingInput, setTrackingInput] = useState('')
  const [queryOpen, setQueryOpen] = useState(false)
  const filters = {
    keyword: applied.keyword || undefined,
    status: applied.status === 'all' ? undefined : applied.status,
    carrierId: applied.carrierId ?? undefined,
    startDate: applied.startDate || undefined,
    endDate: applied.endDate || undefined,
  }
  const exportParams = Object.fromEntries(
    Object.entries(filters).flatMap(([key, value]) => value === undefined ? [] : [[key, String(value)]]),
  )

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['waybills', applied],
    enabled: canView,
    queryFn: () => getWaybillsApi({
      page: 1,
      pageSize: 500,
      ...filters,
    }),
  })
  const denied = !canView || (error instanceof ApiClientError && error.status === 403)
  // 查询弹窗和筛选标签共用承运商选项，运单查看权限不代表承运商查看权限。
  const { data: carriers } = useCarriersActive(undefined, () => !denied && canViewCarriers)
  const carrierMap = useMemo(() => new Map(carriers?.map(c => [c.id, c.name])), [carriers])
  const list = data?.list ?? []

  function invalidate() { qc.invalidateQueries({ queryKey: ['waybills'] }) }

  const trackMut = useMutation({
    mutationFn: () => setWaybillTrackingApi(trackTarget!.id, trackingInput.trim(), { skipGlobalError: true }),
    onSuccess: () => { toast.success('已录入快递单号'); invalidate(); setTrackTarget(null); setTrackingInput('') },
    onError: (e: unknown) => toast.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? '录入失败'),
  })
  const retryMut = useMutation({
    mutationFn: (id: number) => retryWaybillApi(id, { skipGlobalError: true }),
    onSuccess: () => { toast.success('已提交处理；已发送的平台订单仅查询原单'); invalidate() },
    onError: (e: unknown) => toast.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? '操作失败'),
  })
  const voidMut = useMutation({
    mutationFn: (id: number) => voidWaybillApi(id, undefined, { skipGlobalError: true }),
    onSuccess: () => { toast.success('运单本地记录已作废'); invalidate() },
    onError: (e: unknown) => toast.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? '操作失败'),
  })

  function reset() { setApplied({ keyword: '', status: 'all', carrierId: null, startDate: '', endDate: '' }) }

  // ── 查询弹窗筛选值 ──
  const initialQuery = useMemo<WaybillQueryValues>(() => ({
    keyword: applied.keyword, status: applied.status === 'all' ? '' : applied.status,
    carrierId: applied.carrierId, startDate: applied.startDate, endDate: applied.endDate,
  }), [applied.keyword, applied.status, applied.carrierId, applied.startDate, applied.endDate])
  function applyQuery(v: WaybillQueryValues) {
    setApplied({ keyword: v.keyword, status: v.status || 'all', carrierId: v.carrierId, startDate: v.startDate, endDate: v.endDate })
    setQueryOpen(false)
  }
  function clearAll() { reset() }
  function clearDateRange() { setApplied(current => ({ ...current, startDate: '', endDate: '' })) }

  const chips = [
    applied.keyword && { key: 'keyword', label: `关键字：${applied.keyword}`, onRemove: () => setApplied({ ...applied, keyword: '' }) },
    applied.status !== 'all' && { key: 'status', label: `状态：${WAYBILL_STATUS_OPTIONS.find(o => o.value === applied.status)?.label ?? applied.status}`, onRemove: () => setApplied({ ...applied, status: 'all' }) },
    applied.carrierId && { key: 'carrier', label: `承运商：${carrierMap.get(applied.carrierId) ?? applied.carrierId}`, onRemove: () => setApplied({ ...applied, carrierId: null }) },
  ].filter(Boolean) as { key: string; label: string; onRemove: () => void }[]

  const columns: TableColumn<LogisticsWaybill>[] = [
    { key: 'waybillNo', title: '运单 / 创建时间', width: 230, render: (_, row) => <RecordIdentity title={row.waybillNo} detail={formatDisplayDateTime(row.createdAt)} /> },
    { key: 'trackingNo', title: '快递单号 / 承运商', width: 250, render: (_, row) => <RecordIdentity title={row.trackingNo || '未录入快递单号'} detail={row.carrierName || '未指定承运商'} /> },
    { key: 'saleOrderNo', title: '销售单', width: 140, render: v => v ? String(v) : <span className="text-muted-foreground">—</span> },
    { key: 'receiverName', title: '收件人', width: 100, render: v => (v as string | null) ?? <span className="text-muted-foreground">—</span> },
    { key: 'estFreight', title: '预估运费', width: 100, align: 'right', render: v => <span className="tabular-nums text-muted-foreground">{fmtMoney(v as number | null)}</span> },
    { key: 'status', title: '状态', width: 90, render: (_, r) => <SoftStatusLabel label={r.statusLabel} tone={r.statusTone} /> },
    {
      key: 'id', title: '操作', width: 130,
      render: (_, row) => {
        const direct = ['sf', 'deppon'].includes(row.platformCode || '')
        const items = []
        if (canManage && !direct && (row.status === 1 || row.status === 4)) {
          items.push({ label: '手工录入快递单号', onClick: () => { setTrackTarget(row); setTrackingInput(row.trackingNo ?? '') } })
        }
        if (canManage && [4, 6].includes(row.status) && row.platformCode) {
          items.push({ label: row.submittedToPlatform || row.status === 6 ? '查询原单' : '重试取号', onClick: () => retryMut.mutate(row.id) })
        }
        if (canManage && ![2, 5].includes(row.status) && !(direct && (row.submittedToPlatform || [3, 6].includes(row.status)))) {
          items.push({ label: '作废', destructive: true, onClick: () => confirmAction({
            title: '作废运单本地记录', description: `确认作废运单 ${row.waybillNo} 的本地记录？此操作不代表快递官方订单已取消。`, variant: 'destructive', confirmText: '确认作废',
            onConfirm: () => voidMut.mutate(row.id),
          }) })
        }
        return (
          <TableActionsMenu
            primaryLabel="详情"
            primaryVariant="outline"
            onPrimaryClick={() => nav(`/logistics/${row.id}`)}
            items={items}
          />
        )
      },
    },
  ]

  const description = '核对包裹运单、取号与物流状态。'
  if (denied) {
    return (
      <div className="space-y-4">
        <PageHeader title="物流运单" description={description} />
        <EmptyState variant="no-permission" description="当前账号无权查看物流运单。" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="物流运单"
        description={description}
        actions={
          <>
            <Button variant="outline" onClick={() => downloadExport('/export/waybills', exportParams).catch(e => toast.error((e as Error).message))}>导出</Button>
            <Button variant="outline" onClick={() => setQueryOpen(true)}>查询</Button>
            <Button variant="outline" onClick={() => refetch()}>刷新</Button>
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <AppliedDateRange label="创建日期" startDate={applied.startDate} endDate={applied.endDate} onClear={clearDateRange} />
        {chips.map(c => (
          <span key={c.key} className="inline-flex items-center gap-1 rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">
            {c.label}
            <button type="button" onClick={c.onRemove} className="text-muted-foreground/70 hover:text-foreground" aria-label={`移除「${c.label}」`}>
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        {(chips.length > 0 || applied.startDate || applied.endDate) && <Button size="sm" variant="ghost" onClick={clearAll}>清空</Button>}
      </div>

      {isError ? (
        <QueryErrorState error={error} onRetry={() => void refetch()} title="运单加载失败" compact />
      ) : (
        <>
          <DataTable
            columns={columns}
            data={list}
            loading={isLoading}
            rowKey="id"
            emptyText={chips.length || applied.startDate || applied.endDate ? '没有符合条件的运单' : '暂无运单'}
          />
          {data && <ListSummary total={data.pagination?.total ?? list.length} unit="张运单" />}
        </>
      )}

      <Dialog open={!!trackTarget} onOpenChange={v => { if (!v) { setTrackTarget(null); setTrackingInput('') } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader description={<>{<>运单 {trackTarget?.waybillNo}｜{trackTarget?.carrierName ?? '未指定承运商'}</>}</>}><DialogTitle>录入快递单号</DialogTitle></DialogHeader>
          <div className="space-y-4 py-3">

            <div>
              <Label htmlFor="logistics-tracking-number">快递单号</Label>
              <Input id="logistics-tracking-number" className="mt-2 font-mono" placeholder="输入承运商快递单号" value={trackingInput} onChange={e => setTrackingInput(e.target.value)} autoFocus />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setTrackTarget(null); setTrackingInput('') }}>取消</Button>
            <Button disabled={!trackingInput.trim() || trackMut.isPending} onClick={() => trackMut.mutate()}>保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <WaybillQueryDialog
        carriers={canViewCarriers ? carriers ?? [] : undefined}
        open={queryOpen}
        initial={initialQuery}
        resetValues={{ startDate: todayYmd(), endDate: todayYmd() }}
        onClose={() => setQueryOpen(false)}
        onApply={applyQuery}
      />
    </div>
  )
}
