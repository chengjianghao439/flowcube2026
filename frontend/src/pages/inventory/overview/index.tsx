/**
 * InventoryOverviewPage — 库存总览
 * 路径：/inventory/overview
 *
 * 功能：
 *   - 顶部 4 张统计卡片（SKU 数、在库、预占、可用）
 *   - 关键字搜索 + 分类筛选 + 仓库筛选
 *   - 分页表格：编码 / 名称 / 分类路径 / 在库 / 预占 / 可用 / 最近更新 / 操作
 *   - 点击「查看容器」打开右侧侧滑面板（ContainerDrawer）
 */

import { useState } from 'react'
import { Package, Warehouse, Lock, CheckCircle } from 'lucide-react'
import { Button }         from '@/components/ui/button'
import { Input }          from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useInventoryOverview } from '@/hooks/useInventory'
import { useCategoryFlat }      from '@/hooks/useCategories'
import { useWarehousesActive }  from '@/hooks/useWarehouses'
import ContainerDrawer          from '@/components/shared/ContainerDrawer'
import type { InventoryOverviewItem } from '@/types/inventory'

// ─── 统计卡片 ─────────────────────────────────────────────────────────────────

interface StatCardProps {
  icon:    React.ReactNode
  label:   string
  value:   string | number
  sub?:    string
  accent?: string
}

