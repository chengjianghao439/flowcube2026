import { amount } from '@/lib/format'
import ListSummary from '@/components/shared/ListSummary'
import { DatePicker } from '@/components/shared/DatePicker'
/**
 * 发票管理（文档 10 · Phase 3）
 * 进项/销项发票池 + 录入 + 认证/抵扣/红冲台账。发票与业务单弱关联，税额只在凭证映射时拆分。
 * 前端不算会计（税额拆分/凭证一律后端）；本页仅按税率给录入做价税辅助计算。
 */
import { useMemo, useState, useEffect, useId } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Trash2, BadgeCheck, Undo2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import PageHeader from '@/components/shared/PageHeader'
import DataTable from '@/components/shared/DataTable'
import { QueryErrorState } from '@/components/shared/QueryErrorState'
import { SoftStatusLabel } from '@/components/shared/StatusBadge'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { cn } from '@/lib/utils'
import { toast } from '@/lib/toast'
import { todayYmd } from '@/lib/dateTime'
import { usePermission } from '@/hooks/usePermission'
import { PERMISSIONS } from '@/lib/permission-codes'
import { useDialogDraftGuard } from '@/hooks/useDialogDraftGuard'
import { EditModeBadge, UnsavedBadge } from '@/components/shared/EditModeBadge'
import { useInvoices, useCreateInvoice, useUpdateInvoice, useChangeInvoiceStatus, useDeleteInvoice } from '@/hooks/useInvoices'
import type { TableColumn } from '@/types'
import type { Invoice, CreateInvoiceParams } from '@/types/accounting'

const PAGE_SIZE = 20
// 统一走 lib/format 的 amount（会计口径：千分位 + 两位小数、不带 ¥）
const m = amount
const TAX_RATES = [0.13, 0.09, 0.06, 0.03, 0.01, 0]
const statusTone = (type: number, status: number) => {
  if (type === 1) return status === 3 ? 'success' : status === 2 ? 'active' : 'warning'
  return status === 2 ? 'danger' : 'success'
}

