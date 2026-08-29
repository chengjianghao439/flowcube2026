import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import PageHeader from '@/components/shared/PageHeader'
import DataTable from '@/components/shared/DataTable'
import Pagination from '@/components/shared/Pagination'
import { FilterCard } from '@/components/shared/FilterCard'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { SoftStatusLabel } from '@/components/shared/StatusBadge'
import { QueryErrorState } from '@/components/shared/QueryErrorState'
import { toast } from '@/lib/toast'
import {
  listFixedAssetsApi, createFixedAssetApi, runDepreciationApi, disposeFixedAssetApi,
} from '@/api/fixedAssets'
import type { FixedAsset } from '@/api/fixedAssets'
import type { TableColumn } from '@/types'
import type { StatusTone } from '@/lib/statusTone'
import { downloadExport } from '@/lib/exportDownload'
import { todayYmd } from '@/lib/dateTime'

const money = (n: number | null | undefined) => `¥${Number(n ?? 0).toFixed(2)}`
const ASSET_STATUS: Record<number, { label: string; tone: StatusTone }> = {
  1: { label: '使用中', tone: 'active' },
  2: { label: '已提足', tone: 'success' },
  3: { label: '已处置', tone: 'danger' },
}

function CreateDialog({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const qc = useQueryClient()
  const [form, setForm] = useState({ assetName: '', category: '', departmentName: '', acquireDate: todayYmd(), originalCost: '', residualRate: '0.05', usefulMonths: '36' })
  const { mutate: create, isPending } = useMutation({
    mutationFn: createFixedAssetApi,
    onSuccess: (r) => { toast.success(`已创建固定资产 ${r.assetNo}`); onClose(); onSaved(); qc.invalidateQueries({ queryKey: ['fixed-assets'] }) },
    onError: (e: Error) => toast.error(e.message),
  })
  const set = (k: keyof typeof form) => (v: string) => setForm(prev => ({ ...prev, [k]: v }))
  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>新增固定资产</DialogTitle></DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1">
            <Label>资产名称 *</Label>
            <Input value={form.assetName} onChange={e => set('assetName')(e.target.value)} placeholder="如：联想台式机" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>类别</Label>
              <Input value={form.category} onChange={e => set('category')(e.target.value)} placeholder="电子设备" />
            </div>
            <div className="space-y-1">
              <Label>使用部门</Label>
              <Input value={form.departmentName} onChange={e => set('departmentName')(e.target.value)} placeholder="财务部" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>购置日期 *</Label>
              <Input type="date" value={form.acquireDate} onChange={e => set('acquireDate')(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>原值（元）*</Label>
              <Input type="number" value={form.originalCost} onChange={e => set('originalCost')(e.target.value)} placeholder="12000" className="text-right" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>残值率（默认 5%）</Label>
              <Input type="number" value={form.residualRate} onChange={e => set('residualRate')(e.target.value)} step="0.01" className="text-right" />
            </div>
            <div className="space-y-1">
              <Label>使用年限（月）*</Label>
              <Input type="number" value={form.usefulMonths} onChange={e => set('usefulMonths')(e.target.value)} className="text-right" />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            直线法月折旧 = 原值 × (1 − 残值率) ÷ 使用月数；购置当月开始计提。示例：12000×(1−5%)÷36 = ¥316.67/月。
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isPending}>取消</Button>
          <Button disabled={!form.assetName.trim() || !form.originalCost || !form.usefulMonths || isPending} onClick={() => create({
            assetName: form.assetName.trim(), category: form.category.trim() || null,
            departmentName: form.departmentName.trim() || null,
            acquireDate: form.acquireDate, originalCost: Number(form.originalCost),
            residualRate: Number(form.residualRate), usefulMonths: Number(form.usefulMonths),
          })}>{isPending ? '创建中…' : '创建'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function DisposeDialog({ asset, onClose }: { asset: FixedAsset | null; onClose: () => void }) {
  const qc = useQueryClient()
  const [form, setForm] = useState({ disposeType: '1', disposeDate: todayYmd(), income: '', expense: '' })
  const { mutate: dispose, isPending } = useMutation({
    mutationFn: (d: { disposeType: number; disposeDate: string; income: number; expense: number }) => disposeFixedAssetApi(asset!.id, d),
    onSuccess: (r) => { toast.success(`处置完成 ${r.disposeNo}，净损益 ${money(r.gain)}`); onClose(); qc.invalidateQueries({ queryKey: ['fixed-assets'] }) },
    onError: (e: Error) => toast.error(e.message),
  })
  if (!asset) return null
  return (
    <Dialog open onOpenChange={v => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>处置资产 · {asset.assetName}</DialogTitle></DialogHeader>
        <div className="space-y-3 py-2">
          <div className="rounded-md bg-muted/60 px-3 py-2 text-sm">
            账面净值 <span className="font-semibold">{money(asset.netBookValue)}</span>（累计折旧 {money(asset.accumDepr)}）
          </div>
          <div className="space-y-1">
            <Label>处置方式</Label>
            <select value={form.disposeType} onChange={e => setForm(p => ({ ...p, disposeType: e.target.value }))} className="h-10 w-full rounded-md border border-input bg-transparent px-3 text-sm">
              <option value="1">出售</option>
              <option value="2">报废</option>
            </select>
          </div>
          <div className="space-y-1">
            <Label>处置日期</Label>
            <Input type="date" value={form.disposeDate} onChange={e => setForm(p => ({ ...p, disposeDate: e.target.value }))} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>处置收入</Label>
              <Input type="number" value={form.income} onChange={e => setForm(p => ({ ...p, income: e.target.value }))} className="text-right" />
            </div>
            <div className="space-y-1">
              <Label>清理费用</Label>
              <Input type="number" value={form.expense} onChange={e => setForm(p => ({ ...p, expense: e.target.value }))} className="text-right" />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isPending}>取消</Button>
          <Button variant="destructive" disabled={isPending} onClick={() => dispose({ disposeType: Number(form.disposeType), disposeDate: form.disposeDate, income: Number(form.income) || 0, expense: Number(form.expense) || 0 })}>
            {isPending ? '处置中…' : '确认处置'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default function FixedAssetsPage() {
  const qc = useQueryClient()
  const [keyword, setKeyword] = useState('')
  const [applied, setApplied] = useState<{ keyword: string }>({ keyword: '' })
  const [page, setPage] = useState(1)
  const [createOpen, setCreateOpen] = useState(false)
  const [disposeTarget, setDisposeTarget] = useState<FixedAsset | null>(null)

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['fixed-assets', applied, page],
    queryFn: () => listFixedAssetsApi({ page, pageSize: 20, keyword: applied.keyword || undefined }),
  })
  const { mutate: runDepr, isPending: deprPending } = useMutation({
    mutationFn: runDepreciationApi,
    onSuccess: (r) => { toast.success(`计提完成：${r.ran} 张卡片，本期共计提折旧`); qc.invalidateQueries({ queryKey: ['fixed-assets'] }) },
    onError: (e: Error) => toast.error(e.message),
  })

  const list = data?.list ?? []
  const total = data?.pagination.total ?? 0

  const columns: TableColumn<FixedAsset>[] = [
    { key: 'assetNo', title: '资产编号', width: 120, render: v => <span className="text-doc-code">{String(v)}</span> },
    { key: 'assetName', title: '资产名称' },
    { key: 'category', title: '类别', width: 110, render: v => String(v || '—') },
    { key: 'departmentName', title: '使用部门', width: 110, render: v => String(v || '—') },
    { key: 'acquireDate', title: '购置日期', width: 110, render: v => String(v) },
    { key: 'originalCost', title: '原值', width: 110, align: 'right', render: v => <span className="tabular-nums">{money(v as number)}</span> },
    { key: 'monthlyDepr', title: '月折旧', width: 100, align: 'right', render: v => <span className="tabular-nums">{money(v as number)}</span> },
    { key: 'accumDepr', title: '累计折旧', width: 110, align: 'right', render: v => <span className="tabular-nums text-muted-foreground">{money(v as number)}</span> },
    { key: 'netBookValue', title: '账面净值', width: 110, align: 'right', render: v => <span className="tabular-nums font-medium">{money(v as number)}</span> },
    { key: 'status', title: '状态', width: 90, render: (_, r) => <SoftStatusLabel label={ASSET_STATUS[r.status]?.label ?? '未知'} tone={ASSET_STATUS[r.status]?.tone ?? 'draft'} /> },
    {
      key: 'id',
      title: '操作',
      width: 110,
      render: (_, r) => r.status === 1 ? (
        <Button size="sm" variant="outline" onClick={() => setDisposeTarget(r)}>处置</Button>
      ) : <span className="text-xs text-muted-foreground">—</span>,
    },
  ]

  return (
    <div className="space-y-4">
      <PageHeader
        title="固定资产"
        description="固定资产卡片、按月计提折旧（直线法）、处置/报废。折旧凭证自动生成并进入总账。"
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => downloadExport('/export/fixed-assets').catch(e => toast.error((e as Error).message))}>导出</Button>
            <Button variant="outline" disabled={deprPending} onClick={() => runDepr(undefined)}>{deprPending ? '计提中…' : '计提本月折旧'}</Button>
            <Button onClick={() => setCreateOpen(true)}>新增资产</Button>
          </div>
        }
      />

      <FilterCard>
        <Input placeholder="编号 / 名称 / 类别" value={keyword} onChange={e => setKeyword(e.target.value)} onKeyDown={e => e.key === 'Enter' && (setApplied({ keyword }), setPage(1))} className="w-56" />
        <Button size="sm" variant="outline" onClick={() => (setApplied({ keyword }), setPage(1))}>搜索</Button>
        <div className="ml-auto text-sm text-muted-foreground">共 <span className="font-semibold text-foreground">{total}</span> 项</div>
      </FilterCard>

      {isError && !data ? (
        <QueryErrorState error={error} onRetry={() => void refetch()} title="加载失败" compact />
      ) : (
        <DataTable columns={columns} data={list} loading={isLoading} rowKey="id" emptyText="暂无固定资产卡片" />
      )}
      {total > 0 && <Pagination page={page} totalPages={Math.ceil(total / 20)} total={total} onPageChange={setPage} />}

      <CreateDialog open={createOpen} onClose={() => setCreateOpen(false)} onSaved={() => refetch()} />
      <DisposeDialog asset={disposeTarget} onClose={() => setDisposeTarget(null)} />
    </div>
  )
}