function StatCard({ icon, label, value, sub, accent = 'text-foreground' }: StatCardProps) {
  return (
    <div className="card-base flex items-start gap-4 p-5">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted/60">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <p className={`mt-1 text-2xl font-bold tabular-nums ${accent}`}>{value}</p>
        {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
      </div>
    </div>
  )
}

// ─── 主页面 ───────────────────────────────────────────────────────────────────

export default function InventoryOverviewPage() {
  const [keyword,     setKeyword]     = useState('')
  const [search,      setSearch]      = useState('')
  const [warehouseId, setWarehouseId] = useState<number | null>(null)
  const [categoryId,  setCategoryId]  = useState<number | null>(null)
  const [page,        setPage]        = useState(1)

  // 容器侧滑面板状态
  const [drawerItem,  setDrawerItem]  = useState<InventoryOverviewItem | null>(null)
  const [drawerOpen,  setDrawerOpen]  = useState(false)

  const PAGE_SIZE = 20

  const { data, isLoading } = useInventoryOverview({
    page, pageSize: PAGE_SIZE,
    keyword,
    warehouseId,
    categoryId,
  })

  const { data: categories } = useCategoryFlat()
  const { data: warehouses  } = useWarehousesActive()

  function doSearch() {
    setKeyword(search)
    setPage(1)
  }

  function handleReset() {
    setSearch(''); setKeyword('')
    setWarehouseId(null); setCategoryId(null)
    setPage(1)
  }

  function openDrawer(row: InventoryOverviewItem) {
    setDrawerItem(row)
    setDrawerOpen(true)
  }

  const stats      = data?.stats
  const list       = data?.list ?? []
  const pagination = data?.pagination

  return (
    <div className="space-y-5">

      {/* 顶部统计卡片 */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          icon={<Package className="h-5 w-5 text-muted-foreground" />}
          label="商品 SKU 数"
          value={isLoading ? '—' : (stats?.totalSkus ?? 0).toLocaleString()}
          sub="当前筛选条件下"
        />
        <StatCard
          icon={<Warehouse className="h-5 w-5 text-blue-500" />}
          label="在库总量"
          value={isLoading ? '—' : formatQty(stats?.totalOnHand)}
          accent="text-blue-600"
        />
        <StatCard
          icon={<Lock className="h-5 w-5 text-amber-500" />}
          label="预占总量"
          value={isLoading ? '—' : formatQty(stats?.totalReserved)}
          sub="销售单已占用"
          accent="text-amber-600"
        />
        <StatCard
          icon={<CheckCircle className="h-5 w-5 text-emerald-500" />}
          label="可用总量"
          value={isLoading ? '—' : formatQty(stats?.totalAvailable)}
          sub="在库 − 预占"
          accent="text-emerald-600"
        />
      </div>

      {/* 筛选区 */}
      <div className="card-base p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <Input
              placeholder="商品编码 / 名称..."
              value={search}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearch(e.target.value)}
              onKeyDown={(e: React.KeyboardEvent) => e.key === 'Enter' && doSearch()}
              className="w-52"
            />
            <Button variant="outline" onClick={doSearch}>搜索</Button>
          </div>

          <div className="h-5 w-px bg-border" />

          <Select
            value={categoryId == null ? '__all__' : String(categoryId)}
            onValueChange={v => {
              setCategoryId(v === '__all__' ? null : +v)
              setPage(1)
            }}
          >
            <SelectTrigger className="h-10 w-48">
              <SelectValue placeholder="全部分类" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">全部分类</SelectItem>
              {(categories ?? []).map(c => (
                <SelectItem key={c.id} value={String(c.id)}>
                  {'　'.repeat(c.level - 1)}{c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={warehouseId == null ? '__all__' : String(warehouseId)}
            onValueChange={v => {
              setWarehouseId(v === '__all__' ? null : +v)
              setPage(1)
            }}
          >
            <SelectTrigger className="h-10 w-44">
              <SelectValue placeholder="全部仓库" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">全部仓库</SelectItem>
              {(warehouses ?? []).map(w => (
                <SelectItem key={w.id} value={String(w.id)}>{w.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {(keyword || warehouseId || categoryId) && (
            <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={handleReset}>
              重置
            </Button>
          )}
        </div>
      </div>

      {/* 主表格 */}
      <div className="card-base overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/30">
                {[
                  { label: '商品编码',          cls: 'w-32 text-left' },
                  { label: '商品名称',          cls: 'text-left' },
                  { label: '分类路径',          cls: 'text-left' },
                  { label: '仓库',              cls: 'w-28 text-left' },
                  { label: '在库 (on_hand)',    cls: 'w-28 text-right' },
                  { label: '预占 (reserved)',   cls: 'w-28 text-right' },
                  { label: '可用 (available)',  cls: 'w-28 text-right' },
                  { label: '最近更新',          cls: 'w-36 text-right' },
                  { label: '操作',              cls: 'w-24 text-right' },
                ].map(col => (
                  <th key={col.label} className={`px-4 py-2.5 text-xs font-semibold text-muted-foreground ${col.cls}`}>
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={9} className="py-16 text-center text-sm text-muted-foreground">
                    <div className="flex items-center justify-center gap-2">
                      <svg className="h-4 w-4 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      加载中...
                    </div>
                  </td>
                </tr>
              ) : list.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-16 text-center text-sm text-muted-foreground">
                    暂无库存数据
                  </td>
                </tr>
              ) : (
                list.map((row: InventoryOverviewItem) => (
                  <tr
                    key={row.id}
                    className={`border-b border-border/40 transition-colors hover:bg-muted/20 ${
                      drawerItem?.id === row.id && drawerOpen ? 'bg-primary/5' : ''
                    }`}
                  >
                    <td className="px-4 py-3">
                      <span className="text-doc-code-muted">{row.productCode}</span>
                    </td>
                    <td className="px-4 py-3 font-medium">{row.productName}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {row.categoryPath || <span className="italic">未分类</span>}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{row.warehouseName}</td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      <span className="font-medium">{formatQty(row.onHand)}</span>
                      <span className="ml-1 text-xs text-muted-foreground">{row.unit}</span>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {row.reserved > 0 ? (
                        <span className="font-medium text-amber-600">{formatQty(row.reserved)}</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      <AvailableBadge available={row.available} onHand={row.onHand} />
                    </td>
                    <td className="px-4 py-3 text-right text-xs text-muted-foreground">
                      {row.updatedAt ? row.updatedAt.slice(0, 16) : '—'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button
                        size="sm"
                        variant={drawerItem?.id === row.id && drawerOpen ? 'secondary' : 'ghost'}
                        className="h-7 px-2 text-xs"
                        onClick={() => openDrawer(row)}
                      >
                        查看容器
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* 分页 */}
        {pagination && pagination.total > 0 && (
          <div className="flex items-center justify-between border-t px-4 py-3">
            <span className="text-xs text-muted-foreground">
              共 {pagination.total.toLocaleString()} 条
              {pagination.total > PAGE_SIZE && `，第 ${page} / ${Math.ceil(pagination.total / PAGE_SIZE)} 页`}
            </span>
            <div className="flex items-center gap-1">
              <Button
                size="sm" variant="outline"
                disabled={page <= 1}
                onClick={() => setPage(p => p - 1)}
              >上一页</Button>
              <Button
                size="sm" variant="outline"
                disabled={page >= Math.ceil(pagination.total / PAGE_SIZE)}
                onClick={() => setPage(p => p + 1)}
              >下一页</Button>
            </div>
          </div>
        )}
      </div>

      {/* 容器侧滑面板 */}
      <ContainerDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        item={drawerItem}
      />
    </div>
  )
}

// ─── 辅助组件 & 函数 ──────────────────────────────────────────────────────────

function AvailableBadge({ available, onHand }: { available: number; onHand: number }) {
  if (available <= 0) {
    return <span className="font-semibold text-destructive">0</span>
  }
  const ratio = onHand > 0 ? available / onHand : 1
  const cls = ratio < 0.2 ? 'text-amber-600 font-medium' : 'text-emerald-600 font-medium'
  return <span className={cls}>{formatQty(available)}</span>
}

function formatQty(v?: number): string {
  if (v === undefined || v === null) return '—'
  return Number.isInteger(v) ? v.toLocaleString() : v.toFixed(2)
}
