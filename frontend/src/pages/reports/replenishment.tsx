import { qty } from '@/lib/format'
import ListSummary from '@/components/shared/ListSummary'
import { ProcurementArrivalStatus } from '@/components/shared/ProcurementSupplyExplanation'
import ProcurementSupplyDetails from '@/components/shared/ProcurementSupplyDetails'
import { productIdentityColumns } from '@/components/shared/productIdentityColumns'
import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { X } from 'lucide-react'
import PageHeader from '@/components/shared/PageHeader'
import DataTable from '@/components/shared/DataTable'
import { Button } from '@/components/ui/button'
import { QueryErrorState } from '@/components/shared/QueryErrorState'
import { getReplenishmentApi, saveStockPoliciesApi, type ReplenishmentItem } from '@/api/inventory'
import { usePermission } from '@/hooks/usePermission'
import { useCategoryTree } from '@/hooks/useCategories'
import { PERMISSIONS } from '@/lib/permission-codes'
import { toast } from '@/lib/toast'
import ReplenishmentQueryDialog, { type ReplenishmentQueryValues } from './ReplenishmentQueryDialog'
import type { TableColumn } from '@/types'
import type { Category } from '@/types/categories'

/** 数量展示：整数带千分位，小数保留两位 */
// 数量统一走 lib/format 的 qty；这里只是把 unknown 收敛成它接受的类型
const fmtQty = (v: unknown) => qty(v as number | null | undefined)