// ─── 录入/编辑弹窗 ─────────────────────────────────────────────────────────────
function InvoiceDialog({ open, invoiceType, edit, onClose }: { open: boolean; invoiceType: number; edit: Invoice | null; onClose: () => void }) {
  const qc = useQueryClient()
  const { mutate: create, isPending: creating } = useCreateInvoice()
  const { mutate: update, isPending: updating } = useUpdateInvoice()
  const inputId = useId()
  const [f, setF] = useState({
    invoiceCode: '', invoiceNo: '', partyName: '', partyTaxNo: '',
    withTax: '', taxRate: '0.13', invoiceDate: todayYmd(), sourceNo: '', remark: '',
  })
  // 版本冲突（迁移 263）：**保留弹窗与草稿**，只做提示，由用户复制后关闭重开核对。
  const [conflict, setConflict] = useState(false)
  const [baseline, setBaseline] = useState(f)
  // 日期手输先保存在控件内，未 blur 前也属于未保存输入。
  const [inputDirty, setInputDirty] = useState(false)
  const dirty = inputDirty || JSON.stringify(f) !== JSON.stringify(baseline)
  const draft = useDialogDraftGuard({ open, identity: `${invoiceType}:${edit?.id ?? 'new'}`, dirty, pending: creating || updating, onClose })
  const isPending = draft.locked
  // 依赖刻意只认 open、invoiceType 与 edit?.id：edit 是 React Query 每次 refetch 都重建的对象引用，
  // 整体入依赖会让后台刷新在用户填写途中重置表单；只有换了一条发票（id 变）才该重填。
  useEffect(() => {
    if (!open) return
    // 每次**真正重建表单**（打开 / 换编辑对象 / 转录入）都清掉上一次的冲突提示，
    // 否则手动关闭重开或转"录入"会带着旧冲突条。
    setConflict(false); setInputDirty(false)
    const next = edit ? {
      invoiceCode: edit.invoiceCode ?? '', invoiceNo: edit.invoiceNo ?? '', partyName: edit.partyName, partyTaxNo: edit.partyTaxNo ?? '',
      withTax: String(edit.amountWithTax), taxRate: String(edit.taxRate), invoiceDate: String(edit.invoiceDate).slice(0, 10), sourceNo: edit.sourceNo ?? '', remark: edit.remark ?? '',
    } : { invoiceCode: '', invoiceNo: '', partyName: '', partyTaxNo: '', withTax: '', taxRate: '0.13', invoiceDate: todayYmd(), sourceNo: '', remark: '' }
    setF(next); setBaseline(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 打开/切换发票时建立基线，同 id 刷新不得覆盖草稿
  }, [open, edit?.id, invoiceType])

  const withTax = Number(f.withTax) || 0
  const rate = Number(f.taxRate) || 0
  const taxAmount = Math.round((withTax - withTax / (1 + rate)) * 100) / 100
  const noTax = Math.round((withTax - taxAmount) * 100) / 100

  function submit() {
    const submission = draft.beginSubmit()
    if (!submission) return
    const d: CreateInvoiceParams = {
      invoiceType, invoiceCode: f.invoiceCode || null, invoiceNo: f.invoiceNo.trim(), partyName: f.partyName.trim(), partyTaxNo: f.partyTaxNo || null,
      amountNoTax: noTax, taxRate: rate, taxAmount, amountWithTax: withTax, invoiceDate: f.invoiceDate, sourceNo: f.sourceNo || null, remark: f.remark || null,
      // 编辑乐观锁（迁移 263）：把打开弹窗时那份的 revision 原样回传；后端发现已被他人改动即 409，
      // 避免两次并发编辑互相静默覆盖（**实测**是金额/备注会被覆盖；来源关联走同一条 UPDATE
      // 路径、存在同样风险，但未单独实测）。
      ...(edit ? { revision: edit.revision } : {}),
    }
    if (edit) update({ id: edit.id, d }, {
      onSuccess: () => { if (submission.finish()) { toast.success('已保存'); onClose() } },
      // 并发编辑冲突（迁移 263）：这张票已被他人改过。**保留弹窗与草稿**，只做两件事——
      // 失效列表（**异步**，不是立刻就有新数据）+ 置冲突提示（提示用户先复制、关闭、等刷新完成后再重开核对）；
      // **不**自动关闭弹窗、**不**自动重试、**不**把新版本 merge 进旧草稿（避免"新版本 + 旧草稿"）。
      // **提示不在这里发**：全局拦截器已对 409 统一 `toast.error(后端 message)`，本地再 toast 会双重报错。
      onError: (e: unknown) => {
        if (!submission.finish()) return
        const code = (e as { code?: string } | null)?.code
        if (code === 'INVOICE_CONCURRENT_MODIFIED') {
          // **保留弹窗与草稿**：只失效列表并给内联提示；由用户先复制、关闭、等刷新完成后重开核对。
          // 不自动关闭弹窗、不自动重试、不把新版本 merge 进旧草稿（避免"新版本 + 旧草稿"）。
          qc.invalidateQueries({ queryKey: ['acct-invoices'] })
          setConflict(true)
        }
      },
    })
    else create(d, { onSuccess: () => { if (submission.finish()) { toast.success('发票已录入'); onClose() } }, onError: () => { submission.finish() } })
  }

  const typeName = invoiceType === 1 ? '进项' : '销项'
  return (
    <>
    <Dialog open={open} onOpenChange={v => { if (!v) draft.requestClose() }}>
      <DialogContent ref={draft.contentRef} onFocusCapture={draft.rememberFocus} onInputCapture={() => { if (draft.canEdit()) setInputDirty(true) }} className="sm:max-w-2xl">
        {/* 编辑态与默认（录入）态一眼可分 */}
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            {edit ? '编辑' : '录入'}{typeName}发票
            {edit && <EditModeBadge />}
            <UnsavedBadge show={dirty} />
          </DialogTitle>
          {edit && (
            <p className="text-helper mt-1">
              正在编辑：<span className="font-medium text-foreground">{f.invoiceNo ? `发票号 ${f.invoiceNo}` : `#${edit.id}`}{f.partyName ? ` · ${f.partyName}` : ''}</span>
            </p>
          )}
        </DialogHeader>
        {conflict && (
          // 版本冲突（迁移 263）：**保留弹窗与草稿**，提示"先复制再关闭重开核对"。
          // 不自动关闭、不自动重试、不把新版本 merge 进旧草稿；toast 仍由全局拦截器统一给出。
          <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm">
            <p className="font-medium text-destructive-ink">本次修改未保存（该发票已被他人修改）</p>
            <p className="mt-1 text-xs text-muted-foreground">
              当前填写内容仍在。请先复制需要保留的内容，再关闭本弹窗、等列表刷新完成后重新打开，核对最新内容后再提交。
            </p>
          </div>
        )}
        <div className="grid grid-cols-2 gap-4 py-1">
          <div className="space-y-1.5"><Label htmlFor={`${inputId}-invoiceCode`}>发票代码</Label><Input id={`${inputId}-invoiceCode`} value={f.invoiceCode} onChange={e => setF(s => ({ ...s, invoiceCode: e.target.value }))} disabled={isPending} className="font-mono" /></div>
          <div className="space-y-1.5"><Label htmlFor={`${inputId}-invoiceNo`}>发票号码 *</Label><Input id={`${inputId}-invoiceNo`} value={f.invoiceNo} onChange={e => setF(s => ({ ...s, invoiceNo: e.target.value }))} disabled={isPending} className="font-mono" /></div>
          <div className="space-y-1.5 col-span-2"><Label htmlFor={`${inputId}-partyName`}>{invoiceType === 1 ? '供应商' : '客户'} *</Label><Input id={`${inputId}-partyName`} value={f.partyName} onChange={e => setF(s => ({ ...s, partyName: e.target.value }))} disabled={isPending} /></div>
          <div className="space-y-1.5 col-span-2"><Label htmlFor={`${inputId}-partyTaxNo`}>对方纳税人识别号</Label><Input id={`${inputId}-partyTaxNo`} value={f.partyTaxNo} onChange={e => setF(s => ({ ...s, partyTaxNo: e.target.value }))} disabled={isPending} className="font-mono" /></div>
          <div className="space-y-1.5"><Label htmlFor={`${inputId}-withTax`}>价税合计 *</Label><Input id={`${inputId}-withTax`} type="number" value={f.withTax} onChange={e => setF(s => ({ ...s, withTax: e.target.value }))} disabled={isPending} className="text-right tabular-nums" /></div>
          <div className="space-y-1.5">
            <Label htmlFor={`${inputId}-taxRate`}>税率</Label>
            <Select value={f.taxRate} onValueChange={v => { if (draft.canEdit()) setF(s => ({ ...s, taxRate: v })) }} disabled={isPending}>
              <SelectTrigger id={`${inputId}-taxRate`} className="h-10"><SelectValue /></SelectTrigger>
              <SelectContent>{TAX_RATES.map(r => <SelectItem key={r} value={String(r)}>{(r * 100).toFixed(0)}%</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="col-span-2 flex items-center justify-around rounded-md bg-muted/30 px-3 py-2 text-sm">
            <span>不含税 <span className="tabular-nums font-medium">{m(noTax)}</span></span>
            <span>税额 <span className="tabular-nums font-medium">{m(taxAmount)}</span></span>
            <span>价税合计 <span className="tabular-nums font-medium">{m(withTax)}</span></span>
          </div>
          <div className="space-y-1.5"><Label htmlFor={`${inputId}-invoiceDate`}>开票日期 *</Label><DatePicker id={`${inputId}-invoiceDate`} value={f.invoiceDate} onChange={v => { if (draft.canEdit()) setF(s => ({ ...s, invoiceDate: v })) }} disabled={isPending} /></div>
          <div className="space-y-1.5"><Label htmlFor={`${inputId}-sourceNo`}>关联单号（选填）</Label><Input id={`${inputId}-sourceNo`} value={f.sourceNo} onChange={e => setF(s => ({ ...s, sourceNo: e.target.value }))} disabled={isPending} placeholder="采购/销售单号" /></div>
          <div className="space-y-1.5 col-span-2"><Label htmlFor={`${inputId}-remark`}>备注</Label><Input id={`${inputId}-remark`} value={f.remark} onChange={e => setF(s => ({ ...s, remark: e.target.value }))} disabled={isPending} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={draft.requestClose} disabled={isPending}>取消</Button>
          <Button onClick={submit} disabled={isPending || !f.invoiceNo.trim() || !f.partyName.trim() || !(withTax > 0)}>{isPending ? '保存中…' : (edit ? '保存修改' : '保存')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <ConfirmDialog {...draft.discardProps} />
    </>
  )
}

// ─── 主页面 ───────────────────────────────────────────────────────────────────
export default function InvoicesPage() {
  const { can } = usePermission()
  const canManage = can(PERMISSIONS.INVOICE_MANAGE)
  const [invoiceType, setInvoiceType] = useState(1)
  const [keyword, setKeyword] = useState('')
  const query = useMemo(() => ({ invoiceType, keyword: keyword || undefined, page: 1, pageSize: PAGE_SIZE }), [invoiceType, keyword])
  // `isFetching`（而非 `isLoading`）：已有数据时后台刷新 isLoading 不成立，但仍在"刷新中"。
  const { data, isLoading, isFetching, isError, error, refetch } = useInvoices(query)
  const list = data?.list ?? []
  const total = data?.pagination?.total ?? 0

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
    { key: 'partyName', title: invoiceType === 1 ? '供应商' : '客户', render: (_v, r) => <span className="min-w-0 whitespace-normal [overflow-wrap:anywhere]">{r.partyName}</span> },
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
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground" title={isError ? '列表加载失败，请先重试再编辑' : isFetching ? '列表刷新中，请稍候再编辑' : '编辑'} disabled={isFetching || isError} onClick={() => { setEditTarget(r); setDialogOpen(true) }}><Pencil className="h-3.5 w-3.5" /></Button>
        )}
        {r.invoiceType === 1 && r.status === 1 && <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-muted-foreground hover:text-primary" onClick={() => doStatus(r, 'certify', '认证')}><BadgeCheck className="mr-1 h-3.5 w-3.5" />认证</Button>}
        {r.invoiceType === 1 && r.status === 2 && <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-muted-foreground hover:text-success-ink" onClick={() => doStatus(r, 'deduct', '抵扣')}>抵扣</Button>}
        {r.invoiceType === 2 && r.status === 1 && <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive-ink" onClick={() => doStatus(r, 'redFlush', '红冲')}><Undo2 className="mr-1 h-3.5 w-3.5" />红冲</Button>}
        <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive-ink" title="删除" onClick={() => setDeleteTarget(r)}><Trash2 className="h-3.5 w-3.5" /></Button>
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
            <button key={t.v} onClick={() => { setInvoiceType(t.v); }}
              className={cn('rounded-md px-3 py-1.5 text-sm transition-colors', invoiceType === t.v ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground')}>{t.l}</button>
          ))}
        </div>
        <Input value={keyword} onChange={e => { setKeyword(e.target.value); }} placeholder="发票号 / 单位 / 单号" className="h-9 w-52" />
        {!isError && <span className="ml-auto text-sm text-muted-foreground">共 {total} 张</span>}
      </div>

      <div className="card-base p-2">
        {isError ? (
          <QueryErrorState error={error} onRetry={() => void refetch()} title="发票列表加载失败" compact />
        ) : (
          <DataTable columns={columns} data={list} loading={isLoading} emptyText="暂无发票，点击右上角录入" columnStorageKey={`acct-invoices-${invoiceType}`} />
        )}
      </div>

      {!isError && <ListSummary total={total} />}

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
