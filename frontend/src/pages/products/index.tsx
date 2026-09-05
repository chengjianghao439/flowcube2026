import { productIdentityColumns } from '@/components/shared/productIdentityColumns'
import { ImportSteps } from '@/components/shared/ImportSteps'
import { useState, useRef, useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { X } from 'lucide-react'
import PageHeader from '@/components/shared/PageHeader'
import DataTable from '@/components/shared/DataTable'
import Pagination from '@/components/shared/Pagination'
import CategoryPathDisplay from '@/components/shared/CategoryPathDisplay'
import { Button } from '@/components/ui/button'
import { SoftStatusLabel } from '@/components/shared/StatusBadge'
import { activeTone } from '@/lib/statusTone'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { useProducts, useDeleteProduct } from '@/hooks/useProducts'
import { useCategoryTree } from '@/hooks/useCategories'
import { useSuppliers } from '@/hooks/useSuppliers'
import { downloadExport } from '@/lib/exportDownload'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import TableActionsMenu from '@/components/shared/TableActionsMenu'
import { toast } from '@/lib/toast'
import { payloadClient as client } from '@/api/client'
import { printProductLabelApi } from '@/api/products'
import { printQueueFeedback, triggerPrintPoll } from '@/lib/printQueue'
import { readNullableIntParam, readStringParam, upsertSearchParams } from '@/lib/urlSearchParams'
import ProductQueryDialog, { type ProductQueryValues } from './ProductQueryDialog'
import type { Product } from '@/types/products'
import type { TableColumn } from '@/types'
import type { Category } from '@/types/categories'

function buildCategoryPathMap(nodes: Category[], ancestors: string[] = [], map = new Map<number, string>()) {
  for (const node of nodes) {
    const chain = [...ancestors, node.name]
    map.set(node.id, chain.join(' > '))
    if (node.children?.length) buildCategoryPathMap(node.children, chain, map)
  }
  return map
}

export default function ProductsPage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const keyword = readStringParam(searchParams, 'keyword')
  const catFilter = readNullableIntParam(searchParams, 'categoryId')
  const statusFilter = readStringParam(searchParams, 'status')
  const supplierId = readNullableIntParam(searchParams, 'supplierId')
  const supplierName = readStringParam(searchParams, 'supplierName')
  const minPrice = readStringParam(searchParams, 'minPrice')
  const maxPrice = readStringParam(searchParams, 'maxPrice')
  const page = Math.max(1, Number(searchParams.get('page') || '1') || 1)
  const [queryOpen, setQueryOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [confirmProduct, setConfirmProduct] = useState<Product | null>(null)
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState<{ success: number; skip: number; errors: string[] } | null>(null)
  const [printingIds, setPrintingIds] = useState<Set<number>>(new Set())
  const fileRef = useRef<HTMLInputElement>(null)
  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return
    setImporting(true); setImportResult(null)
    const fd = new FormData(); fd.append('file', file)
    try {
      const r = await client.post('/import/products', fd, { headers: { 'Content-Type': 'multipart/form-data' } })
      setImportResult(r as { success: number; skip: number; errors: string[] })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '导入失败'
      toast.error(msg)
    } finally { setImporting(false); e.target.value = '' }
  }

  const PAGE_SIZE = 20
  const { data, isLoading } = useProducts({
    page, pageSize: PAGE_SIZE, keyword, categoryId: catFilter,
    status: statusFilter || undefined,
    supplierId: supplierId ?? undefined,
    minPrice: minPrice || undefined,
    maxPrice: maxPrice || undefined,
  })
  const total = data?.pagination?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const { data: categoryTree = [] } = useCategoryTree()
  const { data: supplierData } = useSuppliers({ pageSize: 500, page: 1 })
  const { mutate: del } = useDeleteProduct()

  function updateParams(updates: Record<string, string | number | null | undefined>) {
    setSearchParams(upsertSearchParams(searchParams, updates))
  }

  async function handlePrintProductLabel(p: Product) {
    if (printingIds.has(p.id)) return
    setPrintingIds((prev) => new Set(prev).add(p.id))
    try {
      const d = await printProductLabelApi(p.id)
      if (!d) return
      if (d.queued) {
        triggerPrintPoll()
        const fb = printQueueFeedback(d.dispatchHint)
        if (fb.level === 'warning') toast.warning(fb.message)
        else toast.success(fb.message)
        return
      }
      toast.warning('未绑定打印机，未创建任务')
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : '打印失败')
    } finally {
      setPrintingIds((prev) => {
        const next = new Set(prev)
        next.delete(p.id)
        return next
      })
    }
  }

  const categoryPathMap = useMemo(() => buildCategoryPathMap(categoryTree), [categoryTree])

  const supplierMap = useMemo(() => {
    const m = new Map<number, string>()
    for (const s of supplierData?.list ?? []) m.set(Number(s.id), s.name)
    return m
  }, [supplierData])

  // 查询弹窗初始值
  const initialQuery: ProductQueryValues = {
    keyword, categoryId: catFilter, status: statusFilter,
    supplierId, supplierName,
    minPrice, maxPrice,
  }
  function applyQuery(v: ProductQueryValues) {
    updateParams({
      keyword: v.keyword || null,
      categoryId: v.categoryId || null,
      status: v.status || null,
      supplierId: v.supplierId || null,
      supplierName: v.supplierName || null,
      minPrice: v.minPrice || null,
      maxPrice: v.maxPrice || null,
      page: 1,
    })
    setQueryOpen(false)
  }
  function clearAll() {
    updateParams({
      keyword: null, categoryId: null, status: null,
      supplierId: null, supplierName: null,
      minPrice: null, maxPrice: null, page: 1,
    })
  }

  // 当前生效筛选摘要（可逐项移除）
  const chips = [
    keyword && { key: 'keyword', label: `关键字：${keyword}`, onRemove: () => updateParams({ keyword: null, page: 1 }) },
    catFilter && { key: 'category', label: `分类：${catFilter}`, onRemove: () => updateParams({ categoryId: null, page: 1 }) },
    statusFilter === '1' && { key: 'status', label: '状态：启用', onRemove: () => updateParams({ status: null, page: 1 }) },
    statusFilter === '0' && { key: 'status', label: '状态：停用', onRemove: () => updateParams({ status: null, page: 1 }) },
    supplierId && { key: 'supplier', label: `供应商：${supplierName || supplierMap.get(supplierId) || supplierId}`, onRemove: () => updateParams({ supplierId: null, supplierName: null, page: 1 }) },
    minPrice && { key: 'minPrice', label: `售价≥${minPrice}`, onRemove: () => updateParams({ minPrice: null, page: 1 }) },
    maxPrice && { key: 'maxPrice', label: `售价≤${maxPrice}`, onRemove: () => updateParams({ maxPrice: null, page: 1 }) },
  ].filter(Boolean) as { key: string; label: string; onRemove: () => void }[]

  const cols:TableColumn<Product>[] = [
    ...productIdentityColumns({code: 'code', name: 'name'}),
    { key:'categoryName', title:'分类', width:180, render:(_, r)=><CategoryPathDisplay path={r.categoryId ? categoryPathMap.get(r.categoryId) ?? null : null} fallback={r.categoryName} /> },
    { key:'unit', title:'单位', width:140, render:(_,r)=>{
      const aux=(r.units||[]).filter(u=>!u.isBase)
      return <div className="flex flex-wrap items-center gap-1"><span>{r.unit}</span>{aux.map(u=><span key={u.unitName} className="rounded bg-muted px-1 text-xs text-muted-foreground tabular-nums">{u.unitName}×{u.conversionRate}</span>)}</div>
    }},
    { key:'supplierName', title:'供应商', width:140, render:v=>(v as string)||'-' },
    { key:'isActive', title:'状态', width:70, render:(_,r)=><SoftStatusLabel label={r.isActive?'启用':'停用'} tone={activeTone(r.isActive)} /> },
    { key:'id', title:'操作', width:140, render:(_,r)=>(
      <TableActionsMenu
        primaryLabel="编辑"
        primaryVariant="outline"
        onPrimaryClick={()=>navigate(`/products/${r.id}`)}
        items={[
          { label:'打印标签', onClick:()=>void handlePrintProductLabel(r), disabled: printingIds.has(r.id) },
          // 改价走审批（v0.5.1 价格体系）：跳转改价申请页并预填商品
          { label:'申请改价', onClick:()=>navigate(`/price-change?productId=${r.id}`) },
          { label:'删除', onClick:()=>setConfirmProduct(r), destructive:true, separatorBefore:true },
        ]}
      />
    )},
  ]

  return (
    <div className="space-y-4">
      <PageHeader title="商品管理" description="管理商品档案与分类" actions={
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" onClick={() => setQueryOpen(true)}>查询</Button>
          <Button variant="outline" onClick={()=>downloadExport('/export/stock').catch(e=>toast.error((e as Error).message))}>导出库存</Button>
          <Button variant="outline" onClick={()=>setImportOpen(true)}>批量导入</Button>
          <Button variant="outline" onClick={()=>navigate('/categories')}>分类管理</Button>
          <Button onClick={()=>navigate('/products/new')}>新增商品</Button>
        </div>
      } />

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

      <DataTable columns={cols} data={data?.list??[]} loading={isLoading} rowKey="id" />
      <Pagination page={page} totalPages={totalPages} total={total} unit="件"
        onPageChange={(p) => updateParams({ page: p })} />

      {/* 批量导入弹窗 */}
      <Dialog open={importOpen} onOpenChange={v=>{ setImportOpen(v); if(!v) setImportResult(null) }}>
        <DialogContent className="max-w-3xl">
          <DialogHeader><DialogTitle>批量导入商品</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">请先下载模板，按照格式填写后上传。编码已存在的商品将自动跳过。</p>
            <ImportSteps template={
              <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={()=>downloadExport('/import/products/template').catch(e=>toast.error((e as Error).message))}>下载导入模板</Button>
            </div>
            } upload={
              <div className="space-y-1">
              <Label>选择文件（.xlsx）</Label>
              <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleImport} />
              <Button variant="outline" className="w-full" onClick={()=>fileRef.current?.click()} disabled={importing}>
                {importing ? '导入中…' : '选择文件并上传'}
              </Button>
            </div>
            } />
            {importResult && (
              <div className="rounded-lg border p-3 text-sm space-y-1">
                <p className="text-success font-medium">导入成功：{importResult.success} 条</p>
                {importResult.skip > 0 && <p className="text-muted-foreground">跳过（已存在）：{importResult.skip} 条</p>}
                {importResult.errors.length > 0 && (
                  <div className="mt-2">
                    <p className="text-destructive font-medium">失败 {importResult.errors.length} 条：</p>
                    <ul className="mt-1 space-y-0.5 text-destructive text-sm leading-6 max-h-32 overflow-y-auto">
                      {importResult.errors.map((e, i) => <li key={i}>{e}</li>)}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
          <DialogFooter><Button variant="outline" onClick={()=>{ setImportOpen(false); setImportResult(null) }}>关闭</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={!!confirmProduct}
        title="确认删除商品"
        description={`删除商品「${confirmProduct?.name}」？仅未被单据、库存或任务引用的商品允许删除；若已被引用，请改为编辑后停用。`}
        variant="destructive"
        confirmText="删除"
        onConfirm={() => { del(confirmProduct!.id); setConfirmProduct(null) }}
        onCancel={() => setConfirmProduct(null)}
      />
      <ProductQueryDialog
        open={queryOpen}
        initial={initialQuery}
        onClose={() => setQueryOpen(false)}
        onApply={applyQuery}
      />
    </div>
  )
}
