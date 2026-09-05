import { RecordIdentity } from '@/components/shared/RecordIdentity'
import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { X } from 'lucide-react'
import PageHeader from '@/components/shared/PageHeader'
import DataTable from '@/components/shared/DataTable'
import Pagination from '@/components/shared/Pagination'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog'
import { SoftStatusLabel } from '@/components/shared/StatusBadge'
import { QueryErrorState } from '@/components/shared/QueryErrorState'
import { getSaleListApi } from '@/api/sale'
import {
  useCreditOverrides, useCreateCreditOverride, useSubmitCreditOverride, useCancelCreditOverride,
  useApproveCreditOverride, useRejectCreditOverride,
} from '@/hooks/useCreditOverrides'
import { usePermission } from '@/hooks/usePermission'
import { PERMISSIONS } from '@/lib/permission-codes'
import { toast } from '@/lib/toast'
import { confirmAction } from '@/lib/confirm'
import { downloadExport } from '@/lib/exportDownload'
import { formatDisplayDateTime } from '@/lib/dateTime'
import { readStringParam, upsertSearchParams } from '@/lib/urlSearchParams'
import CreditOverrideQueryDialog, { type CreditOverrideQueryValues } from './CreditOverrideQueryDialog'
import { CREDIT_OVERRIDE_STATUS_LABEL } from './constants'
import type { CreditOverride } from '@/types/credit-override'
import type { TableColumn } from '@/types'

