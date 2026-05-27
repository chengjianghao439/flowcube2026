import { useState, useRef, useMemo, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import PageHeader from '@/components/shared/PageHeader'
import DataTable from '@/components/shared/DataTable'
import { FilterCard } from '@/components/shared/FilterCard'
import CategoryTreeSelect from '@/components/shared/CategoryTreeSelect'
import CategoryPathDisplay from '@/components/shared/CategoryPathDisplay'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { useProducts, useDeleteProduct } from '@/hooks/useProducts'
import { useCategoryTree } from '@/hooks/useCategories'
import { downloadExport } from '@/lib/exportDownload'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import TableActionsMenu from '@/components/shared/TableActionsMenu'
import { toast } from '@/lib/toast'
import { payloadClient as client } from '@/api/client'
import { printProductLabelApi } from '@/api/products'
import {
  isDesktopLocalPrintError,
  tryDesktopLocalZplThenComplete,
} from '@/lib/desktopLocalPrint'
import { readNullableIntParam, readPositiveIntParam, readStringParam, upsertSearchParams } from '@/lib/urlSearchParams'
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
  const page = readPositiveIntParam(searchParams, 'page', 1)
  const keyword = readStringParam(searchParams, 'keyword')
  const catFilter = readNullableIntParam(searchParams, 'categoryId')
  const [search, setSearch] = useState(keyword)
  const [importOpen, setImportOpen] = useState(false)
  const [confirmProduct, setConfirmProduct] = useState<Product | null>(null)
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState<{ success: number; skip: number; errors: string[] } | null>(null)
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

  const { data, isLoading } = useProducts({ page, pageSize:20, keyword, categoryId:catFilter })
  const { data: categoryTree = [] } = useCategoryTree()
  const { mutate: del } = useDeleteProduct()

  useEffect(() => {
    setSearch(keyword)
  }, [keyword])

  function updateParams(updates: Record<string, string | number | null | undefined>) {
    setSearchParams(upsertSearchParams(searchParams, updates))
  }

  async function handlePrintProductLabel(p: Product) {
    try {
      const d = await printProductLabelApi(p.id)
      if (!d) return
      if (d.queued) {
        const local = await tryDesktopLocalZplThenComplete({
          jobId: d.jobId,
          content: d.content,
          contentType: d.contentType,
          printerName: d.printerName,
        })
        if (local === 'ok') {
          toast.success('已打印')
          return
        }
        if (isDesktopLocalPrintError(local)) {
          toast.error(local.error)
          return
        }
        if (local === 'skipped_no_desktop') {
          toast.warning('已入队，请在桌面端完成打印')
          return
        }
        if (local === 'skipped_no_payload') {
          toast.warning('已入队，请在打印任务中处理')
          return
        }
        const h = d.dispatchHint
        if (h?.message) {
          toast.warning(h.message)
          return
        }
        toast.success('已加入打印队列')
        return
      }
      toast.warning('未绑定打印机，未创建任务')
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : '打印失败')
    }
  }

  const categoryPathMap = useMemo(() => buildCategoryPathMap(categoryTree), [categoryTree])

  const cols:TableColumn<Product>[] = [
    { key:'code', title:'编码', width:120 },
    { key:'articleNumber', title:'货号', width:100, render:v=>(v as string)||'-' },
    { key:'spec', title:'型号', render:v=>(v as string)||'-' },
    { key:'name', title:'商品名称' },
    { key:'color', title:'颜色', width:80, render:v=>(v as string)||'-' },
    { key:'unit', title:'单位', width:60 },
    { key:'supplierName', title:'供应商', width:100, render:v=>(v as string)||'-' },
    { key:'isActive', title:'状态', width:70, render:(_,r)=><Badge variant="outline" className={`text-xs font-medium ${r.isActive ? 'text-green-700 border-green-300 bg-green-50' : 'text-muted-foreground border-muted-foreground/30 bg-muted/20'}`}>{r.isActive?'启用':'停用'}</Badge> },
    { key:'id', title:'操作', width:140, render:(_,r)=>(
      <TableActionsMenu
        primaryLabel="编辑"
        primaryVariant="outline"
        onPrimaryClick={()=>navigate(`/products/${r.id}`)}
        items={[
          { label:'打印标签', onClick:()=>void handlePrintProductLabel(r) },
          { label:'删除', onClick:()=>setConfirmProduct(r), destructive:true, separatorBefore:true },
        ]}
      />
    )},
  ]

  return (
    <div className="space-y-4">
      <PageHeader title="商品管理" description="管理商品档案与分类" actions={
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" onClick={()=>downloadExport('/export/stock').catch(e=>toast.error((e as Error).message))}>导出库存</Button>
          <Button variant="outline" onClick={()=>setImportOpen(true)}>批量导入</Button>
          <Button variant="outline" onClick={()=>navigate('/categories')}>分类管理</Button>
          <Button onClick={()=>navigate('/products/new')}>新增商品</Button>
        </div>
      } />

      <FilterCard>
        <Input placeholder="搜索编码/名称/条码" value={search} onChange={(e:React.ChangeEvent<HTMLInputElement>)=>setSearch(e.target.value)} onKeyDown={(e:React.KeyboardEvent)=>e.key==='Enter'&&updateParams({ keyword: search, page: 1 })} className="h-9 w-60" />
        <CategoryTreeSelect
          value={catFilter}
          onChange={(v) => {
            updateParams({ categoryId: v, page: 1 })
          }}
          emptyLabel="全部分类"
          leafOnly
          className="w-48"
        />
        <Button size="sm" variant="outline" onClick={()=>updateParams({ keyword: search, page: 1 })}>搜索</Button>
        {(keyword || catFilter) && <Button size="sm" variant="ghost" onClick={()=>{
          setSearch('')
          updateParams({ keyword: null, categoryId: null, page: 1 })
        }}>重置</Button>}
      </FilterCard>
      <DataTable columns={cols} data={data?.list??[]} loading={isLoading} pagination={data?.pagination} onPageChange={(nextPage)=>updateParams({ page: nextPage })} rowKey="id" />

      {/* 批量导入弹窗 */}
      <Dialog open={importOpen} onOpenChange={v=>{ setImportOpen(v); if(!v) setImportResult(null) }}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>批量导入商品</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">请先下载模板，按照格式填写后上传。编码已存在的商品将自动跳过。</p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={()=>downloadExport('/import/products/template').catch(e=>toast.error((e as Error).message))}>下载导入模板</Button>
            </div>
            <div className="space-y-1">
              <Label>选择文件（.xlsx）</Label>
              <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleImport} />
              <Button variant="outline" className="w-full" onClick={()=>fileRef.current?.click()} disabled={importing}>
                {importing ? '导入中...' : '选择文件并上传'}
              </Button>
            </div>
            {importResult && (
              <div className="rounded-lg border p-3 text-sm space-y-1">
                <p className="text-success font-medium">导入成功：{importResult.success} 条</p>
                {importResult.skip > 0 && <p className="text-muted-foreground">跳过（已存在）：{importResult.skip} 条</p>}
                {importResult.errors.length > 0 && (
                  <div className="mt-2">
                    <p className="text-destructive font-medium">失败 {importResult.errors.length} 条：</p>
                    <ul className="mt-1 space-y-0.5 text-destructive text-xs max-h-32 overflow-y-auto">
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
    </div>
  )
}
