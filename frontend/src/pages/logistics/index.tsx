/**
 * 物流运单列表页
 * 路由：/logistics
 */
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { toast } from '@/lib/toast'
import { confirmAction } from '@/lib/confirm'
import PageHeader from '@/components/shared/PageHeader'
import DataTable from '@/components/shared/DataTable'
import { QueryErrorState } from '@/components/shared/QueryErrorState'
import TableActionsMenu from '@/components/shared/TableActionsMenu'
import { SoftStatusLabel } from '@/components/shared/StatusBadge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { usePermission } from '@/hooks/usePermission'
import { PERMISSIONS } from '@/lib/permission-codes'
import { formatDisplayDateTime } from '@/lib/dateTime'
import { getWaybillsApi, setWaybillTrackingApi, retryWaybillApi, voidWaybillApi } from '@/api/logistics'
import type { LogisticsWaybill } from '@/types/logistics'
import type { TableColumn } from '@/types'
import WaybillQueryDialog, { type WaybillQueryValues } from './WaybillQueryDialog'
import { WAYBILL_STATUS_OPTIONS } from './constants'

function fmtMoney(v: number | null): string {
  return v == null ? '—' : Number(v).toFixed(2)
}

export default function LogisticsPage() {
  const nav = useNavigate()
  const qc = useQueryClient()
  const { can } = usePermission()
  const canManage = can(PERMISSIONS.LOGISTICS_MANAGE)

  const [applied, setApplied] = useState<{ keyword: string; status: string; carrierId: number | null; startDate: string; endDate: string }>({ keyword: '', status: 'all', carrierId: null, startDate: '', endDate: '' })
  const [trackTarget, setTrackTarget] = useState<LogisticsWaybill | null>(null)
  const [trackingInput, setTrackingInput] = useState('')
  const [queryOpen, setQueryOpen] = useState(false)

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['waybills', applied],
    queryFn: () => getWaybillsApi({
      page: 1,
      pageSize: 500,
      keyword: applied.keyword || undefined,
      status: applied.status === 'all' ? undefined : applied.status,
      carrierId: applied.carrierId ?? undefined,
      startDate: applied.startDate || undefined,
      endDate: applied.endDate || undefined,
    }),
  })
  const list = data?.list ?? []

  function invalidate() { qc.invalidateQueries({ queryKey: ['waybills'] }) }

  const trackMut = useMutation({
    mutationFn: () => setWaybillTrackingApi(trackTarget!.id, trackingInput.trim(), { skipGlobalError: true }),
    onSuccess: () => { toast.success('已录入快递单号'); invalidate(); setTrackTarget(null); setTrackingInput('') },
    onError: (e: unknown) => toast.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? '录入失败'),
  })
  const retryMut = useMutation({
    mutationFn: (id: number) => retryWaybillApi(id, { skipGlobalError: true }),
    onSuccess: () => { toast.success('已重新提交取号'); invalidate() },
    onError: (e: unknown) => toast.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? '操作失败'),
  })
  const voidMut = useMutation({
    mutationFn: (id: number) => voidWaybillApi(id, undefined, { skipGlobalError: true }),
    onSuccess: () => { toast.success('运单已作废'); invalidate() },
    onError: (e: unknown) => toast.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? '操作失败'),
  })

  function reset() { setApplied({ keyword: '', status: 'all', carrierId: null, startDate: '', endDate: '' }) }

  // ── 查询弹窗筛选值 ──
  const initialQuery: WaybillQueryValues = {
    keyword: applied.keyword, status: applied.status === 'all' ? '' : applied.status,
    carrierId: applied.carrierId, startDate: applied.startDate, endDate: applied.endDate,
  }
  function applyQuery(v: WaybillQueryValues) {
    setApplied({ keyword: v.keyword, status: v.status || 'all', carrierId: v.carrierId, startDate: v.startDate, endDate: v.endDate })
    setQueryOpen(false)
  }
  function clearAll() { reset() }

  const chips = [
    applied.keyword && { key: 'keyword', label: `关键字：${applied.keyword}`, onRemove: () => setApplied({ ...applied, keyword: '' }) },
    applied.status !== 'all' && { key: 'status', label: `状态：${WAYBILL_STATUS_OPTIONS.find(o => o.value === applied.status)?.label ?? applied.status}`, onRemove: () => setApplied({ ...applied, status: 'all' }) },
    applied.carrierId && { key: 'carrier', label: `承运商：${applied.carrierId}`, onRemove: () => setApplied({ ...applied, carrierId: null }) },
  ].filter(Boolean) as { key: string; label: string; onRemove: () => void }[]

  const columns: TableColumn<LogisticsWaybill>[] = [
    { key: 'waybillNo', title: '运单号', width: 150, render: v => <span className="text-doc-code">{String(v)}</span> },
    { key: 'trackingNo', title: '快递单号', width: 160, render: v => v ? <span className="text-doc-code">{String(v)}</span> : <span className="text-muted-foreground">—</span> },
    { key: 'saleOrderNo', title: '销售单', width: 140, render: v => v ? String(v) : <span className="text-muted-foreground">—</span> },
    { key: 'carrierName', title: '承运商', width: 110, render: v => (v as string | null) ?? <span className="text-muted-foreground">—</span> },
    { key: 'receiverName', title: '收件人', width: 100, render: v => (v as string | null) ?? <span className="text-muted-foreground">—</span> },
    { key: 'estFreight', title: '预估运费', width: 100, align: 'right', render: v => <span className="tabular-nums text-muted-foreground">{fmtMoney(v as number | null)}</span> },
    { key: 'status', title: '状态', width: 90, render: (_, r) => <SoftStatusLabel label={r.statusLabel} tone={r.statusTone} /> },
    { key: 'createdAt', title: '创建时间', width: 150, render: v => <span className="text-sm text-muted-foreground">{formatDisplayDateTime(String(v))}</span> },
    {
      key: 'id', title: '操作', width: 130,
      render: (_, row) => {
        const items = []
        if (canManage && (row.status === 1 || row.status === 4)) {
          items.push({ label: '手工录号', onClick: () => { setTrackTarget(row); setTrackingInput(row.trackingNo ?? '') } })
        }
        if (canManage && row.status === 4 && row.platformCode) {
          items.push({ label: '重试取号', onClick: () => retryMut.mutate(row.id) })
        }
        if (canManage && row.status !== 5) {
          items.push({ label: '作废', destructive: true, onClick: () => confirmAction({
            title: '作废运单', description: `确认作废运单 ${row.waybillNo}？`, variant: 'destructive', confirmText: '确认作废',
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

  return (
    <div className="space-y-4">
      <PageHeader
        title="物流运单"
        description="发出的每个包裹一张运单：指定承运商并开通电子面单后，打包完成自动生成待取号运单，取号成功回写快递单号并打印面单。未对接平台时可手工录快递单号。"
        actions={
          <>
            <Button variant="outline" onClick={() => setQueryOpen(true)}>查询</Button>
            <Button variant="outline" onClick={() => refetch()}>刷新</Button>
          </>
        }
      />

      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {chips.map(c => (
            <span key={c.key} className="inline-flex items-center gap-1 rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">
              {c.label}
              <button type="button" onClick={c.onRemove} className="text-muted-foreground/70 hover:text-foreground" aria-label={`移除筛选 ${c.label}`}>
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
          <Button size="sm" variant="ghost" onClick={clearAll}>清空</Button>
        </div>
      )}

      {isError && !data ? (
        <QueryErrorState error={error} onRetry={() => void refetch()} title="运单加载失败" compact />
      ) : (
        <DataTable
          columns={columns}
          data={list}
          loading={isLoading}
          rowKey="id"
          emptyText="暂无运单（给销售单指定承运商、打包完成后会自动生成运单）"
        />
      )}

      <Dialog open={!!trackTarget} onOpenChange={v => { if (!v) { setTrackTarget(null); setTrackingInput('') } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>手工录快递单号</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">运单 {trackTarget?.waybillNo}｜{trackTarget?.carrierName ?? '未指定承运商'}</p>
            <div>
              <Label>快递单号</Label>
              <Input className="mt-1" placeholder="输入承运商快递单号" value={trackingInput} onChange={e => setTrackingInput(e.target.value)} autoFocus />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setTrackTarget(null); setTrackingInput('') }}>取消</Button>
            <Button disabled={!trackingInput.trim() || trackMut.isPending} onClick={() => trackMut.mutate()}>保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <WaybillQueryDialog
        open={queryOpen}
        initial={initialQuery}
        onClose={() => setQueryOpen(false)}
        onApply={applyQuery}
      />
    </div>
  )
}
