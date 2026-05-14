import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Package, Warehouse, Lock, CheckCircle } from 'lucide-react'
import { downloadExport } from '@/lib/exportDownload'
import { toast } from '@/lib/toast'
import PageHeader from '@/components/shared/PageHeader'
import DataTable from '@/components/shared/DataTable'
import { FilterCard } from '@/components/shared/FilterCard'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useLogs, useOutbound, useInventoryOverview } from '@/hooks/useInventory'
import { useWarehousesActive } from '@/hooks/useWarehouses'
import { WarehouseFinder, ProductFinder, FinderTrigger } from '@/components/finder'
import ContainerDrawer from '@/components/shared/ContainerDrawer'
import CategoryTreeSelect from '@/components/shared/CategoryTreeSelect'
import CategoryPathDisplay from '@/components/shared/CategoryPathDisplay'
import { formatDisplayDateTime } from '@/lib/dateTime'
import type { InventoryLog, InventoryOverviewItem } from '@/types/inventory'
import type { TableColumn } from '@/types'
import type { ProductFinderResult } from '@/types/products'
import { readNullableIntParam, readPositiveIntParam, readStringParam, upsertSearchParams } from '@/lib/urlSearchParams'

type Tab = 'overview' | 'logs'
type OpType = 'outbound'

const emptyOp = {
  productId: '',  productName: '',
  warehouseId: '', warehouseName: '',
  quantity: '', unitPrice: '', remark: '',
}

// ─── 统计卡片 ─────────────────────────────────────────────────────────────────

