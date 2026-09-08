import KeepAliveSection from '@/components/shared/KeepAliveSection'
import { useActiveWorkspaceTab } from '@/hooks/useActiveWorkspaceTab'
import { confirmAction } from '@/lib/confirm'
import { productIdentityColumns } from '@/components/shared/productIdentityColumns'
import { useContext, useState, useEffect } from 'react'
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
import { downloadExport } from '@/lib/exportDownload'
import { useWarehousesActive } from '@/hooks/useWarehouses'
import { usePermission } from '@/hooks/usePermission'
import { useDirtyGuard } from '@/hooks/useDirtyGuard'
import { PERMISSIONS } from '@/lib/permission-codes'
import { TabPathContext } from '@/components/layout/TabPathContext'
import { getAbcListApi, recomputeAbcApi, getCycleRulesApi, saveCycleRulesApi, getCoverageApi } from '@/api/stockcheck'
import type { AbcClassRow, CycleRule, CoverageRow } from '@/types/stockcheck'
import type { StatusTone } from '@/lib/statusTone'
import type { TableColumn } from '@/types'

const ABC_TONE: Record<string, StatusTone> = { A: 'warning', B: 'info', C: 'draft' }
const ABC_HINT: Record<string, string> = { A: '卖得快 · 盘得勤', B: '卖得中等', C: '卖得慢 · 盘得少' }

function sameRules(a: CycleRule[], b: CycleRule[]) {
  return a.length === b.length && a.every((r, i) => {
    const other = b[i]
    return r.abcClass === other.abcClass && Number(r.intervalDays) === Number(other.intervalDays)
      && Number(r.batchLimit) === Number(other.batchLimit) && !!r.enabled === !!other.enabled
  })
}

