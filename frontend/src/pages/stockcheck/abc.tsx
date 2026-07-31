import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import PageHeader from '@/components/shared/PageHeader'
import DataTable from '@/components/shared/DataTable'
import { FilterCard } from '@/components/shared/FilterCard'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { SoftStatusLabel } from '@/components/shared/StatusBadge'
import { toast } from '@/lib/toast'
import { formatDisplayDateTime } from '@/lib/dateTime'
import { useWarehousesActive } from '@/hooks/useWarehouses'
import { usePermission } from '@/hooks/usePermission'
import { PERMISSIONS } from '@/lib/permission-codes'
import { getAbcListApi, recomputeAbcApi, getCycleRulesApi, saveCycleRulesApi } from '@/api/stockcheck'
import type { AbcClassRow, CycleRule } from '@/types/stockcheck'
import type { StatusTone } from '@/lib/statusTone'
import type { TableColumn } from '@/types'

const ABC_TONE: Record<string, StatusTone> = { A: 'warning', B: 'info', C: 'draft' }
const ABC_HINT: Record<string, string> = { A: '高周转 · 勤盘', B: '中周转', C: '低周转 · 稀盘' }

export default function AbcClassPage() {
  const { can } = usePermission()
  const canManage = can(PERMISSIONS.STOCKCHECK_ABC_MANAGE)
  const { data: warehouses } = useWarehousesActive()
  const qc = useQueryClient()
  const [tab, setTab] = useState<'abc' | 'rules'>('abc')
  // 0 = 全局默认（仅规则页有意义）；>0 = 具体仓库
  const [warehouseId, setWarehouseId] = useState(0)
  const [metricType, setMetricType] = useState('sold_value')
  const [windowDays, setWindowDays] = useState(90)

  // ── ABC 分类结果 ──
  const abcQ = useQuery({
    queryKey: ['abc-classes', warehouseId],
    queryFn: () => getAbcListApi({ warehouseId }),
    enabled: tab === 'abc' && warehouseId > 0,
  })
  const recompute = useMutation({
    mutationFn: () => recomputeAbcApi({ warehouseId, metricType, windowDays }),
    onSuccess: (r) => { toast.success(`已重算 ${r!.classified} 个商品的 ABC 分类`); qc.invalidateQueries({ queryKey: ['abc-classes', warehouseId] }) },
    onError: () => toast.error('重算失败'),
  })

  // ── 循环盘规则（可编辑草稿）──
  const rulesQ = useQuery({
    queryKey: ['cycle-rules', warehouseId],
    queryFn: () => getCycleRulesApi(warehouseId || undefined),
    enabled: tab === 'rules',
  })
  const [draft, setDraft] = useState<CycleRule[]>([])
  // 切仓/切数据时重置草稿（keepAlive 页面必须显式重置，避免残留上一仓的编辑）
  useEffect(() => { if (rulesQ.data?.rules) setDraft(rulesQ.data.rules.map(r => ({ ...r }))) }, [rulesQ.data])
  const saveRules = useMutation({
    mutationFn: () => saveCycleRulesApi({ warehouseId, rules: draft.map(r => ({ abcClass: r.abcClass, intervalDays: r.intervalDays, batchLimit: r.batchLimit, enabled: r.enabled })) }),
    onSuccess: () => { toast.success('循环盘规则已保存'); qc.invalidateQueries({ queryKey: ['cycle-rules', warehouseId] }) },
    onError: (e: unknown) => toast.error((e as { message?: string })?.message || '保存失败'),
  })
  const patchDraft = (cls: string, patch: Partial<CycleRule>) =>
    setDraft(prev => prev.map(r => r.abcClass === cls ? { ...r, ...patch } : r))

  const abcColumns: TableColumn<AbcClassRow>[] = [
    { key: 'abcClass', title: '类别', width: 130, render: (_, r) => <SoftStatusLabel label={`${r.abcClass} 类 · ${ABC_HINT[r.abcClass]}`} tone={ABC_TONE[r.abcClass] ?? 'info'} /> },
    { key: 'productName', title: '商品', render: (_, r) => <div><div>{r.productName}</div><div className="text-xs text-muted-foreground text-doc-code">{r.productCode}</div></div> },
    { key: 'metricValue', title: metricType === 'stock_value' ? '库存占用金额' : '出库消耗金额', width: 150, align: 'right', render: (v) => <span className="tabular-nums">{Number(v).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span> },
    { key: 'cumulativePct', title: '累计占比', width: 110, align: 'right', render: (v) => <span className="tabular-nums">{(Number(v) * 100).toFixed(2)}%</span> },
    { key: 'windowDays', title: '窗口', width: 80, align: 'right', render: (v) => <span className="tabular-nums">{Number(v)} 天</span> },
    { key: 'computedAt', title: '计算时间', width: 160, render: (v) => formatDisplayDateTime(String(v)) },
  ]

  const warehouseSelect = (
    <Select value={String(warehouseId)} onValueChange={(v) => setWarehouseId(Number(v))}>
      <SelectTrigger className="h-9 w-52"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="0">{tab === 'rules' ? '全局默认（所有仓库）' : '请选择仓库'}</SelectItem>
        {warehouses?.map(w => <SelectItem key={w.id} value={String(w.id)}>{w.name}</SelectItem>)}
      </SelectContent>
    </Select>
  )

  return (
    <div className="space-y-4">
      <PageHeader title="ABC 分类与循环盘规则" description="按出库消耗金额帕累托分档（A 勤盘 / B 中 / C 稀盘）；循环盘规则决定各类多久盘一次、单次抽多少。" />

      <div className="flex gap-2">
        <Button variant={tab === 'abc' ? 'default' : 'outline'} size="sm" onClick={() => setTab('abc')}>ABC 分类结果</Button>
        <Button variant={tab === 'rules' ? 'default' : 'outline'} size="sm" onClick={() => setTab('rules')}>循环盘规则</Button>
      </div>

      {tab === 'abc' ? (
        <>
          <FilterCard>
            {warehouseSelect}
            <Select value={metricType} onValueChange={setMetricType}>
              <SelectTrigger className="h-9 w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="sold_value">按出库消耗金额</SelectItem>
                <SelectItem value="stock_value">按库存占用金额</SelectItem>
              </SelectContent>
            </Select>
            {metricType === 'sold_value' && (
              <div className="flex items-center gap-1">
                <Input type="number" value={windowDays} onChange={(e) => setWindowDays(Number(e.target.value) || 90)} className="h-9 w-20 text-right tabular-nums" />
                <span className="text-sm text-muted-foreground">天窗口</span>
              </div>
            )}
            <Button size="sm" disabled={!canManage || warehouseId <= 0 || recompute.isPending} onClick={() => recompute.mutate()}>
              {recompute.isPending ? '重算中...' : '重算本仓 ABC'}
            </Button>
          </FilterCard>
          {warehouseId <= 0
            ? <div className="rounded-lg border border-dashed border-border p-10 text-center text-sm text-muted-foreground">请先选择一个仓库查看其 ABC 分类（ABC 按仓分类）</div>
            : <DataTable columns={abcColumns} data={abcQ.data ?? []} loading={abcQ.isLoading} />}
        </>
      ) : (
        <div className="space-y-4">
          <FilterCard>
            {warehouseSelect}
            <span className="text-sm text-muted-foreground">
              {warehouseId > 0 ? '编辑本仓覆盖规则（不填则继承全局默认）' : '编辑全局默认规则（适用于未单独设置的所有仓库）'}
            </span>
          </FilterCard>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">ABC 类别</th>
                  <th className="px-4 py-2 text-right font-medium">盘点周期（天）</th>
                  <th className="px-4 py-2 text-right font-medium">单次抽盘上限（SKU）</th>
                  <th className="px-4 py-2 text-center font-medium">启用</th>
                  <th className="px-4 py-2 text-left font-medium">来源</th>
                </tr>
              </thead>
              <tbody>
                {draft.map(r => (
                  <tr key={r.abcClass} className="border-t border-border">
                    <td className="px-4 py-3"><SoftStatusLabel label={`${r.abcClass} 类 · ${ABC_HINT[r.abcClass]}`} tone={ABC_TONE[r.abcClass] ?? 'info'} /></td>
                    <td className="px-4 py-2 text-right">
                      <Input type="number" value={r.intervalDays} disabled={!canManage} onChange={(e) => patchDraft(r.abcClass, { intervalDays: Number(e.target.value) || 0 })} className="ml-auto h-9 w-28 text-right tabular-nums" />
                    </td>
                    <td className="px-4 py-2 text-right">
                      <Input type="number" value={r.batchLimit} disabled={!canManage} onChange={(e) => patchDraft(r.abcClass, { batchLimit: Number(e.target.value) || 0 })} className="ml-auto h-9 w-28 text-right tabular-nums" />
                    </td>
                    <td className="px-4 py-3 text-center">
                      <input type="checkbox" checked={r.enabled} disabled={!canManage} onChange={(e) => patchDraft(r.abcClass, { enabled: e.target.checked })} className="h-4 w-4 accent-primary" />
                    </td>
                    <td className="px-4 py-3">
                      <SoftStatusLabel label={r.isOverride ? '本仓覆盖' : '继承默认'} tone={r.isOverride ? 'success' : 'draft'} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex justify-end">
            <Button disabled={!canManage || saveRules.isPending || !draft.length} onClick={() => saveRules.mutate()}>
              {saveRules.isPending ? '保存中...' : '保存规则'}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