const money = (n: number | null | undefined) => `¥${Number(n ?? 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/** 发起申请弹窗：按销售单号/客户搜索草稿销售单，选中后发起 */
function CreateDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [kw, setKw] = useState('')
  const [sales, setSales] = useState<Array<{ id: number; orderNo: string; customerName: string; totalAmount: number; status: number }>>([])
  const [picked, setPicked] = useState<number | null>(null)
  const [reason, setReason] = useState('')

  const { mutate: create, isPending } = useCreateCreditOverride()

  const search = async (e: React.FormEvent) => {
    e.preventDefault()
    const r = await getSaleListApi({ page: 1, pageSize: 10, keyword: kw, status: 1 })
    setSales(r.list)
    setPicked(null)
  }

  const pickedSale = sales.find(s => s.id === picked)

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="flex max-h-[90dvh] w-[calc(100%-2rem)] max-w-2xl flex-col overflow-y-auto">
        <DialogHeader><DialogTitle>发起超额放行申请</DialogTitle><DialogDescription>选择销售单并说明超额原因，提交后进入审批。</DialogDescription></DialogHeader>
        <div className="min-w-0 space-y-4 py-2">
          <form onSubmit={search} className="flex items-center gap-2">
            <Input aria-label="搜索销售单号或客户" placeholder="销售单号 / 客户名" value={kw} onChange={e => setKw(e.target.value)} className="flex-1" />
            <Button type="submit" size="sm" variant="outline">搜索</Button>
          </form>
          {sales.length > 0 && (
            <div className="max-h-48 overflow-auto rounded-md border">
              <table className="w-full min-w-[460px] text-sm">
                <thead className="sticky top-0 bg-muted/60">
                  <tr className="text-left text-muted-foreground">
                    <th className="px-3 py-1.5 font-medium"><span className="sr-only">选择</span></th>
                    <th className="px-3 py-1.5 font-medium">单号</th>
                    <th className="px-3 py-1.5 font-medium">客户</th>
                    <th className="px-3 py-1.5 text-right font-medium">金额</th>
                  </tr>
                </thead>
                <tbody>
                  {sales.map(s => (
                    <tr key={s.id} className={`cursor-pointer border-t hover:bg-accent/50 ${picked === s.id ? 'bg-accent/60' : ''}`} onClick={() => setPicked(s.id)}>
                      <td className="px-3 py-1.5">
                        <input type="radio" aria-label={`选择 ${s.orderNo}`} checked={picked === s.id} onChange={() => setPicked(s.id)} className="accent-primary" />
                      </td>
                      <td className="px-3 py-1.5 text-doc-code">{s.orderNo}</td>
                      <td className="px-3 py-1.5">{s.customerName}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{money(s.totalAmount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {sales.length === 0 && kw && (
            <p className="text-sm text-muted-foreground">未找到草稿状态的销售单</p>
          )}
          {pickedSale && (
            <div className="rounded-md border border-warning/30 bg-warning/5 px-3 py-2 text-sm">
              选中 <span className="font-medium">{pickedSale.orderNo}</span>（{pickedSale.customerName}，{money(pickedSale.totalAmount)}）。
              提交后系统会校验该客户授信是否超限并快照额度/已用/超量。
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="credit-reason">超额原因 <span className="text-destructive">*</span></Label>
            <textarea id="credit-reason" value={reason} onChange={e => setReason(e.target.value)} placeholder="说明业务背景、预计回款安排，供审批人参考" maxLength={500} rows={3} className="w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
            <p className="text-right text-xs tabular-nums text-muted-foreground">{reason.length} / 500</p>
          </div>
        </div>
        <DialogFooter className="gap-2 sm:space-x-0">
          <Button variant="outline" onClick={onClose} disabled={isPending}>取消</Button>
          <Button
            disabled={!picked || !reason.trim() || isPending}
            onClick={() => create({ saleOrderId: picked!, reason: reason.trim() }, {
              onSuccess: (r) => { onClose(); toast.success(`已发起申请单 ${r.overrideNo}，待审批`) },
              onError: (e: Error) => toast.error(e.message),
            })}
          >提交申请</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default function CreditOverridesPage() {
  const { can } = usePermission()
  const canApply = can(PERMISSIONS.SALE_CREDIT_OVERRIDE_APPLY)
  const [searchParams, setSearchParams] = useSearchParams()
  const [queryOpen, setQueryOpen] = useState(false)
  const [rejectTarget, setRejectTarget] = useState<CreditOverride | null>(null)
  const [rejectReason, setRejectReason] = useState('')

  // ── 当前生效的筛选（全部存于 URL 参数，刷新/分享可保留） ──
  const keyword   = readStringParam(searchParams, 'keyword')
  const status    = readStringParam(searchParams, 'status')
  const startDate = readStringParam(searchParams, 'startDate')
  const endDate   = readStringParam(searchParams, 'endDate')

  const [page, setPage] = useState(1)
  const [createOpen, setCreateOpen] = useState(false)

  const { data, isLoading, isError, error, refetch } = useCreditOverrides({
    page,
    pageSize: 20,
    status: status || undefined,
    keyword: keyword || undefined,
    startDate: startDate || undefined,
    endDate: endDate || undefined,
  })
  const { mutate: submit } = useSubmitCreditOverride()
  const { mutate: cancel } = useCancelCreditOverride()
  const { mutate: approve } = useApproveCreditOverride()
  const { mutate: reject, isPending: rejecting } = useRejectCreditOverride()

  const list = useMemo(() => data?.list ?? [], [data])
  const total = data?.pagination.total ?? 0

  function updateParams(updates: Record<string, string | number | null | undefined>) {
    setSearchParams(upsertSearchParams(searchParams, updates))
  }

  // 查询弹窗初始值
  const initialQuery: CreditOverrideQueryValues = { keyword, status, startDate, endDate }

  function applyQuery(v: CreditOverrideQueryValues) {
    updateParams({
      keyword: v.keyword || null,
      status: v.status || null,
      startDate: v.startDate || null,
      endDate: v.endDate || null,
    })
    setPage(1)
    setQueryOpen(false)
  }

  function clearAll() {
    updateParams({ keyword: null, status: null, startDate: null, endDate: null })
    setPage(1)
  }

  // 当前生效筛选摘要（可逐项移除）
  const chips = [
    keyword && { key: 'keyword', label: `关键字：${keyword}`, onRemove: () => updateParams({ keyword: null }) },
    status && { key: 'status', label: `状态：${CREDIT_OVERRIDE_STATUS_LABEL[status] ?? status}`, onRemove: () => updateParams({ status: null }) },
    startDate && { key: 'startDate', label: `创建日期从：${startDate}`, onRemove: () => updateParams({ startDate: null }) },
    endDate && { key: 'endDate', label: `创建日期至：${endDate}`, onRemove: () => updateParams({ endDate: null }) },
  ].filter(Boolean) as { key: string; label: string; onRemove: () => void }[]

  const columns: TableColumn<CreditOverride>[] = [
    { key: 'overrideNo', title: '申请单 / 创建时间', width: 230, render: (_, row) => <RecordIdentity title={row.overrideNo} detail={formatDisplayDateTime(row.createdAt)} /> },
    { key: 'saleOrderNo', title: '销售单', width: 140, render: v => <span className="text-doc-code">{String(v)}</span> },
    { key: 'customerName', title: '客户', width: 160 },
    { key: 'thisAmount', title: '本单净额', width: 120, align: 'right', render: v => <span className="tabular-nums">{money(v as number)}</span> },
    { key: 'creditLimit', title: '授信额度', width: 120, align: 'right', render: v => <span className="tabular-nums">{money(v as number)}</span> },
    {
      key: 'overAmount',
      title: '超额金额',
      width: 110,
      align: 'right',
      render: v => <span className="tabular-nums text-destructive">{money(v as number)}</span>,
    },
    {
      key: 'status',
      title: '状态',
      width: 90,
      render: (_, row) => <SoftStatusLabel label={row.statusName} tone={(row.statusTone as 'draft' | 'warning' | 'success' | 'danger')} />,
    },
    { key: 'reason', title: '申请原因', width: 220, render: (v, row) => <div className="space-y-1 py-1"><p className="whitespace-normal break-words">{String(v || '—')}</p>{row.rejectReason && <p className="whitespace-normal break-words text-xs text-destructive">驳回：{row.rejectReason}</p>}</div> },
    { key: 'applicantName', title: '申请人', width: 100 },
    {
      key: 'id',
      title: '操作',
      width: 200,
      render: (_, row) => {
        const els: React.ReactNode[] = []
        if (row.status === 1) els.push(<Button key="submit" size="sm" variant="outline" onClick={() => submit(row.id, { onSuccess: () => toast.success('已提交审批'), onError: (e: Error) => toast.error(e.message) })}>提交</Button>)
        if (row.status === 2 && canApply) els.push(<Button key="ap" size="sm" variant="outline" onClick={() => approve(row.id, { onSuccess: () => toast.success('已批准'), onError: (e: Error) => toast.error(e.message) })}>批准</Button>)
        if (row.status === 2 && canApply) els.push(<Button key="rj" size="sm" variant="ghost" className="text-destructive" onClick={() => {
          setRejectTarget(row); setRejectReason('')
        }}>驳回</Button>)
        if (row.status === 1 || row.status === 2 || row.status === 4) els.push(<Button key="cx" size="sm" variant="ghost" onClick={() => confirmAction({ title: '取消申请', description: '确定取消这张放行申请吗？', onConfirm: () => cancel(row.id, { onSuccess: () => toast.success('已取消'), onError: (e: Error) => toast.error(e.message) }) })}>取消</Button>)
        return <div className="flex gap-1">{els}</div>
      },
    },
  ]

  return (
    <div className="space-y-4">
      <PageHeader
        title="超额放行申请"
        description="管理销售订单的授信超额申请，核对申请额度、原因与审批状态。"
        actions={
          <>
            <Button variant="outline" onClick={() => downloadExport('/export/credit-overrides').catch(e => toast.error((e as Error).message))}>导出</Button>
            <Button variant="outline" onClick={() => setQueryOpen(true)}>查询</Button>
            {canApply ? <Button onClick={() => setCreateOpen(true)}>发起申请</Button> : undefined}
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

      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
        <p>共 <span className="font-medium tabular-nums text-foreground">{total.toLocaleString()}</span> 条申请 · {status ? CREDIT_OVERRIDE_STATUS_LABEL[status] ?? status : '全部状态'}</p>
        <span className="text-xs">金额为申请时的授信快照</span>
      </div>
      {isError && !data ? (
        <QueryErrorState error={error} onRetry={() => void refetch()} title="加载失败" compact />
      ) : (
        <DataTable columns={columns} data={list} loading={isLoading} rowKey="id" emptyText="暂无超额放行申请" />
      )}
      {total > 0 && <Pagination page={page} totalPages={Math.ceil(total / 20)} total={total} onPageChange={setPage} />}

      <Dialog open={!!rejectTarget} onOpenChange={open => { if (!open && !rejecting) setRejectTarget(null) }}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>驳回超额放行申请</DialogTitle><DialogDescription>说明驳回原因，便于申请人调整销售安排。</DialogDescription></DialogHeader>
          <RecordIdentity title={rejectTarget?.overrideNo} detail={rejectTarget?.customerName} />
          <div className="space-y-2">
            <Label htmlFor="credit-reject-reason">驳回原因</Label>
            <textarea id="credit-reject-reason" autoFocus rows={4} maxLength={300} value={rejectReason} onChange={e => setRejectReason(e.target.value)} disabled={rejecting} className="w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" placeholder="填写具体原因，最多 300 字" />
            <p className="text-right text-xs text-muted-foreground">{rejectReason.length} / 300</p>
          </div>
          <DialogFooter><Button variant="outline" disabled={rejecting} onClick={() => setRejectTarget(null)}>取消</Button><Button variant="destructive" disabled={rejecting || !rejectReason.trim()} onClick={() => {
            if (!rejectTarget) return
            reject({ id: rejectTarget.id, reason: rejectReason.trim() }, { onSuccess: () => { toast.success('已驳回'); setRejectTarget(null) }, onError: (e: Error) => toast.error(e.message) })
          }}>{rejecting ? '提交中…' : '确认驳回'}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <CreateDialog open={createOpen} onClose={() => setCreateOpen(false)} />

      <CreditOverrideQueryDialog
        open={queryOpen}
        initial={initialQuery}
        onClose={() => setQueryOpen(false)}
        onApply={applyQuery}
      />
    </div>
  )
}
