import TableActionsMenu from '@/components/shared/TableActionsMenu'
import { useCompanyQueryKey } from '@/hooks/useCompanyQueryKey'
import { usePermission } from '@/hooks/usePermission'
import { PERMISSIONS } from '@/lib/permission-codes'
import { DatePicker } from '@/components/shared/DatePicker'
import { money } from '@/lib/format'
import { RecordIdentity } from '@/components/shared/RecordIdentity'
import { useEffect, useId, useRef, useState } from 'react'
import { useCompanyStore } from '@/store/companyStore'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import PageHeader from '@/components/shared/PageHeader'
import DataTable from '@/components/shared/DataTable'
import ListSummary from '@/components/shared/ListSummary'
import { KeywordQueryDialog, KeywordQueryChips } from '@/components/shared/KeywordQueryDialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { SoftStatusLabel } from '@/components/shared/StatusBadge'
import { QueryErrorState } from '@/components/shared/QueryErrorState'
import { toast } from '@/lib/toast'
import {
  listFixedAssetsApi, createFixedAssetApi, runDepreciationApi, disposeFixedAssetApi,
} from '@/api/fixedAssets'
import type { DisposeFixedAssetParams, FixedAsset } from '@/api/fixedAssets'
import type { TableColumn } from '@/types'
import type { StatusTone } from '@/lib/statusTone'
import { downloadExport } from '@/lib/exportDownload'
import { beijingPeriod, todayYmd } from '@/lib/dateTime'

const ASSET_STATUS: Record<number, { label: string; tone: StatusTone }> = {
  1: { label: '使用中', tone: 'active' },
  2: { label: '已提足', tone: 'success' },
  3: { label: '已处置', tone: 'danger' },
}

