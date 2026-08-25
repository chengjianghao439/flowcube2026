import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { X } from 'lucide-react'
import PageHeader from '@/components/shared/PageHeader'
import DataTable from '@/components/shared/DataTable'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { QueryErrorState } from '@/components/shared/QueryErrorState'
import { getReplenishmentApi, saveStockPoliciesApi, type ReplenishmentItem } from '@/api/inventory'
import { createRequisitionApi } from '@/api/purchase-requisitions'
import { usePermission } from '@/hooks/usePermission'
import { useCategoryTree } from '@/hooks/useCategories'
import { PERMISSIONS } from '@/lib/permission-codes'
import { toast } from '@/lib/toast'
import ReplenishmentQueryDialog, { type ReplenishmentQueryValues } from './ReplenishmentQueryDialog'
import type { TableColumn } from '@/types'
import type { Category } from '@/types/categories'

/** 数量展示：整数带千分位，小数保留两位 */
function fmtQty(v: unknown): string {
  const n = Number(v)
  if (!Number.isFinite(n)) return '—'
  return Number.isInteger(n) ? n.toLocaleString() : n.toFixed(2)
}

export default function ReplenishmentPage() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { can } = usePermission()
  const canCreateRequisition = can(PERMISSIONS.PURCHASE_REQUISITION_CREATE)
  const canAdjustInventory = can(PERMISSIONS.INVENTORY_ADJUST)

  // 采纳「建议补货点」：把该行的建议补货点写回补货策略（仅更新 reorder_point，不覆盖 safety/target）
  const { mutate: adoptReorder } = useMutation({
    mutationFn: ({ row }: { row: ReplenishmentItem }) => saveStockPoliciesApi([
      { productId: row.productId, warehouseId: row.warehouseId, reorderPoint: Math.ceil(row.suggestReorderPoint) },
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
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [confirmOpen, setConfirmOpen] = useState(false)
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

  const { mutate: createRequisition, isPending: creating } = useMutation({
    mutationFn: createRequisitionApi,
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['replenishment'] })
      setConfirmOpen(false)
      setSelected(new Set())
      toast.success(`已生成请购单 ${r.requisitionNo}，待审批`)
      navigate(`/purchase-requisitions/${r.id}`)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const list = useMemo(() => data?.list ?? [], [data])
  const total = data?.pagination?.total ?? 0

  /** 勾选行对应的补货项（按 productId 匹配，DataTable 的 selectedIds 是 number 集合） */
  const selectedRows = useMemo(() => {
    const map = new Map<number, ReplenishmentItem>()
    for (const r of list) if (selected.has(Number(r.productId))) map.set(Number(r.productId), r)
    return [...map.values()]
  }, [list, selected])

  const columns: TableColumn<ReplenishmentItem>[] = [
    { key: 'productCode', title: '商品编码', width: 110, render: v => <span className="text-doc-code">{String(v)}</span> },
    { key: 'articleNumber', title: '货号', width: 90, render: v => (v as string) || '—' },
    { key: 'spec', title: '型号', width: 100, render: v => (v as string) || '—' },
    { key: 'productName', title: '商品名称' },
    { key: 'color', title: '颜色', width: 70, render: v => (v as string) || '—' },
    { key: 'warehouseName', title: '仓库', width: 110 },
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
    {
      key: 'id',
      title: '操作',
      width: 110,
      render: (_, r) => canAdjustInventory && Math.round(r.suggestReorderPoint) !== Math.round(r.reorderPoint) ? (
        <Button size="sm" variant="outline" onClick={() => adoptReorder({ row: r })}>采纳补货点</Button>
      ) : <span className="text-xs text-muted-foreground">—</span>,
    },
  ]

  // 查询弹窗初始值
  const initialQuery: ReplenishmentQueryValues = {
    keyword, warehouseId, warehouseName: '', categoryId,
  }
  function applyQuery(v: ReplenishmentQueryValues) {
    setKeyword(v.keyword)
    setWarehouseId(v.warehouseId)
    setCategoryId(v.categoryId)
    setApplied({ keyword: v.keyword, warehouseId: v.warehouseId, categoryId: v.categoryId })
    setSelected(new Set())
    setQueryOpen(false)
  }
  function reset() {
    setKeyword(''); setWarehouseId(null); setCategoryId(null)
    setApplied({ keyword: '', warehouseId: null, categoryId: null })
    setSelected(new Set())
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

  function openConfirm() {
    if (selectedRows.length === 0) return toast.warning('请先勾选要补货的商品')
    // 请购单是单仓单据：勾选跨仓商品时提示分仓生成（请购头只能一个期望入库仓）
    const warehouses = new Set(selectedRows.map(r => r.warehouseId))
    if (warehouses.size > 1) {
      return toast.warning('勾选商品分属多个仓库，请按仓库分别生成请购单')
    }
    setConfirmOpen(true)
  }
  function handleConfirm() {
    // 按勾选行生成请购草稿：同一仓库一组，source='replenishment'
    const items = selectedRows.map(r => ({
      productId: Number(r.productId),
      quantity: Number(r.suggestQty),
      remark: `补货建议：可用 ${fmtQty(r.available)} / 补货点 ${fmtQty(r.reorderPoint)}`,
    }))
    createRequisition({
      title: '补货建议生成',
      warehouseId: selectedRows[0].warehouseId,
      source: 'replenishment',
      items,
      remark: `由补货建议勾选生成（${selectedRows.length} 项）`,
    })
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="补货建议"
        description="按仓列出「可用 + 在途已低于补货点」的商品，并给出建议采购量（= 目标库存 − 可用 − 在途采购）。补货基准可在商品档案设通用默认，或在此按仓覆盖。"
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => setQueryOpen(true)}>查询</Button>
            {canCreateRequisition && (
              <Button onClick={openConfirm} disabled={creating || selected.size === 0}>
                {creating ? '生成中…' : `生成请购单${selected.size > 0 ? `（${selected.size} 项）` : ''}`}
              </Button>
            )}
            <Button variant="outline" onClick={() => refetch()}>立即刷新</Button>
          </div>
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
          <Button size="sm" variant="ghost" onClick={reset}>清空</Button>
          <div className="ml-auto text-sm text-muted-foreground">共 <span className="font-semibold text-foreground">{total}</span> 项待补货</div>
        </div>
      )}
      {(chips.length === 0) && (
        <div className="flex justify-end text-sm text-muted-foreground">共 <span className="font-semibold text-foreground">{total}</span> 项待补货</div>
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
          rowKey="productId"
          selectable
          selectedIds={selected}
          onSelectChange={setSelected}
          emptyText="暂无待补货商品（所有商品的可用 + 在途都在补货点之上，或尚未设置补货点）"
        />
      )}

      <Dialog open={confirmOpen} onOpenChange={v => !v && setConfirmOpen(false)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>生成采购请购单</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">
              将勾选的 <span className="font-semibold text-foreground">{selectedRows.length}</span> 项补货建议生成一张采购请购单（仓库「
              {selectedRows[0]?.warehouseName ?? '—'}」），进入审批流程。数量取各行的「建议采购量」，可在请购单中调整。
            </p>
            <div className="max-h-56 overflow-auto rounded-md border">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted/60">
                  <tr className="text-left text-muted-foreground">
                    <th className="px-3 py-1.5 font-medium">商品</th>
                    <th className="px-3 py-1.5 text-right font-medium">建议采购量</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedRows.map(r => (
                    <tr key={r.productId} className="border-t">
                      <td className="px-3 py-1.5">{r.productName} <span className="text-doc-code text-xs">{r.productCode}</span></td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{fmtQty(r.suggestQty)} {r.unit}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={creating}>取消</Button>
            <Button onClick={handleConfirm} disabled={creating}>生成请购单</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ReplenishmentQueryDialog
        open={queryOpen}
        initial={initialQuery}
        onClose={() => setQueryOpen(false)}
        onApply={applyQuery}
      />
    </div>
  )
}
