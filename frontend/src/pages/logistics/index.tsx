/**
 * 物流运单列表页
 * 路由：/logistics
 */
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from '@/lib/toast'
import { confirmAction } from '@/lib/confirm'
import PageHeader from '@/components/shared/PageHeader'
import DataTable from '@/components/shared/DataTable'
import { FilterCard } from '@/components/shared/FilterCard'
import { QueryErrorState } from '@/components/shared/QueryErrorState'
import TableActionsMenu from '@/components/shared/TableActionsMenu'
import { SoftStatusLabel } from '@/components/shared/StatusBadge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { usePermission } from '@/hooks/usePermission'
import { PERMISSIONS } from '@/lib/permission-codes'
import { formatDisplayDateTime } from '@/lib/dateTime'
import { getWaybillsApi, setWaybillTrackingApi, retryWaybillApi, voidWaybillApi } from '@/api/logistics'
import type { LogisticsWaybill } from '@/types/logistics'
import type { TableColumn } from '@/types'

const STATUS_OPTIONS = [
  { value: 'all', label: '全部状态' },
  { value: '1', label: '待取号' },
  { value: '2', label: '取号中' },
  { value: '3', label: '已取号' },
  { value: '4', label: '取号失败' },
  { value: '5', label: '已作废' },
]

function fmtMoney(v: number | null): string {
  return v == null ? '—' : Number(v).toFixed(2)
}

export default function LogisticsPage() {
  const nav = useNavigate()
  const qc = useQueryClient()
  const { can } = usePermission()
  const canManage = can(PERMISSIONS.LOGISTICS_MANAGE)

  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('all')
  const [applied, setApplied] = useState<{ keyword: string; status: string }>({ keyword: '', status: 'all' })
  const [trackTarget, setTrackTarget] = useState<LogisticsWaybill | null>(null)
  const [trackingInput, setTrackingInput] = useState('')

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['waybills', applied],
    queryFn: () => getWaybillsApi({
      page: 1,
      pageSize: 500,
      keyword: applied.keyword || undefined,
      status: applied.status === 'all' ? undefined : applied.status,
    }),
  })
  const list = data?.list ?? []
  const total = data?.pagination?.total ?? 0

  function invalidate() { qc.invalidateQueries({ queryKey: ['waybills'] }) }

  const trackMut = useMutation({
    mutationFn: () => setWaybillTrackingApi(trackTarget!.id, trackingInput.trim()),
    onSuccess: () => { toast.success('已录入快递单号'); invalidate(); setTrackTarget(null); setTrackingInput('') },
    onError: (e: unknown) => toast.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? '录入失败'),
  })
  const retryMut = useMutation({
    mutationFn: (id: number) => retryWaybillApi(id),
    onSuccess: () => { toast.success('已重新提交取号'); invalidate() },
    onError: (e: unknown) => toast.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? '操作失败'),
  })
  const voidMut = useMutation({
    mutationFn: (id: number) => voidWaybillApi(id),
    onSuccess: () => { toast.success('运单已作废'); invalidate() },
    onError: (e: unknown) => toast.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? '操作失败'),
  })

  function apply() { setApplied({ keyword: search, status }) }
  function reset() { setSearch(''); setStatus('all'); setApplied({ keyword: '', status: 'all' }) }

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
        actions={<Button onClick={() => refetch()}>刷新</Button>}
      />

      <FilterCard>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <Input
              placeholder="运单号 / 快递单号 / 销售单 / 收件人..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && apply()}
              className="w-64"
            />
            <Button variant="outline" onClick={apply}>搜索</Button>
          </div>
          <div className="h-5 w-px bg-border" />
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={apply}>筛选</Button>
          {(applied.keyword || applied.status !== 'all') && (
            <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={reset}>重置</Button>
          )}
          <div className="ml-auto text-sm text-muted-foreground">共 <span className="font-semibold text-foreground">{total}</span> 张运单</div>
        </div>
      </FilterCard>

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
    </div>
  )
}