export default function AbcClassPage() {
  const active = useActiveWorkspaceTab()
  const { can } = usePermission()
  const canManage = can(PERMISSIONS.STOCKCHECK_ABC_MANAGE)
  const { data: warehouses } = useWarehousesActive()
  const qc = useQueryClient()
  const [tab, setTab] = useState<'abc' | 'rules' | 'coverage'>('abc')
  // 0 = 全局默认（仅规则页有意义）；>0 = 具体仓库
  const [warehouseId, setWarehouseId] = useState(0)
  const [metricType, setMetricType] = useState('sold_value')
  const [windowDays, setWindowDays] = useState(90)

  // ── 商品分档结果 ──
  const abcQ = useQuery({
    queryKey: ['abc-classes', warehouseId],
    queryFn: () => getAbcListApi({ warehouseId }),
    enabled: active && tab === 'abc' && warehouseId > 0,
  })
  const recompute = useMutation({
    mutationFn: () => recomputeAbcApi({ warehouseId, metricType, windowDays }, { skipGlobalError: true }),
    onSuccess: (r) => { toast.success(`已重算 ${r!.classified} 个商品的分档`); qc.invalidateQueries({ queryKey: ['abc-classes', warehouseId] }) },
    onError: () => toast.error('重算失败'),
  })

  // ── 分批盘规则（可编辑草稿）──
  const rulesQ = useQuery({
    queryKey: ['cycle-rules', warehouseId],
    queryFn: () => getCycleRulesApi(warehouseId || undefined),
    enabled: active && tab === 'rules',
  })
  const [ruleDraft, setRuleDraft] = useState<{ warehouseId: number; baseline: CycleRule[]; rules: CycleRule[] }>({ warehouseId: 0, baseline: [], rules: [] })
  const draft = ruleDraft.warehouseId === warehouseId ? ruleDraft.rules : []
  const hasUnsavedRules = !sameRules(ruleDraft.rules, ruleDraft.baseline)
  // 切仓重新取基线；同仓刷新只更新未编辑草稿，不能覆盖用户输入。
  useEffect(() => {
    if (!rulesQ.data?.rules) return
    setRuleDraft(prev => {
      if (prev.warehouseId === warehouseId && !sameRules(prev.rules, prev.baseline)) return prev
      return { warehouseId, baseline: rulesQ.data.rules, rules: rulesQ.data.rules.map(r => ({ ...r })) }
    })
  }, [rulesQ.data, warehouseId])
  const saveRules = useMutation({
    mutationFn: (submitted: { warehouseId: number; rules: CycleRule[] }) => saveCycleRulesApi({ warehouseId: submitted.warehouseId, rules: submitted.rules.map(r => ({ abcClass: r.abcClass, intervalDays: r.intervalDays, batchLimit: r.batchLimit, enabled: r.enabled })) }, { skipGlobalError: true }),
    onSuccess: (_result, submitted) => {
      toast.success('分批盘点规则已保存')
      qc.setQueryData(['cycle-rules', submitted.warehouseId], { rules: submitted.rules })
      setRuleDraft(prev => prev.warehouseId === submitted.warehouseId ? { ...prev, baseline: submitted.rules } : prev)
      qc.invalidateQueries({ queryKey: ['cycle-rules', submitted.warehouseId] })
    },
    onError: (e: unknown) => toast.error((e as { message?: string })?.message || '保存失败'),
  })
  const patchDraft = (cls: string, patch: Partial<CycleRule>) =>
    setRuleDraft(prev => ({ ...prev, rules: prev.rules.map(r => r.abcClass === cls ? { ...r, ...patch } : r) }))

  // 未保存规则属于整个大页面，切换内部页签也保留关闭保护。
  const tabPath = useContext(TabPathContext) || ''
  const isDirty = canManage && hasUnsavedRules
  useDirtyGuard(tabPath, isDirty)

  // ── 按期盘点率看板（文档08）──
  const coverageQ = useQuery({
    queryKey: ['cycle-coverage'],
    queryFn: () => getCoverageApi({}),
    enabled: active && tab === 'coverage',
  })
  const coverageRows = (coverageQ.data ?? []).filter(r => warehouseId <= 0 || r.warehouseId === warehouseId)

  const coverageColumns: TableColumn<CoverageRow>[] = [
    { key: 'warehouseName', title: '仓库', width: 150 },
    { key: 'abcClass', title: '档位', width: 120, render: (_, r) => <SoftStatusLabel label={`${r.abcClass} 类`} tone={ABC_TONE[r.abcClass] ?? 'info'} /> },
    { key: 'totalItems', title: '应盘商品', width: 100, align: 'right', render: (v) => <span className="tabular-nums">{Number(v)}</span> },
    { key: 'dueItems', title: '到期未盘', width: 100, align: 'right', render: (_, r) => <span className={`tabular-nums ${r.dueItems > 0 ? 'text-destructive font-semibold' : 'text-muted-foreground'}`}>{r.dueItems}</span> },
    {
      key: 'coverageRate',
      title: '按期盘点率',
      width: 160,
      render: (_, r) => {
        const tone = r.coverageRate >= 80 ? 'success' : (r.coverageRate >= 50 ? 'warning' : 'danger')
        return (
          <div className="flex items-center gap-2">
            <div className="h-2 w-28 overflow-hidden rounded-full bg-muted">
              <div className={`h-full rounded-full bg-${tone}`} style={{ width: `${Math.min(100, r.coverageRate)}%` }} />
            </div>
            <span className={`tabular-nums text-sm ${tone === 'success' ? 'text-emerald-600' : tone === 'warning' ? 'text-amber-600' : 'text-red-600'}`}>{r.coverageRate}%</span>
          </div>
        )
      },
    },
  ]

  const abcColumns: TableColumn<AbcClassRow>[] = [
    { key: 'abcClass', title: '类别', width: 130, render: (_, r) => <SoftStatusLabel label={`${r.abcClass} 类 · ${ABC_HINT[r.abcClass]}`} tone={ABC_TONE[r.abcClass] ?? 'info'} /> },
    ...productIdentityColumns(),
    { key: 'metricValue', title: metricType === 'stock_value' ? '库存占用金额' : '出库消耗金额', width: 150, align: 'right', render: (v) => <span className="tabular-nums">{Number(v).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span> },
    { key: 'cumulativePct', title: '累计占比', width: 110, align: 'right', render: (v) => <span className="tabular-nums">{(Number(v) * 100).toFixed(2)}%</span> },
    { key: 'windowDays', title: '统计天数', width: 80, align: 'right', render: (v) => <span className="tabular-nums">{Number(v)} 天</span> },
    { key: 'computedAt', title: '计算时间', width: 160, render: (v) => formatDisplayDateTime(String(v)) },
  ]

  const warehouseSelect = (
    <Select value={String(warehouseId)} onValueChange={(v) => {
      const nextWarehouseId = Number(v)
      if (nextWarehouseId === warehouseId) return
      const changeWarehouse = () => {
        setRuleDraft({ warehouseId: nextWarehouseId, baseline: [], rules: [] })
        setWarehouseId(nextWarehouseId)
      }
      if (hasUnsavedRules) confirmAction({ title: '切换仓库', description: '当前规则有未保存的修改，切换仓库将丢弃这些修改。', confirmText: '丢弃并切换', onConfirm: changeWarehouse })
      else changeWarehouse()
    }}>
      <SelectTrigger className="h-9 w-52"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="0">{tab === 'rules' ? '全局默认（所有仓库）' : '请选择仓库'}</SelectItem>
        {warehouses?.map(w => <SelectItem key={w.id} value={String(w.id)}>{w.name}</SelectItem>)}
      </SelectContent>
    </Select>
  )

  return (
    <div className="space-y-4">
      <PageHeader
        title="商品分档与分批盘点规则"
        description="按出库消耗金额分档（A 卖得多盘得频繁 / B 中等 / C 卖得少盘得少）；分批盘点规则决定各档位多久盘一次、单次盘多少。"
        actions={<Button variant="outline" onClick={() => downloadExport('/export/abc').catch(e => toast.error((e as Error).message))}>导出</Button>}
      />

      <div className="flex gap-2">
        <Button variant={tab === 'abc' ? 'default' : 'outline'} size="sm" onClick={() => setTab('abc')}>商品分档结果</Button>
        <Button variant={tab === 'rules' ? 'default' : 'outline'} size="sm" onClick={() => setTab('rules')}>分批盘点规则</Button>
        <Button variant={tab === 'coverage' ? 'default' : 'outline'} size="sm" onClick={() => setTab('coverage')}>按期盘点率</Button>
      </div>

      <KeepAliveSection active={tab === 'abc'} className="space-y-4">
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
                <span className="text-sm text-muted-foreground">统计天数</span>
              </div>
            )}
            <Button size="sm" disabled={!canManage || warehouseId <= 0 || recompute.isPending} onClick={() => recompute.mutate()}>
              {recompute.isPending ? '重算中…' : '重算本仓分档'}
            </Button>
          </FilterCard>
          {warehouseId <= 0
            ? <div className="rounded-lg border border-dashed border-border p-10 text-center text-sm text-muted-foreground">请先选择一个仓库查看其商品分档（分档按仓划分）</div>
            : <DataTable columns={abcColumns} data={abcQ.data ?? []} loading={abcQ.isLoading} />}
      </KeepAliveSection>
      <KeepAliveSection active={tab === 'rules'} className="space-y-4">
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
                  <th className="px-4 py-2 text-left font-medium">档位</th>
                  <th className="px-4 py-2 text-right font-medium">盘点周期（天）</th>
                  <th className="px-4 py-2 text-right font-medium">单次上限（SKU）</th>
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
            <Button disabled={!canManage || saveRules.isPending || !draft.length} onClick={() => saveRules.mutate({ warehouseId, rules: draft.map(r => ({ ...r })) })}>
              {saveRules.isPending ? '保存中…' : '保存规则'}
            </Button>
          </div>
      </KeepAliveSection>
      <KeepAliveSection active={tab === 'coverage'} className="space-y-4">
          <FilterCard>
            {warehouseSelect}
            <span className="text-sm text-muted-foreground">按「距上次盘点的天数超过该档位的周期」判定到期；按期盘点率 = 已按期盘 / 应盘。</span>
          </FilterCard>
          <DataTable columns={coverageColumns} data={coverageRows} loading={coverageQ.isLoading} rowKey="rowKey" emptyText="暂无按期盘点数据（先运行一次分档重算）" />
      </KeepAliveSection>
    </div>
  )
}
