/**
 * 运费对账页（文档 06 · Phase 4）
 * 路由：/logistics/freight-reconciliation
 * 录入承运商运费账单 → 按「承运商 + 账期」汇总生成对承运商的应付（月结，待财务确认）。
 */
import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from '@/lib/toast'
import { confirmAction } from '@/lib/confirm'
import PageHeader from '@/components/shared/PageHeader'
import DataTable from '@/components/shared/DataTable'
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

function currentPeriod(): string {
  // 不用 new Date() 之外的能力；页面运行期取当前年月
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export default function FreightReconciliationPage() {
  const qc = useQueryClient()
  const [carrierId, setCarrierId] = useState<string>('')
  const [period, setPeriod] = useState<string>(currentPeriod())
  const [billDialog, setBillDialog] = useState(false)
  const [billForm, setBillForm] = useState({ carrierId: '', trackingNo: '', actualFreight: '', billPeriod: currentPeriod() })

  const { data: carriers } = useQuery({ queryKey: ['carriers-active'], queryFn: () => getCarriersActiveApi() })
  const carrierList = useMemo(() => carriers ?? [], [carriers])

  const billParams = { carrierId: carrierId || undefined, billPeriod: period || undefined, pageSize: 500 }
  const { data: bills, isLoading: billsLoading } = useQuery({
    queryKey: ['freight-bills', carrierId, period],
    queryFn: () => getFreightBillsApi(billParams),
  })
  const { data: settlements, isLoading: settlementsLoading } = useQuery({
    queryKey: ['freight-settlements', carrierId, period],
    queryFn: () => getFreightSettlementsApi({ carrierId: carrierId || undefined, billPeriod: period || undefined, pageSize: 500 }),
  })

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
    onError: (e: unknown) => toast.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? '录入失败'),
  })

  const generateMut = useMutation({
    mutationFn: () => generateFreightSettlementApi(Number(carrierId), period, { skipGlobalError: true }),
    onSuccess: (s: FreightSettlement) => { toast.success(`已生成应付：${Number(s.totalFreight).toFixed(2)} 元`); invalidate() },
    onError: (e: unknown) => toast.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? '生成失败'),
  })

  const billColumns: TableColumn<FreightBill>[] = [
    { key: 'carrierName', title: '承运商', width: 120, render: v => (v as string | null) ?? '—' },
    { key: 'trackingNo', title: '快递单号', width: 160, render: v => <span className="text-doc-code">{String(v ?? '—')}</span> },
    { key: 'billPeriod', title: '账期', width: 90 },
    { key: 'actualFreight', title: '实际运费', width: 100, align: 'right', render: v => <span className="tabular-nums">{Number(v).toFixed(2)}</span> },
    { key: 'freightType', title: '运费方式', width: 90, render: v => v === 1 ? '寄付' : v === 2 ? '到付' : v === 3 ? '第三方付款' : <span className="text-muted-foreground">—</span> },
    { key: 'reconciled', title: '状态', width: 90, render: v => <SoftStatusLabel label={v ? '已核对' : '待核对'} tone={v ? 'success' : 'draft'} /> },
  ]

  const settlementColumns: TableColumn<FreightSettlement>[] = [
    { key: 'settlementNo', title: '汇总单号', width: 150, render: v => <span className="text-doc-code">{String(v)}</span> },
    { key: 'carrierName', title: '承运商', width: 120, render: v => (v as string | null) ?? '—' },
    { key: 'billPeriod', title: '账期', width: 90 },
    { key: 'billCount', title: '账单数', width: 80, align: 'right', render: v => <span className="tabular-nums">{String(v)}</span> },
    { key: 'totalFreight', title: '汇总运费', width: 110, align: 'right', render: v => <span className="tabular-nums font-semibold">{Number(v).toFixed(2)}</span> },
    { key: 'status', title: '状态', width: 100, render: (_, r) => <SoftStatusLabel label={r.statusLabel} tone={r.statusTone} /> },
  ]

  const canGenerate = !!carrierId && /^\d{4}-\d{2}$/.test(period)

  return (
    <div className="space-y-4">
      <PageHeader
        title="运费对账"
        description="录入承运商回传的运费账单，按「承运商 + 账期」汇总生成对承运商的应付（仅寄付计入，月结，需财务确认后付款）。"
      />

      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-card p-4">
        <div>
          <Label className="text-xs text-muted-foreground">承运商</Label>
          <Select value={carrierId || 'all'} onValueChange={v => setCarrierId(v === 'all' ? '' : v)}>
            <SelectTrigger className="mt-1 w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部承运商</SelectItem>
              {carrierList.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">账期（YYYY-MM）</Label>
          <Input className="mt-1 w-32" placeholder="2026-07" value={period} onChange={e => setPeriod(e.target.value)} />
        </div>
        <Button variant="outline" onClick={() => { setBillForm({ carrierId: carrierId || '', trackingNo: '', actualFreight: '', billPeriod: period || currentPeriod() }); setBillDialog(true) }}>
          录入账单
        </Button>
        <Button
          disabled={!canGenerate || generateMut.isPending}
          onClick={() => confirmAction({
            title: '生成承运商应付',
            description: `按当前账单汇总生成「${carrierList.find(c => String(c.id) === carrierId)?.name ?? ''}」${period} 的运费应付？重复生成为全量重算，不会重复计账。`,
            confirmText: '生成应付',
            onConfirm: () => generateMut.mutate(),
          })}
        >
          生成 / 重算应付
        </Button>
        {!canGenerate && <span className="text-xs text-muted-foreground">选择承运商并填写账期后，可生成应付</span>}
      </div>

      <SectionCard title="运费账单" noPadding>
        <DataTable columns={billColumns} data={bills?.list ?? []} loading={billsLoading} rowKey="id" emptyText="暂无运费账单（点「录入账单」添加，或对接平台回传）" />
      </SectionCard>

      <SectionCard title="月结汇总单（应付）" noPadding>
        <DataTable columns={settlementColumns} data={settlements?.list ?? []} loading={settlementsLoading} rowKey="id" emptyText="暂无汇总单（选承运商 + 账期后「生成应付」）" />
      </SectionCard>

      <Dialog open={billDialog} onOpenChange={v => !v && setBillDialog(false)}>
        <DialogContent className="max-w-xl">
          <DialogHeader><DialogTitle>录入运费账单</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label>承运商</Label>
              <Select value={billForm.carrierId} onValueChange={v => setBillForm(f => ({ ...f, carrierId: v }))}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="选择承运商" /></SelectTrigger>
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
              disabled={!billForm.carrierId || !billForm.trackingNo.trim() || !billForm.actualFreight || createBillMut.isPending}
              onClick={() => createBillMut.mutate()}
            >录入</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
