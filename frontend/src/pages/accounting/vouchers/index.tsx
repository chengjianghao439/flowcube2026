/**
 * 记账凭证（文档 10 · Phase 1）
 *
 * 凭证由 voucher-engine 从既有业务事实全量重算生成（幂等、借贷平衡、只读业务表）。本页提供：
 * 列表筛选/分页、详情（借贷分录）、一键「生成本期凭证」、导出（通用/金蝶）、手工凭证录入、红字冲销。
 * 前端不复制任何会计规则（借贷方向/金额/勾稽一律以接口为准）。
 */

import { useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { Plus, RefreshCw, Download, FileText, Undo2, Trash2, CheckCircle2, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/dropdown-menu'
import PageHeader from '@/components/shared/PageHeader'
import DataTable from '@/components/shared/DataTable'
import { SoftStatusLabel } from '@/components/shared/StatusBadge'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { cn } from '@/lib/utils'
import { toast } from '@/lib/toast'
import { todayYmd } from '@/lib/dateTime'
import { downloadExport } from '@/lib/exportDownload'
import { usePermission } from '@/hooks/usePermission'
import { PERMISSIONS } from '@/lib/permission-codes'
import {
  useVouchers, useVoucher, useReconciliation,
  useGenerateVouchers, useCreateManualVoucher, useReverseVoucher, useDeleteVoucher,
} from '@/hooks/useVouchers'
import { useAccountFlat } from '@/hooks/useAccounts'
import type { TableColumn } from '@/types'
import {
  VOUCHER_STATUS_LABELS, VOUCHER_SOURCE_OPTIONS,
  type Voucher, type ManualEntryInput,
} from '@/types/accounting'
import VoucherQueryDialog, { type VoucherQueryValues } from './VoucherQueryDialog'

const PAGE_SIZE = 20
const fmtMoney = (n: number | null | undefined) =>
  (Number(n) || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtDate = (v: string) => (v ? String(v).slice(0, 10) : '')
const currentPeriod = () => { const d = new Date(); return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}` }
const statusTone = (s: number) => (s === 3 ? 'danger' : s === 2 ? 'active' : 'success')

// ─── 勾稽对账卡片 ─────────────────────────────────────────────────────────────
function ReconciliationCard() {
  const { data } = useReconciliation()
  const items = data?.items ?? []
  if (!items.length) return null
  return (
    <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
      {items.map(it => (
        <div key={it.name} className={cn('card-base p-3', !it.matched && 'border-warning/40')}>
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">{it.name}</span>
            {it.matched
              ? <SoftStatusLabel label="勾稽一致" tone="success" />
              : <SoftStatusLabel label="有差异" tone="warning" />}
          </div>
          <div className="mt-2 flex items-center gap-2 text-sm">
            {it.matched
              ? <CheckCircle2 className="h-4 w-4 text-success" />
              : <AlertTriangle className="h-4 w-4 text-warning" />}
            <span className="tabular-nums">凭证 {fmtMoney(it.voucher)}</span>
            <span className="text-muted-foreground">/ 业务 {fmtMoney(it.business)}</span>
            {!it.matched && <span className="text-warning tabular-nums">差 {fmtMoney(it.diff)}</span>}
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── 生成本期凭证弹窗 ─────────────────────────────────────────────────────────
function GenerateDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [period, setPeriod] = useState(currentPeriod())
  const [allPeriods, setAllPeriods] = useState(false)
  const { mutate: gen, isPending } = useGenerateVouchers()
  function submit() {
    gen(allPeriods ? null : period, {
      onSuccess: (s) => {
        toast.success(`生成完成：新增 ${s.created} · 更新 ${s.updated} · 未变 ${s.unchanged}`)
        onClose()
      },
    })
  }
  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>生成本期凭证</DialogTitle></DialogHeader>
        <div className="space-y-4 py-1">
          <p className="text-xs text-muted-foreground">
            从采购结算/销售收入成本/收付款/费用报销/退货/盘点等业务事实全量重算生成凭证。可反复执行，重复生成不会产生多余凭证。
          </p>
          <div className="space-y-1.5">
            <Label>会计期间（YYYYMM）</Label>
            <Input value={period} onChange={e => setPeriod(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="如 202608" disabled={isPending || allPeriods} className="font-mono" />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={allPeriods} onChange={e => setAllPeriods(e.target.checked)} className="accent-primary" disabled={isPending} />
            生成/重算全部期间
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isPending}>取消</Button>
          <Button onClick={submit} disabled={isPending || (!allPeriods && period.length !== 6)}>
            {isPending ? '生成中…' : '开始生成'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── 凭证详情弹窗 ─────────────────────────────────────────────────────────────
function DetailDialog({ id, onClose }: { id: number | null; onClose: () => void }) {
  const { data: v, isLoading } = useVoucher(id)
  return (
    <Dialog open={!!id} onOpenChange={o => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            凭证 {v?.voucherNo}
            {v && <SoftStatusLabel label={VOUCHER_STATUS_LABELS[v.status]} tone={statusTone(v.status)} />}
            {v?.isReversal === 1 && <SoftStatusLabel label="红字" tone="danger" />}
          </DialogTitle>
        </DialogHeader>
        {isLoading || !v ? (
          <div className="py-10 text-center text-sm text-muted-foreground">加载中…</div>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
              <div><span className="text-muted-foreground">日期：</span>{fmtDate(v.voucherDate)}</div>
              <div><span className="text-muted-foreground">来源：</span>{v.sourceTypeName}</div>
              <div className="col-span-2"><span className="text-muted-foreground">来源单号：</span>{v.sourceNo || '—'}</div>
              <div className="col-span-2 sm:col-span-4"><span className="text-muted-foreground">摘要：</span>{v.summary || '—'}</div>
            </div>
            <div className="overflow-x-auto rounded-lg border border-border/60">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">摘要</th>
                    <th className="px-3 py-2 text-left font-medium">科目</th>
                    <th className="px-3 py-2 text-left font-medium">往来</th>
                    <th className="px-3 py-2 text-right font-medium">借方</th>
                    <th className="px-3 py-2 text-right font-medium">贷方</th>
                  </tr>
                </thead>
                <tbody>
                  {v.entries?.map(e => (
                    <tr key={e.id} className="border-t border-border/40">
                      <td className="px-3 py-2">{e.summary || '—'}</td>
                      <td className="px-3 py-2"><span className="font-mono text-doc-code-muted">{e.accountCode}</span> {e.accountName}</td>
                      <td className="px-3 py-2 text-muted-foreground">{e.auxName || '—'}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{e.direction === 1 ? fmtMoney(e.amount) : ''}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{e.direction === 2 ? fmtMoney(e.amount) : ''}</td>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-border bg-muted/20 font-medium">
                    <td className="px-3 py-2" colSpan={3}>合计</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(v.totalDebit)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(v.totalCredit)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ─── 手工凭证录入弹窗 ─────────────────────────────────────────────────────────
type Row = { accountId: number | null; direction: number; amount: string; summary: string }
const emptyRow = (direction = 1): Row => ({ accountId: null, direction, amount: '', summary: '' })

function ManualDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data: accounts = [] } = useAccountFlat({ onlyLeaf: true, onlyActive: true })
  const { mutate: create, isPending } = useCreateManualVoucher()
  const [voucherDate, setVoucherDate] = useState(() => todayYmd())
  const [summary, setSummary] = useState('')
  const [rows, setRows] = useState<Row[]>([emptyRow(1), emptyRow(2)])

  function reset() {
    setVoucherDate(todayYmd()); setSummary(''); setRows([emptyRow(1), emptyRow(2)])
  }
  function setRow(i: number, patch: Partial<Row>) { setRows(rs => rs.map((r, idx) => idx === i ? { ...r, ...patch } : r)) }

  const debit = rows.filter(r => r.direction === 1).reduce((s, r) => s + (Number(r.amount) || 0), 0)
  const credit = rows.filter(r => r.direction === 2).reduce((s, r) => s + (Number(r.amount) || 0), 0)
  const balanced = Math.abs(debit - credit) < 0.005 && debit > 0
  const complete = rows.every(r => r.accountId && Number(r.amount) > 0)

  function submit() {
    const entries: ManualEntryInput[] = rows.map(r => ({
      accountId: r.accountId as number, direction: r.direction, amount: Number(r.amount), summary: r.summary || null,
    }))
    create({ voucherDate, summary: summary || null, entries }, {
      onSuccess: (res) => { toast.success(`手工凭证 ${res.voucherNo} 已创建`); reset(); onClose() },
    })
  }

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader><DialogTitle>手工凭证录入</DialogTitle></DialogHeader>
        <div className="space-y-3 py-1">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>记账日期 *</Label>
              <Input type="date" value={voucherDate} onChange={e => setVoucherDate(e.target.value)} disabled={isPending} />
            </div>
            <div className="space-y-1.5">
              <Label>摘要</Label>
              <Input value={summary} onChange={e => setSummary(e.target.value)} placeholder="整张凭证摘要（选填）" disabled={isPending} />
            </div>
          </div>

          <div className="space-y-2">
            {rows.map((r, i) => (
              <div key={i} className="flex items-center gap-2">
                <Select value={r.accountId ? String(r.accountId) : ''} onValueChange={val => setRow(i, { accountId: Number(val) })} disabled={isPending}>
                  <SelectTrigger className="h-9 flex-1"><SelectValue placeholder="选择科目" /></SelectTrigger>
                  <SelectContent>
                    {accounts.map(a => <SelectItem key={a.id} value={String(a.id)}>{a.code} {a.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={String(r.direction)} onValueChange={val => setRow(i, { direction: Number(val) })} disabled={isPending}>
                  <SelectTrigger className="h-9 w-20"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="1">借</SelectItem><SelectItem value="2">贷</SelectItem></SelectContent>
                </Select>
                <Input type="number" value={r.amount} onChange={e => setRow(i, { amount: e.target.value })}
                  placeholder="金额" className="w-32 text-right tabular-nums" disabled={isPending} />
                <Input value={r.summary} onChange={e => setRow(i, { summary: e.target.value })}
                  placeholder="行摘要" className="w-40" disabled={isPending} />
                <Button variant="ghost" size="sm" className="h-9 w-9 p-0 text-muted-foreground hover:text-destructive"
                  onClick={() => setRows(rs => rs.length > 2 ? rs.filter((_, idx) => idx !== i) : rs)} disabled={isPending || rows.length <= 2}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
            <Button variant="outline" size="sm" onClick={() => setRows(rs => [...rs, emptyRow(rs.length % 2 === 0 ? 1 : 2)])} disabled={isPending}>
              <Plus className="mr-1 h-3.5 w-3.5" />添加分录
            </Button>
          </div>

          <div className="flex items-center justify-end gap-4 rounded-md bg-muted/30 px-3 py-2 text-sm">
            <span>借方合计 <span className="tabular-nums font-medium">{fmtMoney(debit)}</span></span>
            <span>贷方合计 <span className="tabular-nums font-medium">{fmtMoney(credit)}</span></span>
            {balanced
              ? <SoftStatusLabel label="借贷平衡" tone="success" />
              : <SoftStatusLabel label="借贷不平" tone="danger" />}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isPending}>取消</Button>
          <Button onClick={submit} disabled={isPending || !balanced || !complete}>{isPending ? '保存中…' : '保存凭证'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── 主页面 ───────────────────────────────────────────────────────────────────
export default function VouchersPage() {
  const { can } = usePermission()
  const canManage = can(PERMISSIONS.ACCOUNTING_VOUCHER_MANAGE)
  const canExport = can(PERMISSIONS.ACCOUNTING_VOUCHER_EXPORT)

  const [period, setPeriod] = useState('')
  const [sourceType, setSourceType] = useState('')
  const [status, setStatus] = useState('')
  const [keyword, setKeyword] = useState('')
  const [queryOpen, setQueryOpen] = useState(false)
  const [page, setPage] = useState(1)
  const query = useMemo(() => ({
    period: period || undefined, sourceType: sourceType || undefined,
    status: status ? Number(status) : undefined, keyword: keyword || undefined,
    page, pageSize: PAGE_SIZE,
  }), [period, sourceType, status, keyword, page])
  const { data, isLoading } = useVouchers(query)
  const list = data?.list ?? []
  const total = data?.pagination?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  // ── 查询弹窗筛选值 ──
  const initialQuery: VoucherQueryValues = { period, sourceType, status, keyword }
  function applyQuery(v: VoucherQueryValues) {
    setPeriod(v.period)
    setSourceType(v.sourceType)
    setStatus(v.status)
    setKeyword(v.keyword)
    setPage(1)
    setQueryOpen(false)
  }
  function clearAll() { setPeriod(''); setSourceType(''); setStatus(''); setKeyword(''); setPage(1) }

  // 当前生效筛选摘要（可逐项移除）
  const chips = [
    period && { key: 'period', label: `期间：${period}`, onRemove: () => setPeriod('') },
    sourceType && { key: 'sourceType', label: `来源：${VOUCHER_SOURCE_OPTIONS.find(o => o.value === sourceType)?.label ?? sourceType}`, onRemove: () => setSourceType('') },
    status && { key: 'status', label: `状态：${VOUCHER_STATUS_LABELS[Number(status)] ?? status}`, onRemove: () => setStatus('') },
    keyword && { key: 'keyword', label: `关键字：${keyword}`, onRemove: () => setKeyword('') },
  ].filter(Boolean) as { key: string; label: string; onRemove: () => void }[]

  const [genOpen, setGenOpen] = useState(false)
  const [manualOpen, setManualOpen] = useState(false)
  const [detailId, setDetailId] = useState<number | null>(null)
  const [reverseTarget, setReverseTarget] = useState<Voucher | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Voucher | null>(null)
  const { mutate: reverse, isPending: reversing } = useReverseVoucher()
  const { mutate: del, isPending: deleting } = useDeleteVoucher()

  function doExport(format: 'generic' | 'kingdee') {
    downloadExport('/accounting/vouchers/export', { ...(period ? { period } : {}), format })
      .catch(e => toast.error((e as Error).message))
  }

  const columns: TableColumn<Voucher>[] = [
    { key: 'voucherNo', title: '凭证号', width: 150, render: (_v, r) => <span className="font-mono text-doc-code-muted">{r.voucherNo}</span> },
    { key: 'voucherDate', title: '日期', width: 110, render: (_v, r) => fmtDate(r.voucherDate) },
    { key: 'sourceTypeName', title: '来源', width: 100, render: (_v, r) => <SoftStatusLabel label={r.sourceTypeName} tone={r.sourceType === 'manual' ? 'draft' : 'info'} /> },
    { key: 'summary', title: '摘要', render: (_v, r) => <span className="truncate">{r.summary || '—'}</span> },
    { key: 'totalDebit', title: '借方', width: 120, align: 'right', render: (_v, r) => <span className="tabular-nums">{fmtMoney(r.totalDebit)}</span> },
    { key: 'totalCredit', title: '贷方', width: 120, align: 'right', render: (_v, r) => <span className="tabular-nums">{fmtMoney(r.totalCredit)}</span> },
    { key: 'status', title: '状态', width: 100, render: (_v, r) => (
      <span className="flex items-center gap-1">
        <SoftStatusLabel label={VOUCHER_STATUS_LABELS[r.status]} tone={statusTone(r.status)} />
        {r.isReversal === 1 && <SoftStatusLabel label="红字" tone="danger" />}
      </span>
    ) },
    { key: 'actions', title: '操作', width: 180, render: (_v, r) => (
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setDetailId(r.id)}>
          <FileText className="mr-1 h-3.5 w-3.5" />查看
        </Button>
        {canManage && r.status !== 3 && r.isReversal !== 1 && (
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-muted-foreground hover:text-warning" onClick={() => setReverseTarget(r)}>
            <Undo2 className="mr-1 h-3.5 w-3.5" />冲销
          </Button>
        )}
        {canManage && r.sourceType === 'manual' && r.status !== 3 && (
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive" onClick={() => setDeleteTarget(r)}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    ) },
  ]

  return (
    <div>
      <PageHeader
        title="记账凭证"
        description="由业务事实自动生成的借贷凭证，可导出通用记账凭证或金蝶 KIS 格式"
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => setQueryOpen(true)}>查询</Button>
            {canManage && <Button variant="outline" onClick={() => setGenOpen(true)}><RefreshCw className="mr-1.5 h-4 w-4" />生成本期凭证</Button>}
            {canManage && <Button variant="outline" onClick={() => setManualOpen(true)}><Plus className="mr-1.5 h-4 w-4" />手工录入</Button>}
            {canExport && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline"><Download className="mr-1.5 h-4 w-4" />导出</Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => doExport('generic')}>通用记账凭证 Excel</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => doExport('kingdee')}>金蝶 KIS 格式</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        }
      />

      <ReconciliationCard />

      {/* 当前生效筛选（可逐项移除） */}
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

      <div className="text-sm text-muted-foreground">共 {total} 张</div>

      <div className="card-base p-2">
        <DataTable columns={columns} data={list} loading={isLoading} emptyText="暂无凭证，点击「生成本期凭证」" columnStorageKey="acct-vouchers" />
      </div>

      {/* 分页 */}
      {totalPages > 1 && (
        <div className="mt-3 flex items-center justify-end gap-2 text-sm">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>上一页</Button>
          <span className="tabular-nums">{page} / {totalPages}</span>
          <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>下一页</Button>
        </div>
      )}

      <GenerateDialog open={genOpen} onClose={() => setGenOpen(false)} />
      <ManualDialog open={manualOpen} onClose={() => setManualOpen(false)} />
      <DetailDialog id={detailId} onClose={() => setDetailId(null)} />

      <VoucherQueryDialog
        open={queryOpen}
        initial={initialQuery}
        onClose={() => setQueryOpen(false)}
        onApply={applyQuery}
      />

      <ConfirmDialog
        open={!!reverseTarget}
        title={`冲销凭证「${reverseTarget?.voucherNo}」`}
        description="将生成一张借贷方向相反、金额相等的红字冲销凭证，原凭证标记为已冲销。原凭证不会被物理删除。"
        confirmText="确认冲销"
        loading={reversing}
        onConfirm={() => reverseTarget && reverse(reverseTarget.id, { onSuccess: () => { toast.success('已生成红字冲销凭证'); setReverseTarget(null) } })}
        onCancel={() => setReverseTarget(null)}
      />
      <ConfirmDialog
        open={!!deleteTarget}
        variant="destructive"
        title={`删除手工凭证「${deleteTarget?.voucherNo}」`}
        description="仅手工凭证可删除，自动生成的凭证请用冲销或重新生成。删除不可恢复。"
        confirmText="确认删除"
        loading={deleting}
        onConfirm={() => deleteTarget && del(deleteTarget.id, { onSuccess: () => { toast.success('已删除'); setDeleteTarget(null) } })}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}
