/**
 * 发票管理（文档 10 · Phase 3）
 * 进项/销项发票池 + 录入 + 认证/抵扣/红冲台账。发票与业务单弱关联，税额只在凭证映射时拆分。
 * 前端不算会计（税额拆分/凭证一律后端）；本页仅按税率给录入做价税辅助计算。
 */
import { useMemo, useState, useEffect } from 'react'
import { Plus, Pencil, Trash2, BadgeCheck, Undo2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import PageHeader from '@/components/shared/PageHeader'
import DataTable from '@/components/shared/DataTable'
import { SoftStatusLabel } from '@/components/shared/StatusBadge'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { cn } from '@/lib/utils'
import { toast } from '@/lib/toast'
import { usePermission } from '@/hooks/usePermission'
import { PERMISSIONS } from '@/lib/permission-codes'
import { useInvoices, useCreateInvoice, useUpdateInvoice, useChangeInvoiceStatus, useDeleteInvoice } from '@/hooks/useInvoices'
import type { TableColumn } from '@/types'
import type { Invoice, CreateInvoiceParams } from '@/types/accounting'

const PAGE_SIZE = 20
const m = (n: number | null | undefined) => (Number(n) || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const TAX_RATES = [0.13, 0.09, 0.06, 0.03, 0.01, 0]
const statusTone = (type: number, status: number) => {
  if (type === 1) return status === 3 ? 'success' : status === 2 ? 'active' : 'warning'
  return status === 2 ? 'danger' : 'success'
}

// ─── 录入/编辑弹窗 ─────────────────────────────────────────────────────────────
function InvoiceDialog({ open, invoiceType, edit, onClose }: { open: boolean; invoiceType: number; edit: Invoice | null; onClose: () => void }) {
  const { mutate: create, isPending: creating } = useCreateInvoice()
  const { mutate: update, isPending: updating } = useUpdateInvoice()
  const isPending = creating || updating
  const [f, setF] = useState({
    invoiceCode: '', invoiceNo: '', partyName: '', partyTaxNo: '',
    withTax: '', taxRate: '0.13', invoiceDate: new Date().toISOString().slice(0, 10), sourceNo: '', remark: '',
  })
  useEffect(() => {
    if (!open) return
    if (edit) setF({
      invoiceCode: edit.invoiceCode ?? '', invoiceNo: edit.invoiceNo ?? '', partyName: edit.partyName, partyTaxNo: edit.partyTaxNo ?? '',
      withTax: String(edit.amountWithTax), taxRate: String(edit.taxRate), invoiceDate: String(edit.invoiceDate).slice(0, 10), sourceNo: edit.sourceNo ?? '', remark: edit.remark ?? '',
    })
    else setF({ invoiceCode: '', invoiceNo: '', partyName: '', partyTaxNo: '', withTax: '', taxRate: '0.13', invoiceDate: new Date().toISOString().slice(0, 10), sourceNo: '', remark: '' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, edit?.id])

  const withTax = Number(f.withTax) || 0
  const rate = Number(f.taxRate) || 0
  const taxAmount = Math.round((withTax - withTax / (1 + rate)) * 100) / 100
  const noTax = Math.round((withTax - taxAmount) * 100) / 100

  function submit() {
    const d: CreateInvoiceParams = {
      invoiceType, invoiceCode: f.invoiceCode || null, invoiceNo: f.invoiceNo.trim(), partyName: f.partyName.trim(), partyTaxNo: f.partyTaxNo || null,
      amountNoTax: noTax, taxRate: rate, taxAmount, amountWithTax: withTax, invoiceDate: f.invoiceDate, sourceNo: f.sourceNo || null, remark: f.remark || null,
    }
    if (edit) update({ id: edit.id, d }, { onSuccess: () => { toast.success('已保存'); onClose() } })
    else create(d, { onSuccess: () => { toast.success('发票已录入'); onClose() } })
  }

  const typeName = invoiceType === 1 ? '进项' : '销项'
  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>{edit ? '编辑' : '录入'}{typeName}发票</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-4 py-1">
          <div className="space-y-1.5"><Label>发票代码</Label><Input value={f.invoiceCode} onChange={e => setF(s => ({ ...s, invoiceCode: e.target.value }))} disabled={isPending} className="font-mono" /></div>
          <div className="space-y-1.5"><Label>发票号码 *</Label><Input value={f.invoiceNo} onChange={e => setF(s => ({ ...s, invoiceNo: e.target.value }))} disabled={isPending} className="font-mono" /></div>
          <div className="space-y-1.5 col-span-2"><Label>{invoiceType === 1 ? '供应商' : '客户'} *</Label><Input value={f.partyName} onChange={e => setF(s => ({ ...s, partyName: e.target.value }))} disabled={isPending} /></div>
          <div className="space-y-1.5 col-span-2"><Label>对方纳税人识别号</Label><Input value={f.partyTaxNo} onChange={e => setF(s => ({ ...s, partyTaxNo: e.target.value }))} disabled={isPending} className="font-mono" /></div>
          <div className="space-y-1.5"><Label>价税合计 *</Label><Input type="number" value={f.withTax} onChange={e => setF(s => ({ ...s, withTax: e.target.value }))} disabled={isPending} className="text-right tabular-nums" /></div>
          <div className="space-y-1.5">
            <Label>税率</Label>
            <Select value={f.taxRate} onValueChange={v => setF(s => ({ ...s, taxRate: v }))} disabled={isPending}>
              <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
              <SelectContent>{TAX_RATES.map(r => <SelectItem key={r} value={String(r)}>{(r * 100).toFixed(0)}%</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="col-span-2 flex items-center justify-around rounded-md bg-muted/30 px-3 py-2 text-sm">
            <span>不含税 <span className="tabular-nums font-medium">{m(noTax)}</span></span>
            <span>税额 <span className="tabular-nums font-medium">{m(taxAmount)}</span></span>
            <span>价税合计 <span className="tabular-nums font-medium">{m(withTax)}</span></span>
          </div>
          <div className="space-y-1.5"><Label>开票日期 *</Label><Input type="date" value={f.invoiceDate} onChange={e => setF(s => ({ ...s, invoiceDate: e.target.value }))} disabled={isPending} /></div>
          <div className="space-y-1.5"><Label>关联单号（选填）</Label><Input value={f.sourceNo} onChange={e => setF(s => ({ ...s, sourceNo: e.target.value }))} disabled={isPending} placeholder="采购/销售单号" /></div>
          <div className="space-y-1.5 col-span-2"><Label>备注</Label><Input value={f.remark} onChange={e => setF(s => ({ ...s, remark: e.target.value }))} disabled={isPending} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isPending}>取消</Button>
          <Button onClick={submit} disabled={isPending || !f.invoiceNo.trim() || !f.partyName.trim() || !(withTax > 0)}>{isPending ? '保存中…' : '保存'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── 主页面 ───────────────────────────────────────────────────────────────────
export default function InvoicesPage() {
  const { can } = usePermission()
  const canManage = can(PERMISSIONS.INVOICE_MANAGE)
  const [invoiceType, setInvoiceType] = useState(1)
  const [keyword, setKeyword] = useState('')
  const [page, setPage] = useState(1)
  const query = useMemo(() => ({ invoiceType, keyword: keyword || undefined, page, pageSize: PAGE_SIZE }), [invoiceType, keyword, page])
  const { data, isLoading } = useInvoices(query)
  const list = data?.list ?? []
  const total = data?.pagination?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<Invoice | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Invoice | null>(null)
  const { mutate: changeStatus } = useChangeInvoiceStatus()
  const { mutate: del, isPending: deleting } = useDeleteInvoice()

  function doStatus(inv: Invoice, action: 'certify' | 'deduct' | 'redFlush', label: string) {
    changeStatus({ id: inv.id, action }, { onSuccess: () => toast.success(`已${label}`) })
  }

  const columns: TableColumn<Invoice>[] = [
    { key: 'invoiceNo', title: '发票号码', width: 130, render: (_v, r) => <span className="font-mono text-doc-code-muted">{r.invoiceNo}</span> },
    { key: 'partyName', title: invoiceType === 1 ? '供应商' : '客户', render: (_v, r) => <span className="truncate">{r.partyName}</span> },
    { key: 'amountNoTax', title: '不含税', width: 110, align: 'right', render: (_v, r) => <span className="tabular-nums">{m(r.amountNoTax)}</span> },
    { key: 'taxRate', title: '税率', width: 70, align: 'right', render: (_v, r) => `${(r.taxRate * 100).toFixed(0)}%` },
    { key: 'taxAmount', title: '税额', width: 100, align: 'right', render: (_v, r) => <span className="tabular-nums">{m(r.taxAmount)}</span> },
    { key: 'amountWithTax', title: '价税合计', width: 120, align: 'right', render: (_v, r) => <span className="tabular-nums font-medium">{m(r.amountWithTax)}</span> },
    { key: 'invoiceDate', title: '开票日期', width: 110, render: (_v, r) => String(r.invoiceDate).slice(0, 10) },
    { key: 'sourceNo', title: '关联单号', width: 120, render: (_v, r) => r.sourceNo || '—' },
    { key: 'status', title: '状态', width: 90, render: (_v, r) => <SoftStatusLabel label={r.statusName} tone={statusTone(r.invoiceType, r.status)} /> },
    { key: 'actions', title: '操作', width: 190, render: (_v, r) => canManage && (
      <div className="flex items-center gap-1">
        {r.status === 1 && (
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground" title="编辑" onClick={() => { setEditTarget(r); setDialogOpen(true) }}><Pencil className="h-3.5 w-3.5" /></Button>
        )}
        {r.invoiceType === 1 && r.status === 1 && <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-muted-foreground hover:text-primary" onClick={() => doStatus(r, 'certify', '认证')}><BadgeCheck className="mr-1 h-3.5 w-3.5" />认证</Button>}
        {r.invoiceType === 1 && r.status === 2 && <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-muted-foreground hover:text-success" onClick={() => doStatus(r, 'deduct', '抵扣')}>抵扣</Button>}
        {r.invoiceType === 2 && r.status === 1 && <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive" onClick={() => doStatus(r, 'redFlush', '红冲')}><Undo2 className="mr-1 h-3.5 w-3.5" />红冲</Button>}
        <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive" title="删除" onClick={() => setDeleteTarget(r)}><Trash2 className="h-3.5 w-3.5" /></Button>
      </div>
    ) },
  ]

  return (
    <div>
      <PageHeader
        title="发票管理"
        description="进项/销项发票池与认证抵扣台账；税额在生成凭证时按发票自动拆分为进项/销项税额"
        actions={canManage && <Button onClick={() => { setEditTarget(null); setDialogOpen(true) }}><Plus className="mr-1.5 h-4 w-4" />录入{invoiceType === 1 ? '进项' : '销项'}发票</Button>}
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border border-border/70 bg-card p-0.5">
          {[{ v: 1, l: '进项发票' }, { v: 2, l: '销项发票' }].map(t => (
            <button key={t.v} onClick={() => { setInvoiceType(t.v); setPage(1) }}
              className={cn('rounded-md px-3 py-1.5 text-sm transition-colors', invoiceType === t.v ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground')}>{t.l}</button>
          ))}
        </div>
        <Input value={keyword} onChange={e => { setKeyword(e.target.value); setPage(1) }} placeholder="发票号 / 单位 / 单号" className="h-9 w-52" />
        <span className="ml-auto text-sm text-muted-foreground">共 {total} 张</span>
      </div>

      <div className="card-base p-2">
        <DataTable columns={columns} data={list} loading={isLoading} emptyText="暂无发票，点击右上角录入" columnStorageKey={`acct-invoices-${invoiceType}`} />
      </div>

      {totalPages > 1 && (
        <div className="mt-3 flex items-center justify-end gap-2 text-sm">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>上一页</Button>
          <span className="tabular-nums">{page} / {totalPages}</span>
          <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>下一页</Button>
        </div>
      )}

      <InvoiceDialog open={dialogOpen} invoiceType={editTarget?.invoiceType ?? invoiceType} edit={editTarget} onClose={() => { setDialogOpen(false); setEditTarget(null) }} />
      <ConfirmDialog
        open={!!deleteTarget}
        variant="destructive"
        title={`删除发票「${deleteTarget?.invoiceNo}」`}
        description="删除后不可恢复；已生成的凭证会在下次生成时按新的发票状态重算税额。"
        confirmText="确认删除"
        loading={deleting}
        onConfirm={() => deleteTarget && del(deleteTarget.id, { onSuccess: () => { toast.success('已删除'); setDeleteTarget(null) } })}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}
