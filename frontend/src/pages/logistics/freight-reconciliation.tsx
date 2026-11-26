import { QueryErrorState } from '@/components/shared/QueryErrorState'
import { QueryChips } from '@/components/shared/QueryChips'
import { ListQueryDialog } from '@/components/shared/ListQueryDialog'
import { usePermission } from '@/hooks/usePermission'
import { PERMISSIONS } from '@/lib/permission-codes'
import { useSectionActive } from '@/components/layout/SectionVisibilityContext'
import { EmptyState } from '@/components/shared/EmptyState'
/**
 * 运费对账页（文档 06 · Phase 4）
 * 路由：/logistics/freight-reconciliation
 * 录入承运商运费账单 → 按「承运商 + 账期」汇总生成对承运商的应付（月结，待财务确认）。
 */
import { useId, useMemo, useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from '@/lib/toast'
import { confirmAction } from '@/lib/confirm'
import PageHeader from '@/components/shared/PageHeader'
import DataTable from '@/components/shared/DataTable'
import ListSummary from '@/components/shared/ListSummary'
import { SectionCard } from '@/components/shared/SectionCard'
import { SoftStatusLabel } from '@/components/shared/StatusBadge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { getCarriersActiveApi } from '@/api/carriers'
import { getFreightBillsApi, createFreightBillApi, getFreightSettlementsApi, generateFreightSettlementApi } from '@/api/logistics'
import type { FreightBill, FreightSettlement } from '@/types/logistics'
import type { TableColumn } from '@/types'
import { todayYmd } from '@/lib/dateTime'

function currentPeriod(): string {
  // 当年月按**北京时间**取（此前用宿主本地字段，非 +08 时区会取到上个月）
  return todayYmd().slice(0, 7)
}

export default function FreightReconciliationPage() {
  const { can } = usePermission()
  const active = useSectionActive()
  const allowed = can(PERMISSIONS.LOGISTICS_FREIGHT_RECONCILE)
  const readCarriers = can(PERMISSIONS.CARRIER_VIEW)
  const qc = useQueryClient()
  const filterId = useId()
  const [filters, setFilters] = useState(() => ({ carrierId: '', period: currentPeriod() }))
  const { carrierId, period } = filters
  const [queryOpen, setQueryOpen] = useState(false)
  const [billDialog, setBillDialog] = useState(false)
  const [billForm, setBillForm] = useState({ carrierId: '', trackingNo: '', actualFreight: '', billPeriod: currentPeriod() })

  const carrierQuery = useQuery({ queryKey: ['carriers-active'], queryFn: () => getCarriersActiveApi({ skipGlobalError: true }), enabled: active && allowed && readCarriers })

  const billParams = { carrierId: carrierId || undefined, billPeriod: period || undefined, pageSize: 500 }
  const billsQuery = useQuery({
    enabled: allowed && active,
    queryKey: ['freight-bills', carrierId, period],
    queryFn: () => getFreightBillsApi(billParams),
  })
  const settlementsQuery = useQuery({
    enabled: allowed && active,
    queryKey: ['freight-settlements', carrierId, period],
    queryFn: () => getFreightSettlementsApi({ carrierId: carrierId || undefined, billPeriod: period || undefined, pageSize: 500 }),
  })

  const { data: bills, isLoading: billsLoading } = billsQuery
  const { data: settlements, isLoading: settlementsLoading } = settlementsQuery
  const carrierList = useMemo(() => {
    if (readCarriers) return carrierQuery.data ?? []
    const known = new Map<number, string>()
    for (const row of [...(bills?.list ?? []), ...(settlements?.list ?? [])]) {
      if (row.carrierName) known.set(row.carrierId, row.carrierName)
    }
    return Array.from(known, ([id, name]) => ({ id, name }))
  }, [readCarriers, carrierQuery.data, bills, settlements])
  const ready = active && allowed && billsQuery.isSuccess && settlementsQuery.isSuccess
    && !billsQuery.isPaused && !settlementsQuery.isPaused && (!readCarriers || carrierQuery.isSuccess)
  const readyRef = useRef(ready)
  readyRef.current = ready
  function invalidate() {
    qc.invalidateQueries({ queryKey: ['freight-bills'] })
    qc.invalidateQueries({ queryKey: ['freight-settlements'] })
  }

  const createBillMut = useMutation({
    mutationFn: () => createFreightBillApi({
      carrierId: Number(billForm.carrierId),
      trackingNo: billForm.trackingNo.trim(),
      actualFreight: Number(billForm.actualFreight),
      billPeriod: billForm.billPeriod || undefined,
    }, { skipGlobalError: true }),
    onSuccess: () => { toast.success('已录入运费账单'); invalidate(); setBillDialog(false) },
    onError: (e: unknown) => toast.error(e instanceof Error && e.message ? e.message : '录入失败'),
  })

  const generateMut = useMutation({
    mutationFn: () => generateFreightSettlementApi(Number(carrierId), period, { skipGlobalError: true }),
    onSuccess: (s: FreightSettlement) => { toast.success(`已生成应付：${Number(s.totalFreight).toFixed(2)} 元`); invalidate() },
    onError: (e: unknown) => toast.error(e instanceof Error && e.message ? e.message : '生成失败'),
  })

  const billColumns: TableColumn<FreightBill>[] = [
    { key: 'carrierName', title: '承运商', width: 120, render: v => (v as string | null) ?? '—' },
    { key: 'trackingNo', title: '快递单号', width: 160, render: v => <span className="text-doc-code">{String(v ?? '—')}</span> },
    { key: 'billPeriod', title: '账期', width: 90 },
    { key: 'actualFreight', title: '实际运费', width: 100, align: 'right', render: v => <span className="tabular-nums">{Number(v).toFixed(2)}</span> },
    { key: 'freightType', title: '运费方式', width: 90, render: v => v === 1 ? '寄付' : v === 2 ? '到付' : v === 3 ? '第三方付款' : <span className="text-muted-foreground">—</span> },
    { key: 'reconciled', title: '状态', width: 140, render: (v, row) => {
      if (v && row.freightType !== 1) return <SoftStatusLabel label="历史汇总待核对" tone="draft" />
      if (v) return <SoftStatusLabel label="已核对" tone="success" />
      return <SoftStatusLabel label={row.freightType == null ? '待匹配运单' : row.freightType === 1 ? '待核对' : '不计入应付'} tone="draft" />
    } },
  ]

  const settlementColumns: TableColumn<FreightSettlement>[] = [
    { key: 'settlementNo', title: '汇总单号', width: 150, render: v => <span className="text-doc-code">{String(v)}</span> },
    { key: 'carrierName', title: '承运商', width: 120, render: v => (v as string | null) ?? '—' },
    { key: 'billPeriod', title: '账期', width: 90 },
    { key: 'billCount', title: '账单数', width: 80, align: 'right', render: v => <span className="tabular-nums">{String(v)}</span> },
    { key: 'totalFreight', title: '汇总运费', width: 110, align: 'right', render: v => <span className="tabular-nums font-semibold">{Number(v).toFixed(2)}</span> },
    { key: 'status', title: '状态', width: 100, render: (_, r) => <SoftStatusLabel label={r.statusLabel} tone={r.statusTone} /> },
  ]

  if (!allowed) return <EmptyState variant="no-permission" description="当前账号没有运费对账权限。" />
  const canGenerate = ready && !!carrierId && /^\d{4}-\d{2}$/.test(period)

  return (
    <div className="space-y-4">
      <PageHeader
        title="运费对账"
        description="核对承运商运费账单并生成应付。"
        actions={<>
          <Button variant="outline" onClick={() => setQueryOpen(true)}>查询</Button>
          <Button variant="outline" disabled={!ready || !carrierList.length} onClick={() => { setBillForm({ carrierId: carrierId || '', trackingNo: '', actualFreight: '', billPeriod: period || currentPeriod() }); setBillDialog(true) }}>
            录入账单
          </Button>
          <Button
            disabled={!canGenerate || generateMut.isPending}
            onClick={() => confirmAction({
              title: '生成承运商应付',
              description: `按已匹配的寄付运单生成「${carrierList.find(c => String(c.id) === carrierId)?.name ?? ''}」${period} 的运费应付？未匹配的账单留待核对。`,
              confirmText: '生成应付',
              onConfirm: () => { if (readyRef.current) generateMut.mutate() },
            })}
          >
            生成 / 重算应付
          </Button>
        </>}
      />

      {!readCarriers && <p className="text-sm text-muted-foreground">仅显示已在当前账单或汇总单出现的承运商，新增其他承运商账单需要承运商查看权限。</p>}
      {readCarriers && carrierQuery.isError && <QueryErrorState error={carrierQuery.error} onRetry={carrierQuery.refetch} title="承运商加载失败" />}
      <QueryChips chips={[
        ...(carrierId ? [{ key: 'carrier', text: `承运商：${carrierList.find(c => String(c.id) === carrierId)?.name ?? carrierId}`, onClear: () => setFilters(v => ({ ...v, carrierId: '' })) }] : []),
        ...(period ? [{ key: 'period', text: `账期：${period}`, onClear: () => setFilters(v => ({ ...v, period: '' })) }] : []),
      ]} onClearAll={() => setFilters({ carrierId: '', period: '' })} />
      <ListQueryDialog open={queryOpen} dialogId="freight-reconciliation-query" title="查询运费对账"
        initial={filters} empty={{ carrierId: '', period: '' }} onApply={setFilters} onClose={() => setQueryOpen(false)}>
        {(draft, setDraft) => <>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">承运商</span>
            <Select value={draft.carrierId || 'all'} onValueChange={v => setDraft({ ...draft, carrierId: v === 'all' ? '' : v })}>
              <SelectTrigger id={`${filterId}-carrier`} className="h-9" aria-label="筛选承运商"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部承运商</SelectItem>
                {carrierList.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">账期（YYYY-MM）</span>
            <Input id={`${filterId}-period`} className="h-9" placeholder="2026-07" value={draft.period} onChange={e => setDraft({ ...draft, period: e.target.value })} />
          </label>
        </>}
      </ListQueryDialog>

      <section aria-label="运费账单">
        <SectionCard title="运费账单" noPadding>
          {billsQuery.isError || billsQuery.isPaused ? <QueryErrorState error={billsQuery.error} onRetry={billsQuery.refetch} title={billsQuery.isPaused ? '正在等待网络连接' : '加载失败'} /> : <DataTable fluid virtualized columnStorageKey="freight-bills" scrollLabel="运费账单表格" columns={billColumns} data={bills?.list ?? []} loading={billsLoading} rowKey="id" emptyText="暂无运费账单（点「录入账单」添加，或对接平台回传）" />}
          {billsQuery.isSuccess && !billsQuery.isPaused && bills && (
            <div className="border-t border-border px-4"><ListSummary total={bills.pagination.total} unit="张" /></div>
          )}
        </SectionCard>
      </section>

      <section aria-label="月结汇总单（应付）">
        <SectionCard title="月结汇总单（应付）" noPadding>
          {settlementsQuery.isError || settlementsQuery.isPaused ? <QueryErrorState error={settlementsQuery.error} onRetry={settlementsQuery.refetch} title={settlementsQuery.isPaused ? '正在等待网络连接' : '加载失败'} /> : <DataTable fluid virtualized columnStorageKey="freight-settlements" scrollLabel="运费汇总表格" columns={settlementColumns} data={settlements?.list ?? []} loading={settlementsLoading} rowKey="id" emptyText="暂无汇总单（选承运商 + 账期后「生成应付」）" />}
          {settlementsQuery.isSuccess && !settlementsQuery.isPaused && settlements && (
            <div className="border-t border-border px-4"><ListSummary total={settlements.pagination.total} unit="单" /></div>
          )}
        </SectionCard>
      </section>

      <Dialog open={allowed && billDialog} onOpenChange={v => !v && setBillDialog(false)}>
        <DialogContent className="fc-form-dialog max-w-xl">
          <DialogHeader><DialogTitle>录入运费账单</DialogTitle></DialogHeader>
          <div className="fc-form-dialog-body space-y-3 py-2">
            <div>
              <Label>承运商</Label>
              <Select value={billForm.carrierId} onValueChange={v => setBillForm(f => ({ ...f, carrierId: v }))}>
                <SelectTrigger className="mt-1" aria-label="导入账单承运商"><SelectValue placeholder="选择承运商" /></SelectTrigger>
                <SelectContent>
                  {carrierList.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div><Label>快递单号</Label><Input className="mt-1" placeholder="快递单号（自动关联运单）" value={billForm.trackingNo} onChange={e => setBillForm(f => ({ ...f, trackingNo: e.target.value }))} /></div>
            <div><Label>实际运费</Label><Input className="mt-1" type="number" placeholder="0.00" value={billForm.actualFreight} onChange={e => setBillForm(f => ({ ...f, actualFreight: e.target.value }))} /></div>
            <div><Label>账期（YYYY-MM）</Label><Input className="mt-1" placeholder="2026-07" value={billForm.billPeriod} onChange={e => setBillForm(f => ({ ...f, billPeriod: e.target.value }))} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBillDialog(false)}>取消</Button>
            <Button
              disabled={!ready || !billForm.carrierId || !billForm.trackingNo.trim() || !billForm.actualFreight || createBillMut.isPending}
              onClick={() => { if (readyRef.current) createBillMut.mutate() }}
            >录入</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