export default function ReplenishmentPage() {
  const qc = useQueryClient()
  const { can } = usePermission()
  const canAdjustInventory = can(PERMISSIONS.INVENTORY_ADJUST)

  // 采纳「建议补货点」：把该行的建议补货点写回补货策略（仅更新 reorder_point，不覆盖 safety/target）
  const { mutate: adoptReorder } = useMutation({
    mutationFn: ({ row }: { row: ReplenishmentItem }) => saveStockPoliciesApi([
      { productId: row.productId, warehouseId: row.warehouseId, safetyStock: row.safetyStock, targetStock: row.targetStock, reorderPoint: Math.ceil(row.suggestReorderPoint) },
    ]),
    onSuccess: () => { toast.success('已采纳建议补货点'); qc.invalidateQueries({ queryKey: ['replenishment'] }) },
    onError: (e: Error) => toast.error(e.message),
  })

  const [queryOpen, setQueryOpen] = useState(false)
  // 筛选草稿（查询弹窗）与生效值分离：改草稿不触发请求，点「查询」才生效
  const [keyword, setKeyword] = useState('')
  const [warehouseId, setWarehouseId] = useState<number | null>(null)
  const [categoryId, setCategoryId] = useState<number | null>(null)
  const [applied, setApplied] = useState<{ keyword: string; warehouseId: number | null; categoryId: number | null }>({ keyword: '', warehouseId: null, categoryId: null })
  const { data: categoryTree = [] } = useCategoryTree()

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['replenishment', applied],
    queryFn: () => getReplenishmentApi({
      page: 1,
      pageSize: 500,
      keyword: applied.keyword || undefined,
      warehouseId: applied.warehouseId ?? undefined,
      categoryId: applied.categoryId ?? undefined,
    }),
  })

  const list = data?.list ?? []
  const total = data?.pagination?.total ?? 0

  const columns: TableColumn<ReplenishmentItem>[] = [
    ...productIdentityColumns(),
    { key: 'warehouseName', title: '仓库', width: 110 },
    { key: 'confirmedDemand', title: '未发销售', width: 100, align: 'right', render: v => fmtQty(v) },
    { key: 'netRequirement', title: '净需求', width: 90, align: 'right', render: v => fmtQty(v) },
    { key: 'provisionalCoverage', title: '计划/草稿覆盖', width: 150, align: 'right', render: v => fmtQty(v) },
    { key: 'available', title: '可用', width: 90, align: 'right', render: v => <span className="tabular-nums">{fmtQty(v)}</span> },
    { key: 'inTransit', title: '在途采购', width: 100, align: 'right', render: v => Number(v) > 0
        ? <span className="tabular-nums text-blue-600">{fmtQty(v)}</span>
        : <span className="tabular-nums text-muted-foreground">—</span> },
    { key: 'safetyStock', title: '安全库存', width: 100, align: 'right', render: v => <span className="tabular-nums text-muted-foreground">{fmtQty(v)}</span> },
    { key: 'reorderPoint', title: '补货点', width: 90, align: 'right', render: v => <span className="tabular-nums">{fmtQty(v)}</span> },
    {
      key: 'suggestReorderPoint',
      title: '建议补货点',
      width: 130,
      align: 'right',
      render: (_, r) => (
        <span className={`tabular-nums ${r.suggestReorderPoint > r.reorderPoint ? 'text-primary font-medium' : 'text-muted-foreground'}`}>
          {fmtQty(r.suggestReorderPoint)}
          <span className="ml-1 text-xs font-normal text-muted-foreground">(ADU {fmtQty(r.adu)}×{r.leadTimeDays}天)</span>
        </span>
      ),
    },
    { key: 'suggestQty', title: '建议采购量', width: 120, align: 'right', render: (v, r) => (
        <span className="tabular-nums font-semibold text-primary">{fmtQty(v)}<span className="ml-1 text-xs font-normal text-muted-foreground">{r.unit}</span></span>
      ) },
    { key: 'earliestDemandDate', title: '交期核对', width: 180, render: (_, r) => <ProcurementArrivalStatus supply={r} /> },
    { key: 'id', title: '操作', width: 240, render: (_, r) => <div className="flex gap-2"><ProcurementSupplyDetails supply={r} mode="replenishment" />{canAdjustInventory && Math.round(r.suggestReorderPoint) !== Math.round(r.reorderPoint) && <Button size="sm" variant="outline" onClick={() => adoptReorder({ row: r })}>采纳补货点</Button>}</div> },
  ]

  // 查询弹窗初始值
  const initialQuery = useMemo<ReplenishmentQueryValues>(() => ({
    keyword, warehouseId, warehouseName: '', categoryId,
  }), [keyword, warehouseId, categoryId])
  function applyQuery(v: ReplenishmentQueryValues) {
    setKeyword(v.keyword)
    setWarehouseId(v.warehouseId)
    setCategoryId(v.categoryId)
    setApplied({ keyword: v.keyword, warehouseId: v.warehouseId, categoryId: v.categoryId })
    setQueryOpen(false)
  }
  function reset() {
    setKeyword(''); setWarehouseId(null); setCategoryId(null)
    setApplied({ keyword: '', warehouseId: null, categoryId: null })
  }

  function findCatName(nodes: Category[], id: number): string | null {
    for (const n of nodes) {
      if (n.id === id) return n.name
      if (n.children?.length) {
        const found = findCatName(n.children, id)
        if (found) return found
      }
    }
    return null
  }

  // 当前生效筛选摘要（可逐项移除）
  const chips = [
    applied.keyword && { key: 'keyword', label: `关键字：${applied.keyword}`, onRemove: () => { setKeyword(''); setApplied(a => ({ ...a, keyword: '' })) } },
    applied.warehouseId && { key: 'warehouse', label: `仓库：${applied.warehouseId}`, onRemove: () => { setWarehouseId(null); setApplied(a => ({ ...a, warehouseId: null })) } },
    applied.categoryId && { key: 'category', label: `分类：${findCatName(categoryTree, applied.categoryId) ?? applied.categoryId}`, onRemove: () => { setCategoryId(null); setApplied(a => ({ ...a, categoryId: null })) } },
  ].filter(Boolean) as { key: string; label: string; onRemove: () => void }[]

  return (
    <div className="space-y-4">
      <PageHeader
        title="补货建议"
        description="按未发销售、实物与预计采购计算缺口；已有计划和采购草稿分别覆盖。起订与整包装规则决定最终采购量。"
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => setQueryOpen(true)}>查询</Button>

            <Button variant="outline" onClick={() => refetch()}>立即刷新</Button>
          </div>
        }
      />


      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {chips.map(c => (
            <span key={c.key} className="inline-flex items-center gap-1 rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">
              {c.label}
              <button type="button" onClick={c.onRemove} className="text-muted-foreground/70 hover:text-foreground" aria-label={`移除「${c.label}」`}>
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
          <Button size="sm" variant="ghost" onClick={reset}>清空</Button>
        </div>
      )}

      {isError && !data ? (
        <QueryErrorState
          error={error}
          onRetry={() => void refetch()}
          title="补货建议加载失败"
          description="补货建议数据暂时无法加载，请点击重试或稍后再试"
          compact
        />
      ) : (
        <DataTable
          columns={columns}
          data={list}
          loading={isLoading}
          rowKey="id"
          emptyText="暂无待补货商品（所有商品的可用 + 在途都在补货点之上，或已有单据覆盖需求）"
        />
      )}

      {!isError && !isLoading && data && <ListSummary total={total} unit="项待补货" />}


      <ReplenishmentQueryDialog
        open={queryOpen}
        initial={initialQuery}
        onClose={() => setQueryOpen(false)}
        onApply={applyQuery}
      />
    </div>
  )
}
