import { useState, useRef } from 'react'
import PageHeader from '@/components/shared/PageHeader'
import DataTable from '@/components/shared/DataTable'
import { FilterCard } from '@/components/shared/FilterCard'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { useProducts, useCategories, useCreateProduct, useUpdateProduct, useDeleteProduct, useCreateCategory, useDeleteCategory } from '@/hooks/useProducts'
import { downloadExport } from '@/lib/exportDownload'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { LimitedInput } from '@/components/shared/LimitedInput'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import TableActionsMenu from '@/components/shared/TableActionsMenu'
import { toast } from '@/lib/toast'
import client from '@/api/client'
import { printProductLabelApi } from '@/api/products'
import {
  isDesktopLocalPrintError,
  tryDesktopLocalZplThenComplete,
} from '@/lib/desktopLocalPrint'
import type { Product } from '@/types/products'
import type { TableColumn } from '@/types'

const emptyProd = { name:'', categoryId:null as number|null, unit:'个', spec:'', barcode:'', costPrice:'' as string, salePrice:'' as string, remark:'', isActive:true }

export default function ProductsPage() {
  const [page, setPage] = useState(1); const [keyword, setKeyword] = useState(''); const [search, setSearch] = useState('')
  const [catFilter, setCatFilter] = useState<number|null>(null)
  const [open, setOpen] = useState(false); const [edit, setEdit] = useState<Product|null>(null)
  const [form, setForm] = useState(emptyProd)
  const [newCat, setNewCat] = useState(''); const [catOpen, setCatOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [confirmProduct, setConfirmProduct] = useState<Product | null>(null)
  const [confirmCat, setConfirmCat] = useState<{id:number;name:string} | null>(null)
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState<{ success: number; skip: number; errors: string[] } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return
    setImporting(true); setImportResult(null)
    const fd = new FormData(); fd.append('file', file)
    try {
      const r = await client.post('/import/products', fd, { headers: { 'Content-Type': 'multipart/form-data' } })
      setImportResult(r.data.data)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '导入失败'
      toast.error(msg)
    } finally { setImporting(false); e.target.value = '' }
  }

  const { data, isLoading } = useProducts({ page, pageSize:20, keyword, categoryId:catFilter })
  const { data: categories } = useCategories()
  const { mutate: create, isPending: creating } = useCreateProduct()
  const { mutate: update, isPending: updating } = useUpdateProduct()
  const { mutate: del } = useDeleteProduct()
  const { mutate: addCat } = useCreateCategory()
  const { mutate: delCat } = useDeleteCategory()
  const isPending = creating || updating
  const set = (k:string, v:unknown) => setForm(f=>({...f,[k]:v}))

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
          toast.success(d.printerName ? `已向 ${d.printerName} 提交产品条码标签` : '已提交产品条码标签')
          return
        }
        if (isDesktopLocalPrintError(local)) {
          toast.error(local.error)
          return
        }
        if (local === 'skipped_no_desktop') {
          toast.warning('任务已入队，请在极序 Flow 桌面端登录同一服务器后执行打印。')
          return
        }
        if (local === 'skipped_no_payload') {
          toast.warning('任务已入队，但响应中缺少本机打印内容，请在打印任务中处理。')
          return
        }
        const h = d.dispatchHint
        if (h?.message) {
          toast.warning(h.message)
          return
        }
        toast.success(d.printerCode ? `已加入打印队列 → ${d.printerCode}` : '已加入打印队列')
        return
      }
      toast.warning('未绑定「产品条码」打印机，未创建打印任务')
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : '打印失败')
    }
  }

  function openCreate() { setEdit(null); setForm(emptyProd); setOpen(true) }
  function openEdit(p:Product) { setEdit(p); setForm({ name:p.name, categoryId:p.categoryId, unit:p.unit, spec:p.spec??'', barcode:p.barcode??'', costPrice:p.costPrice!=null?String(p.costPrice):'', salePrice:p.salePrice!=null?String(p.salePrice):'', remark:p.remark??'', isActive:p.isActive }); setOpen(true) }
  function handleSubmit(e:React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const d = { name:form.name, categoryId:form.categoryId||undefined, unit:form.unit||'个', spec:form.spec||undefined, barcode:form.barcode||undefined, costPrice:form.costPrice!==''?Number(form.costPrice):null, salePrice:form.salePrice!==''?Number(form.salePrice):null, remark:form.remark||undefined }
    if (edit) update({ id:edit.id, data:{...d,isActive:form.isActive} }, { onSuccess:()=>setOpen(false) })
    else create(d, { onSuccess:()=>setOpen(false) })
  }

  const cols:TableColumn<Product>[] = [
    { key:'code', title:'编码', width:130 },
    { key:'name', title:'商品名称' },
    { key:'categoryName', title:'分类', width:100, render:v=>(v as string)||'-' },
    { key:'unit', title:'单位', width:70 },
    { key:'spec', title:'规格', render:v=>(v as string)||'-' },
    { key:'costPrice', title:'成本价', width:90, render:v=>v!=null?`¥${v}`:'-' },
    { key:'salePrice', title:'售价', width:90, render:v=>v!=null?`¥${v}`:'-' },
    { key:'isActive', title:'状态', width:80, render:(_,r)=><Badge variant={r.isActive?'default':'destructive'}>{r.isActive?'启用':'停用'}</Badge> },
    { key:'id', title:'操作', width:160, render:(_,r)=>(
      <TableActionsMenu
        primaryLabel="编辑"
        onPrimaryClick={()=>openEdit(r)}
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
          <Button variant="outline" onClick={()=>setCatOpen(true)}>分类管理</Button>
          <Button onClick={openCreate}>新增商品</Button>
        </div>
      } />

      <FilterCard>
        <Input placeholder="搜索编码/名称/条码" value={search} onChange={(e:React.ChangeEvent<HTMLInputElement>)=>setSearch(e.target.value)} onKeyDown={(e:React.KeyboardEvent)=>e.key==='Enter'&&(setPage(1),setKeyword(search))} className="h-9 w-60" />
        <Select
          value={catFilter == null ? '__all__' : String(catFilter)}
          onValueChange={v => {
            setCatFilter(v === '__all__' ? null : +v)
            setPage(1)
          }}
        >
          <SelectTrigger className="h-9 w-44">
            <SelectValue placeholder="全部分类" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">全部分类</SelectItem>
            {categories?.map(c => (
              <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button size="sm" variant="outline" onClick={()=>{setPage(1);setKeyword(search)}}>搜索</Button>
        {keyword && <Button size="sm" variant="ghost" onClick={()=>{setSearch('');setKeyword('');setPage(1)}}>重置</Button>}
      </FilterCard>
      <DataTable columns={cols} data={data?.list??[]} loading={isLoading} pagination={data?.pagination} onPageChange={setPage} rowKey="id" />

      {/* 商品表单 */}
      <Dialog open={open} onOpenChange={v=>!v&&setOpen(false)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>{edit?'编辑商品':'新增商品'}</DialogTitle></DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              {edit && (
                <div className="space-y-1">
                  <Label>商品编码</Label>
                  <Input value={edit.code} disabled className="bg-muted/50 font-mono text-sm" />
                </div>
              )}
              <div className="space-y-2"><Label>名称 *</Label><Input value={form.name} onChange={(e:React.ChangeEvent<HTMLInputElement>)=>set('name',e.target.value)} disabled={isPending}/></div>
              <div className="space-y-2"><Label>分类</Label>
                <Select
                  value={form.categoryId == null ? '__none__' : String(form.categoryId)}
                  onValueChange={v => set('categoryId', v === '__none__' ? null : +v)}
                  disabled={isPending}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="无分类" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">无分类</SelectItem>
                    {categories?.map(c => (
                      <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2"><Label>单位</Label><Input value={form.unit} onChange={(e:React.ChangeEvent<HTMLInputElement>)=>set('unit',e.target.value)} disabled={isPending} placeholder="个"/></div>
              <div className="space-y-2"><Label>规格型号</Label><LimitedInput maxLength={5} value={form.spec} onChange={(e:React.ChangeEvent<HTMLInputElement>)=>set('spec',e.target.value)} disabled={isPending}/></div>
              <div className="space-y-2"><Label>条形码</Label><Input value={form.barcode} onChange={(e:React.ChangeEvent<HTMLInputElement>)=>set('barcode',e.target.value)} disabled={isPending}/></div>
              <div className="space-y-2"><Label>成本价</Label><Input type="number" step="0.01" value={form.costPrice} onChange={(e:React.ChangeEvent<HTMLInputElement>)=>set('costPrice',e.target.value)} disabled={isPending}/></div>
              <div className="space-y-2"><Label>售价</Label><Input type="number" step="0.01" value={form.salePrice} onChange={(e:React.ChangeEvent<HTMLInputElement>)=>set('salePrice',e.target.value)} disabled={isPending}/></div>
            </div>
            <div className="space-y-2"><Label>备注</Label><LimitedInput maxLength={30} value={form.remark} onChange={(e:React.ChangeEvent<HTMLInputElement>)=>set('remark',e.target.value)} disabled={isPending}/></div>
            {edit && <div className="flex items-center gap-2"><input type="checkbox" id="pd-active" checked={form.isActive} onChange={(e:React.ChangeEvent<HTMLInputElement>)=>set('isActive',e.target.checked)} className="accent-primary"/><Label htmlFor="pd-active" className="cursor-pointer">启用</Label></div>}
            <DialogFooter><Button type="button" variant="outline" onClick={()=>setOpen(false)} disabled={isPending}>取消</Button><Button type="submit" disabled={isPending||!form.name}>{isPending?'保存中...':'保存'}</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* 分类管理 */}
      <Dialog open={catOpen} onOpenChange={v=>!v&&setCatOpen(false)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>分类管理</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div className="flex gap-2">
              <Input placeholder="新分类名称" value={newCat} onChange={(e:React.ChangeEvent<HTMLInputElement>)=>setNewCat(e.target.value)} onKeyDown={(e:React.KeyboardEvent)=>e.key==='Enter'&&newCat&&(addCat({name:newCat},{onSuccess:()=>setNewCat('')}))} />
              <Button onClick={()=>newCat&&addCat({name:newCat},{onSuccess:()=>setNewCat('')})}>添加</Button>
            </div>
            <div className="max-h-60 overflow-y-auto space-y-1">
              {categories?.map(c=>(
                <div key={c.id} className="flex items-center justify-between rounded-md border border-border px-3 py-2">
                  <span className="text-sm">{c.name}</span>
                  <Button size="sm" variant="ghost" onClick={()=>setConfirmCat({id:c.id,name:c.name})}>删除</Button>
                </div>
              ))}
              {!categories?.length && <p className="text-sm text-muted-foreground text-center py-4">暂无分类</p>}
            </div>
          </div>
        </DialogContent>
      </Dialog>

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
        description={`删除商品「${confirmProduct?.name}」？该操作不可撤销。`}
        variant="destructive"
        confirmText="删除"
        onConfirm={() => { del(confirmProduct!.id); setConfirmProduct(null) }}
        onCancel={() => setConfirmProduct(null)}
      />
      <ConfirmDialog
        open={!!confirmCat}
        title="确认删除分类"
        description={`删除分类「${confirmCat?.name}」？该操作不可撤销。`}
        variant="destructive"
        confirmText="删除"
        onConfirm={() => { delCat(confirmCat!.id); setConfirmCat(null) }}
        onCancel={() => setConfirmCat(null)}
      />
    </div>
  )
}
