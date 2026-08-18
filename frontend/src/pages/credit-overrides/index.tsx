import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { X } from 'lucide-react'
import PageHeader from '@/components/shared/PageHeader'
import DataTable from '@/components/shared/DataTable'
import Pagination from '@/components/shared/Pagination'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
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

const money = (n: number | null | undefined) => `¥${Number(n ?? 0).toFixed(2)}`

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
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>发起超额放行申请</DialogTitle></DialogHeader>
        <div className="space-y-4 py-2">
          <form onSubmit={search} className="flex items-center gap-2">
            <Input placeholder="销售单号 / 客户名" value={kw} onChange={e => setKw(e.target.value)} className="flex-1" />
            <Button type="submit" size="sm" variant="outline">搜索</Button>
          </form>
          {sales.length > 0 && (
            <div className="max-h-48 overflow-auto rounded-md border">
              <table className="w-full text-sm">
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
                        <input type="radio" checked={picked === s.id} readOnly className="accent-primary" />
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
            <Label>超额原因（必填，审批人参考）</Label>
            <Input value={reason} onChange={e => setReason(e.target.value)} placeholder="如：客户为季度大促备货，预计回款快" maxLength={500} />
          </div>
        </div>
        <DialogFooter>
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
  const { mutate: reject } = useRejectCreditOverride()

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
    { key: 'overrideNo', title: '申请单号', width: 140, render: v => <span className="text-doc-code">{String(v)}</span> },
    { key: 'saleOrderNo', title: '销售单', width: 140, render: v => <span className="text-doc-code">{String(v)}</span> },
    { key: 'customerName', title: '客户', width: 110 },
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
    { key: 'applicantName', title: '申请人', width: 100 },
    { key: 'createdAt', title: '创建时间', width: 150, render: v => formatDisplayDateTime(v) },
    {
      key: 'id',
      title: '操作',
      width: 200,
      render: (_, row) => {
        const els: React.ReactNode[] = []
        if (row.status === 1) els.push(<Button key="submit" size="sm" variant="outline" onClick={() => submit(row.id, { onSuccess: () => toast.success('已提交审批'), onError: (e: Error) => toast.error(e.message) })}>提交</Button>)
        if (row.status === 2 && canApply) els.push(<Button key="ap" size="sm" variant="outline" onClick={() => approve(row.id, { onSuccess: () => toast.success('已批准'), onError: (e: Error) => toast.error(e.message) })}>批准</Button>)
        if (row.status === 2 && canApply) els.push(<Button key="rj" size="sm" variant="ghost" className="text-destructive" onClick={() => {
          const r = window.prompt('请填写驳回原因')
          if (r) reject({ id: row.id, reason: r }, { onSuccess: () => toast.success('已驳回'), onError: (e: Error) => toast.error(e.message) })
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
        description="客户授信不足时，销售员发起放行申请，走审批流；审批通过后该销售单占库自动放行，无需放行权限。"
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

      {isError && !data ? (
        <QueryErrorState error={error} onRetry={() => void refetch()} title="加载失败" compact />
      ) : (
        <DataTable columns={columns} data={list} loading={isLoading} rowKey="id" emptyText="暂无超额放行申请" />
      )}
      {total > 0 && <Pagination page={page} totalPages={Math.ceil(total / 20)} total={total} onPageChange={setPage} />}

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