function CreateDialog({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const qc = useQueryClient()
  const fieldId = useId()
  const [form, setForm] = useState({ assetName: '', category: '', departmentName: '', acquireDate: todayYmd(), originalCost: '', residualRate: '0.05', usefulMonths: '36' })
  const [rateBadInput, setRateBadInput] = useState(false)
  const { mutate: create, isPending } = useMutation({
    mutationFn: createFixedAssetApi,
    onSuccess: (r) => { toast.success(`已创建固定资产 ${r.assetNo}`); onClose(); onSaved(); qc.invalidateQueries({ queryKey: ['fixed-assets'] }) },
    onError: (e: Error) => toast.error(e.message),
  })
  const set = (k: keyof typeof form) => (v: string) => setForm(prev => ({ ...prev, [k]: v }))
  const originalCost = Number(form.originalCost)
  const residualRate = Number(form.residualRate)
  const usefulMonths = Number(form.usefulMonths)
  const costError = !Number.isFinite(originalCost) || originalCost <= 0
  const showCostError = form.originalCost !== '' && costError
  const rateError = rateBadInput || !Number.isFinite(residualRate) || residualRate < 0 || residualRate > 0.9999
  const monthsError = !Number.isInteger(usefulMonths) || usefulMonths < 1 || usefulMonths > 600
  const canCreate = !!form.assetName.trim() && !costError && !rateError && !monthsError && !isPending

  function submit() {
    if (!canCreate) return
    create({
      assetName: form.assetName.trim(), category: form.category.trim() || null,
      departmentName: form.departmentName.trim() || null,
      acquireDate: form.acquireDate, originalCost, residualRate, usefulMonths,
    })
  }

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="fc-form-dialog sm:max-w-3xl">
        <DialogHeader description="直线法月折旧 = 原值 × (1 − 残值率) ÷ 使用月数；购置当月开始计提。示例：12000×(1−5%)÷36 = ¥316.67/月。"><DialogTitle>新增固定资产</DialogTitle></DialogHeader>
        <div className="fc-form-dialog-body space-y-3 py-2">
          <div className="space-y-1">
            <Label>资产名称 *</Label>
            <Input aria-label="资产名称" value={form.assetName} onChange={e => set('assetName')(e.target.value)} placeholder="如：联想台式机" />
          </div>
          <div className="grid grid-cols-2 gap-x-5 gap-y-4">
            <div className="space-y-1">
              <Label>类别</Label>
              <Input aria-label="类别" value={form.category} onChange={e => set('category')(e.target.value)} placeholder="电子设备" />
            </div>
            <div className="space-y-1">
              <Label>使用部门</Label>
              <Input aria-label="使用部门" value={form.departmentName} onChange={e => set('departmentName')(e.target.value)} placeholder="财务部" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-x-5 gap-y-4">
            <div className="space-y-1">
              <Label>购置日期 *</Label>
              <DatePicker aria-label="购置日期" value={form.acquireDate} onChange={v => set('acquireDate')(v)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`${fieldId}-cost`}>原值（元）<span aria-hidden="true">*</span></Label>
              <Input id={`${fieldId}-cost`} type="number" step="any" aria-required="true"
                aria-invalid={showCostError || undefined}
                aria-describedby={showCostError ? `${fieldId}-cost-error` : undefined}
                value={form.originalCost} onChange={e => set('originalCost')(e.target.value)} placeholder="12000" className="text-right" />
              {showCostError && <p id={`${fieldId}-cost-error`} className="text-xs text-destructive-ink" role="alert">原值必须大于 0</p>}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-x-5 gap-y-4">
            <div className="space-y-1">
              <Label htmlFor={`${fieldId}-rate`}>残值率</Label>
              <Input id={`${fieldId}-rate`} type="number" min="0" max="0.9999" step="0.0001"
                aria-invalid={rateError || undefined} aria-describedby={`${fieldId}-rate-hint`}
                onInput={event => setRateBadInput(event.currentTarget.validity.badInput)}
                value={form.residualRate} onChange={e => set('residualRate')(e.target.value)} className="text-right" />
              <p id={`${fieldId}-rate-hint`} role={rateError ? 'alert' : undefined}
                className={rateError ? 'text-xs text-destructive-ink' : 'text-xs text-muted-foreground'}>
                {rateError ? '残值率必须在 0 至 0.9999 之间' : '输入 0 至 0.9999 的数值。默认 0.05 表示 5%。'}
              </p>
            </div>
            <div className="space-y-1">
              <Label htmlFor={`${fieldId}-months`}>使用年限（月）<span aria-hidden="true">*</span></Label>
              <Input id={`${fieldId}-months`} type="number" min="1" max="600" step="1" aria-required="true"
                aria-invalid={monthsError || undefined} aria-describedby={monthsError ? `${fieldId}-months-error` : undefined}
                value={form.usefulMonths} onChange={e => set('usefulMonths')(e.target.value)} className="text-right" />
              {monthsError && <p id={`${fieldId}-months-error`} className="text-xs text-destructive-ink" role="alert">使用年限必须为 1 至 600 的整数月</p>}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isPending}>取消</Button>
          <Button disabled={!canCreate} onClick={submit}>{isPending ? '创建中…' : '创建'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

interface DisposalTarget {
  companyId: number
  asset: FixedAsset
  opening: number
}

function DisposeDialog({ target, isCurrent, onClose }: {
  target: DisposalTarget
  isCurrent: () => boolean
  onClose: () => void
}) {
  const { asset, companyId } = target
  const qc = useQueryClient()
  const fieldId = useId()
  const submitting = useRef(false)
  const [form, setForm] = useState(() => ({ disposeType: '1', disposeDate: todayYmd(), income: '', expense: '' }))
  const { mutate: dispose, isPending } = useMutation({
    mutationFn: (data: DisposeFixedAssetParams) => disposeFixedAssetApi(asset.id, data, companyId),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['fixed-assets', companyId] }) },
  })

  const requestClose = () => {
    if (!submitting.current && isCurrent()) onClose()
  }
  const submit = () => {
    if (submitting.current || !isCurrent()) return
    submitting.current = true
    dispose({
      disposeType: Number(form.disposeType), disposeDate: form.disposeDate,
      income: Number(form.income) || 0, expense: Number(form.expense) || 0,
    }, {
      onSuccess: (r) => {
        if (!isCurrent()) return
        toast.success(`处置完成 ${r.disposeNo}，净损益 ${money(r.gain)}`)
        onClose()
      },
      onError: (error) => { if (isCurrent()) toast.error(error.message) },
      onSettled: () => { submitting.current = false },
    })
  }
  return (
    <Dialog open onOpenChange={v => { if (!v) requestClose() }}>
      <DialogContent aria-busy={isPending} className="fc-form-dialog sm:max-w-2xl">
        <DialogHeader><DialogTitle>处置资产 · {asset.assetName}</DialogTitle></DialogHeader>
        <div className="fc-form-dialog-body space-y-3 py-2">
          <div className="rounded-md bg-muted/60 px-3 py-2 text-sm">
            账面净值 <span className="font-semibold">{money(asset.netBookValue)}</span>（累计折旧 {money(asset.accumDepr)}）
          </div>
          <div className="space-y-1">
            <Label htmlFor={`${fieldId}-type`}>处置方式</Label>
            <Select disabled={isPending} value={form.disposeType} onValueChange={disposeType => setForm(p => ({ ...p, disposeType }))}>
              <SelectTrigger id={`${fieldId}-type`} className="h-9 min-h-9 py-1.5"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="1">出售</SelectItem>
                <SelectItem value="2">报废</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor={`${fieldId}-date`}>处置日期</Label>
            <DatePicker id={`${fieldId}-date`} disabled={isPending} value={form.disposeDate} onChange={v => setForm(p => ({ ...p, disposeDate: v }))} className="h-9" />
          </div>
          <div className="grid grid-cols-2 gap-x-5 gap-y-4">
            <div className="space-y-1">
              <Label htmlFor={`${fieldId}-income`}>处置收入</Label>
              <Input id={`${fieldId}-income`} disabled={isPending} type="number" value={form.income} onChange={e => setForm(p => ({ ...p, income: e.target.value }))} className="h-9 text-right" />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`${fieldId}-expense`}>清理费用</Label>
              <Input id={`${fieldId}-expense`} disabled={isPending} type="number" value={form.expense} onChange={e => setForm(p => ({ ...p, expense: e.target.value }))} className="h-9 text-right" />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={requestClose} disabled={isPending}>取消</Button>
          <Button variant="destructive" disabled={isPending} onClick={submit}>
            {isPending ? '处置中…' : '确认处置'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default function FixedAssetsPage() {
  const qc = useQueryClient()
  const { can } = usePermission()
  const canManage = can(PERMISSIONS.ACCOUNTING_VOUCHER_MANAGE)
  const managePermission = useRef(canManage)
  managePermission.current = canManage
  const [queryOpen, setQueryOpen] = useState(false)
  const [applied, setApplied] = useState<{ keyword: string }>({ keyword: '' })
  const [createOpen, setCreateOpen] = useState(false)
  const companyId = useCompanyStore(state => state.companyId)
  const [disposeTarget, setDisposeTarget] = useState<DisposalTarget | null>(null)
  const currentTarget = useRef<DisposalTarget | null>(null)
  const nextOpening = useRef(0)

  useEffect(() => useCompanyStore.subscribe((current, previous) => {
    if (current.companyId === previous.companyId) return
    currentTarget.current = null
    setDisposeTarget(null)
  }), [])

  useEffect(() => {
    if (canManage) return
    setCreateOpen(false)
    currentTarget.current = null
    setDisposeTarget(null)
  }, [canManage])

  const openDisposal = (asset: FixedAsset) => {
    if (!managePermission.current || currentTarget.current || useCompanyStore.getState().companyId !== companyId) return
    const target = { asset, companyId, opening: ++nextOpening.current }
    currentTarget.current = target
    setDisposeTarget(target)
  }
  const isCurrent = (target: DisposalTarget) =>
    managePermission.current && currentTarget.current === target && useCompanyStore.getState().companyId === target.companyId
  const closeDisposal = (target: DisposalTarget) => {
    if (!isCurrent(target)) return
    currentTarget.current = null
    setDisposeTarget(null)
  }

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: useCompanyQueryKey(['fixed-assets', applied]),
    queryFn: () => listFixedAssetsApi({ page: 1, pageSize: 20, keyword: applied.keyword || undefined }),
  })
  const { mutate: runDepr, isPending: deprPending } = useMutation({
    mutationFn: runDepreciationApi,
    onSuccess: (r) => {
      // 金额取 vouchers 合计：后端只在未跳过的资产上 push，与 ran 一一对应
      const total = r.vouchers.reduce((sum, v) => sum + v.monthly, 0)
      toast.success(r.ran === 0
        ? '本期没有需要计提折旧的卡片'
        : `计提完成：${r.ran} 张卡片，本期共计提折旧 ${money(total)}`)
      qc.invalidateQueries({ queryKey: ['fixed-assets'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const list = data?.list ?? []
  const total = data?.pagination.total ?? 0

  const columns: TableColumn<FixedAsset>[] = [
    { key: 'assetNo', title: '固定资产 / 编号', width: 280, render: (_, r) => <RecordIdentity title={r.assetName || '—'} code={r.assetNo} /> },
    { key: 'category', title: '类别', width: 110, render: v => String(v || '—') },
    { key: 'departmentName', title: '使用部门', width: 110, render: v => String(v || '—') },
    { key: 'acquireDate', title: '购置日期', width: 110, render: v => <span className="whitespace-nowrap">{String(v)}</span> },
    { key: 'originalCost', title: '原值', width: 110, align: 'right', render: v => <span className="tabular-nums">{money(v as number)}</span> },
    { key: 'monthlyDepr', title: '月折旧', width: 100, align: 'right', render: v => <span className="tabular-nums">{money(v as number)}</span> },
    { key: 'accumDepr', title: '累计折旧', width: 110, align: 'right', render: v => <span className="tabular-nums text-muted-foreground">{money(v as number)}</span> },
    { key: 'netBookValue', title: '账面净值', width: 110, align: 'right', render: v => <span className="tabular-nums font-medium">{money(v as number)}</span> },
    { key: 'status', title: '状态', width: 90, render: (_, r) => <SoftStatusLabel label={ASSET_STATUS[r.status]?.label ?? '未知'} tone={ASSET_STATUS[r.status]?.tone ?? 'draft'} /> },
  ]
  if (canManage) {
    columns.push({
      key: 'id',
      title: '操作',
      width: 110,
      render: (_, r) => (r.status === 1 || r.status === 2) ? (
        <TableActionsMenu primaryVariant="outline" primaryLabel="处置" onPrimaryClick={() => openDisposal(r)} items={[]} />
      ) : <span className="text-xs text-muted-foreground">—</span>,
    })
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="固定资产"
        description={canManage ? '管理固定资产卡片、月度折旧与处置。' : '查看固定资产、折旧及账面净值。'}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => downloadExport('/export/fixed-assets', applied.keyword ? { keyword: applied.keyword } : undefined).catch(e => toast.error((e as Error).message))}>导出 Excel</Button>
            <Button variant="outline" onClick={() => setQueryOpen(true)}>查询</Button>
            {canManage && <>
              <Button variant="outline" disabled={deprPending} onClick={() => runDepr(beijingPeriod())}>{deprPending ? '计提中…' : '计提本月折旧'}</Button>
              <Button onClick={() => setCreateOpen(true)}>新增资产</Button>
            </>}
          </div>
        }
      />


      <KeywordQueryDialog open={queryOpen} dialogId="fixed-assets-query" title="查询固定资产" initial={applied.keyword} label="搜索固定资产" placeholder="编号 / 名称 / 类别"
        onClose={() => setQueryOpen(false)} onApply={keyword => setApplied({ keyword })} />
      <KeywordQueryChips keyword={applied.keyword} onClear={() => setApplied({ keyword: '' })} />

      {isError && !data ? (
        <QueryErrorState error={error} onRetry={() => void refetch()} title="加载失败" />
      ) : (
        <DataTable fluid columnStorageKey="fixed-assets" scrollLabel="固定资产表格" virtualized columns={columns} data={list} loading={isLoading} rowKey="id" emptyText="暂无固定资产卡片" />
      )}
      {data && !isError && !isLoading && <ListSummary total={total} />}

      {canManage && <CreateDialog open={createOpen} onClose={() => setCreateOpen(false)} onSaved={() => refetch()} />}
      {canManage && disposeTarget?.companyId === companyId && (
        <DisposeDialog
          key={disposeTarget.opening}
          target={disposeTarget}
          isCurrent={() => isCurrent(disposeTarget)}
          onClose={() => closeDisposal(disposeTarget)}
        />
      )}
    </div>
  )
}