function StatCard({ icon, label, value, sub, accent = 'text-foreground' }: {
  icon: React.ReactNode; label: string; value: string | number; sub?: string; accent?: string
}) {
  return (
    <div className="card-base flex items-start gap-4 p-5">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted/60">{icon}</div>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <p className={`mt-1 text-2xl font-bold ${accent}`}>{value}</p>
        {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
      </div>
    </div>
  )
}

function formatQty(v?: number): string {
  if (v === undefined || v === null) return '—'
  return Number.isInteger(v) ? v.toLocaleString() : v.toFixed(2)
}

function AvailableBadge({ available, onHand }: { available: number; onHand: number }) {
  if (available <= 0) return <span className="font-semibold text-destructive">0</span>
  const ratio = onHand > 0 ? available / onHand : 1
  const cls = ratio < 0.2 ? 'text-amber-600 font-medium' : 'text-emerald-600 font-medium'
  return <span className={cls}>{formatQty(available)}</span>
}

// ─── 主页面 ───────────────────────────────────────────────────────────────────

export default function InventoryPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const tab = (searchParams.get('tab') === 'logs' ? 'logs' : 'overview') as Tab

  // 总览参数
  const keyword = readStringParam(searchParams, 'keyword')
  const warehouseId = readNullableIntParam(searchParams, 'warehouseId')
  const categoryId = readNullableIntParam(searchParams, 'categoryId')
  const overviewPage = readPositiveIntParam(searchParams, 'page', 1)
  const [search, setSearch] = useState(keyword)

  // 日志参数
  const logPage = readPositiveIntParam(searchParams, 'logPage', 1)
  const rawLogType = Number(searchParams.get('logType') || '')
  const logType = Number.isInteger(rawLogType) && rawLogType > 0 ? rawLogType : null

  // 容器侧滑
  const [drawerItem, setDrawerItem] = useState<InventoryOverviewItem | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)

  // 出库弹窗
  const [opOpen, setOpOpen] = useState(false); const [, setOpType] = useState<OpType>('outbound')
  const [form, setForm] = useState(emptyOp)
  const [productFinderOpen,  setProductFinderOpen]  = useState(false)
  const [warehouseFinderOpen, setWarehouseFinderOpen] = useState(false)

  const { data: overview, isLoading: overviewLoading } = useInventoryOverview({
    page: overviewPage, pageSize: 20, keyword, warehouseId, categoryId,
  })
  const { data: logs, isLoading: logLoading } = useLogs({ page: logPage, pageSize: 20, type: logType })
  const { data: warehouses } = useWarehousesActive()
  const { mutate: outbound, isPending } = useOutbound()
  const setF = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  useEffect(() => { setSearch(keyword) }, [keyword])

  function updateParams(updates: Record<string, string | number | null | undefined>) {
    setSearchParams(upsertSearchParams(searchParams, updates))
  }

  function openOp(t: OpType) { setOpType(t); setForm(emptyOp); setOpOpen(true) }
  function handleOp(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const base = { productId: +form.productId, warehouseId: +form.warehouseId, quantity: +form.quantity, remark: form.remark || undefined }
    outbound({ ...base, supplierId: null, unitPrice: form.unitPrice ? +form.unitPrice : null }, { onSuccess: () => setOpOpen(false) })
  }

  const stats = overview?.stats
  const list = overview?.list ?? []
  const pagination = overview?.pagination
  const TYPE_VARIANT: Record<number, 'default' | 'secondary' | 'outline'> = { 1: 'default', 2: 'secondary', 3: 'outline' }
  const TYPE_NAMES: Record<number, string> = { 1: '入库', 2: '出库', 3: '调整' }

  const logCols: TableColumn<InventoryLog>[] = [
    { key: 'createdAt', title: '时间', width: 160, render: v => formatDisplayDateTime(v) },
    { key: 'typeName', title: '类型', width: 80, render: (_, r) => <Badge variant={TYPE_VARIANT[r.type] ?? 'outline'}>{TYPE_NAMES[r.type]}</Badge> },
    { key: 'productName', title: '商品' },
    { key: 'warehouseName', title: '仓库', width: 120 },
    { key: 'quantity', title: '数量', width: 90, render: (_, r) => <span>{r.type === 2 ? `-${r.quantity}` : r.quantity}</span> },
    { key: 'beforeQty', title: '变动前', width: 90, render: v => <span className="text-muted-foreground">{v as number}</span> },
    { key: 'afterQty', title: '变动后', width: 90, render: v => <span>{v as number}</span> },
    { key: 'supplierName', title: '供应商', width: 120, render: v => (v as string) || '-' },
    { key: 'operatorName', title: '操作人', width: 90 },
    { key: 'remark', title: '备注', render: v => (v as string) || '-' },
  ]

  return (
    <div className="space-y-4">
      <PageHeader title="库存管理" description="库存总览与出入库记录；采购入库请走「收货订单」上架后计入库存" actions={
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" onClick={() => downloadExport(tab === 'logs' ? '/export/inventory-logs' : '/export/stock').catch(e => toast.error((e as Error).message))}>导出 Excel</Button>
          <Button variant="outline" onClick={() => openOp('outbound')}>出库</Button>
          <Button variant="outline" asChild><Link to="/stockcheck">盘点调整</Link></Button>
        </div>
      } />

      {/* 标签切换 */}
      <div className="mb-4 flex gap-1 border-b border-border">
        {(['overview', 'logs'] as Tab[]).map(t => (
          <button key={t} onClick={() => updateParams({ tab: t })}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${tab === t ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>
            {t === 'overview' ? '库存总览' : '出入库记录'}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <>
          {/* 统计卡片 */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard icon={<Package className="h-5 w-5 text-muted-foreground" />} label="商品 SKU 数"
              value={overviewLoading ? '—' : (stats?.totalSkus ?? 0).toLocaleString()} sub="当前筛选条件下" />
            <StatCard icon={<Warehouse className="h-5 w-5 text-blue-500" />} label="在库总量"
              value={overviewLoading ? '—' : formatQty(stats?.totalOnHand)} accent="text-blue-600" />
            <StatCard icon={<Lock className="h-5 w-5 text-amber-500" />} label="预占总量"
              value={overviewLoading ? '—' : formatQty(stats?.totalReserved)} sub="销售单已占用" accent="text-amber-600" />
            <StatCard icon={<CheckCircle className="h-5 w-5 text-emerald-500" />} label="可用总量"
              value={overviewLoading ? '—' : formatQty(stats?.totalAvailable)} sub="在库 − 预占" accent="text-emerald-600" />
          </div>

          {/* 筛选区 */}
          <FilterCard>
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <Input placeholder="商品编码 / 名称..." value={search}
                  onChange={e => setSearch(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && updateParams({ keyword: search, page: 1 })}
                  className="w-52" />
                <Button variant="outline" onClick={() => updateParams({ keyword: search, page: 1 })}>搜索</Button>
              </div>
              <div className="h-5 w-px bg-border" />
              <CategoryTreeSelect value={categoryId} onChange={v => updateParams({ categoryId: v, page: 1 })}
                emptyLabel="全部分类" leafOnly className="h-10 w-48" />
              <Select value={warehouseId == null ? '__all__' : String(warehouseId)}
                onValueChange={v => updateParams({ warehouseId: v === '__all__' ? null : +v, page: 1 })}>
                <SelectTrigger className="h-10 w-44"><SelectValue placeholder="全部仓库" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">全部仓库</SelectItem>
                  {(warehouses ?? []).map(w => <SelectItem key={w.id} value={String(w.id)}>{w.name}</SelectItem>)}
                </SelectContent>
              </Select>
              {(keyword || warehouseId || categoryId) && (
                <Button variant="ghost" size="sm" className="text-muted-foreground"
                  onClick={() => { setSearch(''); updateParams({ keyword: null, warehouseId: null, categoryId: null, page: 1 }) }}>重置</Button>
              )}
            </div>
          </FilterCard>

          {/* 库存表格 */}
          <div className="card-base overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/30">
                    {[
                      { label: '商品编码', cls: 'w-32 text-left' },
                      { label: '商品名称', cls: 'text-left' },
                      { label: '分类路径', cls: 'text-left' },
                      { label: '仓库', cls: 'w-28 text-left' },
                      { label: '在库数量', cls: 'w-28 text-left' },
                      { label: '已预占', cls: 'w-24 text-left' },
                      { label: '可用库存', cls: 'w-24 text-left', title: '可用库存 = 在库 − 已预占' },
                      { label: '最近更新', cls: 'w-36 text-left' },
                      { label: '操作', cls: 'w-24 text-left' },
                    ].map(col => (
                      <th key={col.label} title={'title' in col ? col.title : undefined}
                        className={`px-4 py-2.5 text-xs font-semibold text-muted-foreground ${col.cls}`}>{col.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {overviewLoading ? (
                    <tr><td colSpan={9} className="py-16 text-center text-sm text-muted-foreground">加载中...</td></tr>
                  ) : list.length === 0 ? (
                    <tr><td colSpan={9} className="py-16 text-center text-sm text-muted-foreground">暂无库存数据</td></tr>
                  ) : (
                    list.map((row: InventoryOverviewItem) => (
                      <tr key={row.id} className={`border-b border-border/40 transition-colors hover:bg-muted/20 ${drawerItem?.id === row.id && drawerOpen ? 'bg-primary/5' : ''}`}>
                        <td className="px-4 py-3"><span className="text-doc-code-muted">{row.productCode}</span></td>
                        <td className="px-4 py-3 font-medium">{row.productName}</td>
                        <td className="px-4 py-3 text-xs text-muted-foreground"><CategoryPathDisplay path={row.categoryPath} /></td>
                        <td className="px-4 py-3 text-muted-foreground">{row.warehouseName}</td>
                        <td className="px-4 py-3 text-left"><span className="font-medium">{formatQty(row.onHand)}</span><span className="ml-1 text-xs text-muted-foreground">{row.unit}</span></td>
                        <td className="px-4 py-3 text-left">{row.reserved > 0 ? <span className="font-medium text-amber-600">{formatQty(row.reserved)}</span> : <span className="text-muted-foreground">—</span>}</td>
                        <td className="px-4 py-3 text-left"><AvailableBadge available={row.available} onHand={row.onHand} /></td>
                        <td className="px-4 py-3 text-left text-xs text-muted-foreground">{formatDisplayDateTime(row.updatedAt)}</td>
                        <td className="px-4 py-3 text-left">
                          <Button size="sm" variant={drawerItem?.id === row.id && drawerOpen ? 'secondary' : 'ghost'}
                            className="h-7 px-2 text-xs" onClick={() => { setDrawerItem(row); setDrawerOpen(true) }}>查看容器</Button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {pagination && pagination.totalPages > 1 && (
            <div className="flex items-center justify-end gap-2 text-sm text-muted-foreground">
              <span>第 {pagination.page} / {pagination.totalPages} 页</span>
              <Button size="sm" variant="outline" disabled={pagination.page <= 1} onClick={() => updateParams({ page: pagination.page - 1 })}>上一页</Button>
              <Button size="sm" variant="outline" disabled={pagination.page >= pagination.totalPages} onClick={() => updateParams({ page: pagination.page + 1 })}>下一页</Button>
            </div>
          )}

          <ContainerDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} item={drawerItem} />
        </>
      )}

      {tab === 'logs' && (
        <>
          <FilterCard>
            <Select value={logType == null ? '__all__' : String(logType)}
              onValueChange={v => updateParams({ logType: v === '__all__' ? null : +v, logPage: 1 })}>
              <SelectTrigger className="h-9 w-36"><SelectValue placeholder="全部类型" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">全部类型</SelectItem>
                <SelectItem value="1">入库</SelectItem>
                <SelectItem value="2">出库</SelectItem>
                <SelectItem value="3">调整</SelectItem>
              </SelectContent>
            </Select>
          </FilterCard>
          <DataTable columns={logCols} data={logs?.list ?? []} loading={logLoading} pagination={logs?.pagination} onPageChange={nextPage => updateParams({ logPage: nextPage })} rowKey="id" />
        </>
      )}

      {/* 出库弹窗 */}
      <Dialog open={opOpen} onOpenChange={v => !v && setOpOpen(false)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>出库</DialogTitle></DialogHeader>
          <form onSubmit={handleOp} className="space-y-4 py-2">
            <div className="space-y-2"><Label>商品 *</Label><FinderTrigger value={form.productName} placeholder="点击选择商品..." onClick={() => setProductFinderOpen(true)} disabled={isPending} /></div>
            <div className="space-y-2"><Label>仓库 *</Label><FinderTrigger value={form.warehouseName} placeholder="点击选择仓库..." onClick={() => setWarehouseFinderOpen(true)} disabled={isPending} /></div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2"><Label>数量 *</Label><Input type="number" step="0.0001" min="0" value={form.quantity} onChange={e => setF('quantity', e.target.value)} disabled={isPending} /></div>
              <div className="space-y-2"><Label>单价</Label><Input type="number" step="0.01" min="0" value={form.unitPrice} onChange={e => setF('unitPrice', e.target.value)} disabled={isPending} placeholder="选填" /></div>
            </div>
            <div className="space-y-2"><Label>备注</Label><Input value={form.remark} onChange={e => setF('remark', e.target.value)} disabled={isPending} placeholder="选填" /></div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpOpen(false)} disabled={isPending}>取消</Button>
              <Button type="submit" disabled={isPending || !form.productId || !form.warehouseId || !form.quantity}>{isPending ? '提交中...' : '出库'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ProductFinder open={productFinderOpen} warehouseId={form.warehouseId ? +form.warehouseId : null}
        onConfirm={p => { setForm(f => ({ ...f, productId: String(p.id), productName: p.name })); setProductFinderOpen(false) }}
        onClose={() => setProductFinderOpen(false)} />
      <WarehouseFinder open={warehouseFinderOpen} onClose={() => setWarehouseFinderOpen(false)}
        onConfirm={r => { setForm(f => ({ ...f, warehouseId: String(r.id), warehouseName: r.name })); setWarehouseFinderOpen(false) }} />
    </div>
  )
}
