import { useState, useRef } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Package, Warehouse, Lock, CheckCircle, X } from 'lucide-react'
import { downloadExport } from '@/lib/exportDownload'
import { toast } from '@/lib/toast'
import PageHeader from '@/components/shared/PageHeader'
import DataTable from '@/components/shared/DataTable'
import Pagination from '@/components/shared/Pagination'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SoftStatusLabel } from '@/components/shared/StatusBadge'
import type { StatusTone } from '@/lib/statusTone'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { useLogs, useOutbound, useInventoryOverview } from '@/hooks/useInventory'
import { useWarehousesActive } from '@/hooks/useWarehouses'
import { ProductFinder, FinderTrigger } from '@/components/finder'
import { WarehouseSelect } from '@/components/shared/WarehouseSelect'
import ContainerDrawer from '@/components/shared/ContainerDrawer'
import CategoryPathDisplay from '@/components/shared/CategoryPathDisplay'
import { useCategoryTree } from '@/hooks/useCategories'
import { formatDisplayDateTime } from '@/lib/dateTime'
import InventoryOverviewQueryDialog, { type InventoryOverviewQueryValues } from './InventoryOverviewQueryDialog'
import InventoryLogsQueryDialog, { type InventoryLogsQueryValues } from './InventoryLogsQueryDialog'
import type { InventoryLog, InventoryOverviewItem } from '@/types/inventory'
import type { TableColumn } from '@/types'
import type { Category } from '@/types/categories'
import { readNullableIntParam, readStringParam, upsertSearchParams } from '@/lib/urlSearchParams'
import { importStockApi } from '@/api/inventory'

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

// ─── 主页面 ───────────────────────────────────────────────────────────────────

export default function InventoryPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const tab = (searchParams.get('tab') === 'logs' ? 'logs' : 'overview') as Tab

  // 总览参数
  const keyword = readStringParam(searchParams, 'keyword')
  const warehouseId = readNullableIntParam(searchParams, 'warehouseId')
  const warehouseName = readStringParam(searchParams, 'warehouseName')
  const categoryId = readNullableIntParam(searchParams, 'categoryId')

  // 日志参数
  const rawLogType = Number(searchParams.get('logType') || '')
  const logType = Number.isInteger(rawLogType) && rawLogType > 0 ? rawLogType : null
  const logProductId = readNullableIntParam(searchParams, 'logProductId')
  const logProductName = readStringParam(searchParams, 'logProductName')
  const logWarehouseId = readNullableIntParam(searchParams, 'logWarehouseId')
  const logWarehouseName = readStringParam(searchParams, 'logWarehouseName')

  // 分页参数：总览与流水各用各的（/inventory/overview 与 /inventory/logs 各归各的接口）
  const page     = Math.max(1, Number(searchParams.get('page') || '1') || 1)
  const logPage  = Math.max(1, Number(searchParams.get('logPage') || '1') || 1)

  // 容器侧滑
  const [drawerItem, setDrawerItem] = useState<InventoryOverviewItem | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)

  // 查询弹窗
  const [overviewQueryOpen, setOverviewQueryOpen] = useState(false)
  const [logsQueryOpen, setLogsQueryOpen] = useState(false)

  // 库存导入弹窗
  const [importOpen, setImportOpen] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState<{ success: number; errors: string[] } | null>(null)
  const importFileRef = useRef<HTMLInputElement>(null)

  // 出库弹窗
  const [opOpen, setOpOpen] = useState(false); const [, setOpType] = useState<OpType>('outbound')
  const [form, setForm] = useState(emptyOp)
  const [productFinderOpen,  setProductFinderOpen]  = useState(false)

  const PAGE_SIZE = 20
  const { data: overview, isLoading: overviewLoading } = useInventoryOverview({
    page, pageSize: PAGE_SIZE, keyword, warehouseId, categoryId,
  })
  const { data: logs, isLoading: logLoading } = useLogs({
    page: logPage, pageSize: PAGE_SIZE, type: logType,
    productId: logProductId ?? undefined, warehouseId: logWarehouseId ?? undefined,
  })
  const overviewTotal = overview?.pagination?.total ?? 0
  const overviewTotalPages = Math.max(1, Math.ceil(overviewTotal / PAGE_SIZE))
  const logsTotal = logs?.pagination?.total ?? 0
  const logsTotalPages = Math.max(1, Math.ceil(logsTotal / PAGE_SIZE))
  const { data: warehouses } = useWarehousesActive()
  const { data: categoryTree = [] } = useCategoryTree()
  const { mutate: outbound, isPending } = useOutbound()
  const setF = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

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
  /** 库存增减按财务直觉取色：入库=增(绿) · 出库=减(红) · 调整=中性标识 */
  const TYPE_TONE: Record<number, StatusTone> = { 1: 'success', 2: 'danger', 3: 'info' }
  const TYPE_NAMES: Record<number, string> = { 1: '入库', 2: '出库', 3: '调整' }

  const catName = categoryId ? findCatName(categoryTree, categoryId) : null
  const overviewWarehouseName = warehouseId ? (warehouseName || (warehouses ?? []).find((w: { id: number; name: string }) => w.id === warehouseId)?.name) || null : null
  const logsWarehouseName = logWarehouseId ? (warehouses ?? []).find((w: { id: number; name: string }) => w.id === logWarehouseId)?.name ?? null : null
  // ── 查询弹窗初始值 / 应用 ──
  const initialOverviewQuery: InventoryOverviewQueryValues = { keyword, categoryId, warehouseId, warehouseName: warehouseName || '' }
  function applyOverviewQuery(v: InventoryOverviewQueryValues) {
    updateParams({
      keyword: v.keyword || null,
      categoryId: v.categoryId || null,
      warehouseId: v.warehouseId || null,
      warehouseName: v.warehouseName || null,
      page: 1,
    })
    setOverviewQueryOpen(false)
  }

  const initialLogsQuery: InventoryLogsQueryValues = {
    type: logType,
    productId: logProductId, productCode: '', productName: logProductName,
    warehouseId: logWarehouseId, warehouseName: logWarehouseName || logsWarehouseName || '',
  }
  function applyLogsQuery(v: InventoryLogsQueryValues) {
    updateParams({
      logType: v.type || null,
      logProductId: v.productId || null,
      logProductName: v.productName || null,
      logWarehouseId: v.warehouseId || null,
      logWarehouseName: v.warehouseName || null,
      logPage: 1,
    })
    setLogsQueryOpen(false)
  }

  // 当前生效筛选摘要（可逐项移除）
  const chips = (tab === 'overview'
    ? [
        keyword && { key: 'keyword', label: `关键字：${keyword}`, onRemove: () => updateParams({ keyword: null, page: 1 }) },
        categoryId && { key: 'category', label: `分类：${catName ?? categoryId}`, onRemove: () => updateParams({ categoryId: null, page: 1 }) },
        warehouseId && { key: 'warehouse', label: `仓库：${overviewWarehouseName ?? warehouseId}`, onRemove: () => updateParams({ warehouseId: null, warehouseName: null, page: 1 }) },
      ]
    : [
        logType && { key: 'logType', label: `类型：${TYPE_NAMES[logType] ?? logType}`, onRemove: () => updateParams({ logType: null, logPage: 1 }) },
        logProductId && { key: 'logProduct', label: `商品：${logProductName || logProductId}`, onRemove: () => updateParams({ logProductId: null, logProductName: null, logPage: 1 }) },
        logWarehouseId && { key: 'logWarehouse', label: `仓库：${logsWarehouseName ?? logWarehouseId}`, onRemove: () => updateParams({ logWarehouseId: null, logWarehouseName: null, logPage: 1 }) },
      ]
  ).filter(Boolean) as { key: string; label: string; onRemove: () => void }[]

  function clearAll() {
    if (tab === 'overview') {
      updateParams({ keyword: null, categoryId: null, warehouseId: null, warehouseName: null, page: 1 })
    } else {
      updateParams({ logType: null, logProductId: null, logProductName: null, logWarehouseId: null, logWarehouseName: null, logPage: 1 })
    }
  }

  const logCols: TableColumn<InventoryLog>[] = [
    { key: 'createdAt', title: '时间', width: 160, render: v => formatDisplayDateTime(v) },
    { key: 'typeName', title: '类型', width: 80, render: (_, r) => <SoftStatusLabel label={TYPE_NAMES[r.type]} tone={TYPE_TONE[r.type] ?? 'info'} /> },
    { key: 'productName', title: '商品', width: 140 },
    { key: 'warehouseName', title: '仓库', width: 140 },
    { key: 'quantity', title: '数量', width: 90, render: (_, r) => <span>{r.type === 2 ? `-${r.quantity}` : r.quantity}</span> },
    { key: 'beforeQty', title: '变动前', width: 90, render: v => <span className="text-muted-foreground">{v as number}</span> },
    { key: 'afterQty', title: '变动后', width: 90, render: v => <span>{v as number}</span> },
    { key: 'supplierName', title: '供应商', width: 140, render: v => (v as string) || '-' },
    { key: 'operatorName', title: '操作人', width: 90 },
    { key: 'remark', title: '备注', render: v => (v as string) || '-' },
  ]

  // 库存初始化导入：下载模板 → 填数上传 → 后端逐行建容器/落库（POST /import/stock）
  async function handleImportStock(file: File) {
    setImporting(true)
    try {
      const res = await importStockApi(file)
      const errors = (res.errors ?? []).map(e => `第${e.row}行: ${e.message}`)
      setImportResult({ success: res.success ?? 0, errors })
      toast.success(`导入成功：${res.success ?? 0} 条`)
    } catch (e) {
      const err = e as { message?: string }
      toast.error(err?.message || '导入失败')
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader title="库存管理" description="库存总览与出入库记录；采购入库请走「收货订单」上架后计入库存" actions={
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" onClick={() => tab === 'logs' ? setLogsQueryOpen(true) : setOverviewQueryOpen(true)}>查询</Button>
          <Button variant="outline" onClick={() => downloadExport(tab === 'logs' ? '/export/inventory-logs' : '/export/stock').catch(e => toast.error((e as Error).message))}>导出 Excel</Button>
          <Button variant="outline" onClick={() => setImportOpen(true)} disabled={tab !== 'overview'}>导入库存</Button>
          <Button variant="outline" onClick={() => openOp('outbound')}>出库</Button>
          <Button variant="outline" asChild><Link to="/stockcheck">库存盘点</Link></Button>
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

      {tab === 'overview' && (
        <>
          {/* 统计卡片 */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard icon={<Package className="h-5 w-5 text-muted-foreground" />} label="商品 SKU 数"
              value={overviewLoading ? '—' : (stats?.totalSkus ?? 0).toLocaleString()} sub="当前筛选条件下" />
            <StatCard icon={<Warehouse className="h-5 w-5 text-blue-500" />} label="在库数量"
              value={overviewLoading ? '—' : formatQty(stats?.totalOnHand)} accent="text-blue-600" />
            <StatCard icon={<Lock className="h-5 w-5 text-amber-500" />} label="已预占"
              value={overviewLoading ? '—' : formatQty(stats?.totalReserved)} sub="销售单已占用" accent="text-amber-600" />
            <StatCard icon={<CheckCircle className="h-5 w-5 text-emerald-500" />} label="可用库存"
              value={overviewLoading ? '—' : formatQty(stats?.totalAvailable)} sub="在库 − 已预占" accent="text-emerald-600" />
          </div>

          {/* 库存表格 */}
          <div className="card-base overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/30">
                    {[
                      { label: '商品编码', cls: 'w-32 text-left' },
                      { label: '货号', cls: 'w-24 text-left' },
                      { label: '型号', cls: 'w-24 text-left' },
                      { label: '商品名称', cls: 'text-left' },
                      { label: '颜色', cls: 'w-20 text-left' },
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
                    <tr><td colSpan={13} className="py-16 text-center text-sm text-muted-foreground">加载中…</td></tr>
                  ) : list.length === 0 ? (
                    <tr><td colSpan={13} className="py-16 text-center text-sm text-muted-foreground">暂无库存数据</td></tr>
                  ) : (
                    list.map((row: InventoryOverviewItem) => (
                      <tr key={row.id} className={`border-b border-border/40 transition-colors hover:bg-muted/20 ${drawerItem?.id === row.id && drawerOpen ? 'bg-primary/5' : ''}`}>
                        <td className="px-4 py-3"><span className="text-doc-code-muted">{row.productCode}</span></td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">{row.articleNumber || '—'}</td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">{row.spec || '—'}</td>
                        <td className="px-4 py-3 font-medium">{row.productName}</td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">{row.color || '—'}</td>
                        <td className="px-4 py-3 text-xs text-muted-foreground"><CategoryPathDisplay path={row.categoryPath} /></td>
                        <td className="px-4 py-3 text-muted-foreground">{row.warehouseName}</td>
                        <td className="px-4 py-3 text-left"><span className="font-medium">{formatQty(row.onHand)}</span><span className="ml-1 text-xs text-muted-foreground">{row.unit}</span></td>
                        <td className="px-4 py-3 text-left">{row.reserved > 0 ? <span className="font-medium text-amber-600">{formatQty(row.reserved)}</span> : <span className="text-muted-foreground">—</span>}</td>
                        <td className="px-4 py-3 text-left"><AvailableBadge available={row.available} onHand={row.onHand} /></td>
                        <td className="px-4 py-3 text-left text-xs text-muted-foreground">{formatDisplayDateTime(row.updatedAt)}</td>
                        <td className="px-4 py-3 text-left">
                          <Button size="sm" variant={drawerItem?.id === row.id && drawerOpen ? 'secondary' : 'ghost'}
                            className="h-7 px-2 text-xs" onClick={() => { setDrawerItem(row); setDrawerOpen(true) }}>查看条码</Button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* 分页 */}
          <Pagination page={page} totalPages={overviewTotalPages} total={overviewTotal} unit="条"
            onPageChange={(p) => updateParams({ page: p })} />

          <ContainerDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} item={drawerItem} />
        </>
      )}

      {tab === 'logs' && (
        <>
          <DataTable columns={logCols} data={logs?.list ?? []} loading={logLoading} rowKey="id" />

          {/* 分页 */}
          <Pagination page={logPage} totalPages={logsTotalPages} total={logsTotal} unit="条"
            onPageChange={(p) => updateParams({ logPage: p })} />
        </>
      )}

      {/* 出库弹窗 */}
      <Dialog open={opOpen} onOpenChange={v => !v && setOpOpen(false)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>出库</DialogTitle></DialogHeader>
          <form onSubmit={handleOp} className="space-y-4 py-2">
            <div className="space-y-2"><Label>商品 *</Label><FinderTrigger value={form.productName} placeholder="点击选择商品…" onClick={() => setProductFinderOpen(true)} disabled={isPending} /></div>
            <div className="space-y-2">
              <Label>仓库 *</Label>
              <WarehouseSelect
                value={form.warehouseId ? +form.warehouseId : null}
                onChange={(id, name) => setForm(f => ({ ...f, warehouseId: id ? String(id) : '', warehouseName: name }))}
                placeholder="选择仓库"
                disabled={isPending}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2"><Label>数量 *</Label><Input type="number" step="0.0001" min="0" value={form.quantity} onChange={e => setF('quantity', e.target.value)} disabled={isPending} /></div>
              <div className="space-y-2"><Label>单价</Label><Input type="number" step="0.01" min="0" value={form.unitPrice} onChange={e => setF('unitPrice', e.target.value)} disabled={isPending} placeholder="选填" /></div>
            </div>
            <div className="space-y-2"><Label>备注</Label><Input value={form.remark} onChange={e => setF('remark', e.target.value)} disabled={isPending} placeholder="选填" /></div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpOpen(false)} disabled={isPending}>取消</Button>
              <Button type="submit" disabled={isPending || !form.productId || !form.warehouseId || !form.quantity}>{isPending ? '提交中…' : '出库'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* 库存导入弹窗：下载模板 → 填数上传 → 后端逐行建容器 */}
      <Dialog open={importOpen} onOpenChange={v => { setImportOpen(v); if (!v) setImportResult(null) }}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>批量导入库存</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">请先下载模板，按照格式填写后上传。模板用于初始化各仓库的商品期初库存。</p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => downloadExport('/import/stock/template').catch(e => toast.error((e as Error).message))}>下载导入模板</Button>
            </div>
            <div className="space-y-1">
              <Label>选择文件（.xlsx）</Label>
              <input ref={importFileRef} type="file" accept=".xlsx,.xls" className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) void handleImportStock(f); e.target.value = '' }} />
              <Button variant="outline" className="w-full" onClick={() => importFileRef.current?.click()} disabled={importing}>
                {importing ? '导入中…' : '选择文件并上传'}
              </Button>
            </div>
            {importResult && (
              <div className="rounded-lg border p-3 text-sm space-y-1">
                <p className="text-success font-medium">导入成功：{importResult.success} 条</p>
                {importResult.errors.length > 0 && (
                  <div className="max-h-40 overflow-y-auto text-destructive text-xs space-y-0.5">
                    {importResult.errors.slice(0, 20).map((err, i) => <p key={i}>{err}</p>)}
                  </div>
                )}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <ProductFinder open={productFinderOpen} warehouseId={form.warehouseId ? +form.warehouseId : null}
        onConfirm={p => { setForm(f => ({ ...f, productId: String(p.id), productName: p.name })); setProductFinderOpen(false) }}
        onClose={() => setProductFinderOpen(false)} />

      <InventoryOverviewQueryDialog
        open={overviewQueryOpen}
        initial={initialOverviewQuery}
        onClose={() => setOverviewQueryOpen(false)}
        onApply={applyOverviewQuery}
      />
      <InventoryLogsQueryDialog
        open={logsQueryOpen}
        initial={initialLogsQuery}
        onClose={() => setLogsQueryOpen(false)}
        onApply={applyLogsQuery}
      />
    </div>
  )
}
