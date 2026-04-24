import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
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
import { useStock, useLogs, useOutbound } from '@/hooks/useInventory'
import { WarehouseFinder, ProductFinder, FinderTrigger } from '@/components/finder'
import { formatDisplayDateTime } from '@/lib/dateTime'
import type { StockItem, InventoryLog } from '@/types/inventory'
import type { TableColumn } from '@/types'
import type { ProductFinderResult } from '@/types/products'
import { readPositiveIntParam, readStringParam, upsertSearchParams } from '@/lib/urlSearchParams'

type Tab = 'stock' | 'logs'
type OpType = 'outbound'

const emptyOp = {
  productId: '',  productName: '',
  warehouseId: '', warehouseName: '',
  quantity: '', unitPrice: '', remark: '',
}

export default function InventoryPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const tab = (searchParams.get('tab') === 'logs' ? 'logs' : 'stock') as Tab
  const stockPage = readPositiveIntParam(searchParams, 'stockPage', 1)
  const stockKw = readStringParam(searchParams, 'stockKeyword')
  const logPage = readPositiveIntParam(searchParams, 'logPage', 1)
  const rawLogType = Number(searchParams.get('logType') || '')
  const logType = Number.isInteger(rawLogType) && rawLogType > 0 ? rawLogType : null
  const [stockSearch, setStockSearch] = useState(stockKw)
  const [opOpen, setOpOpen] = useState(false); const [opType, setOpType] = useState<OpType>('outbound')
  const [form, setForm] = useState(emptyOp)
  const [productFinderOpen,  setProductFinderOpen]  = useState(false)
  const [warehouseFinderOpen, setWarehouseFinderOpen] = useState(false)

  const { data: stocks, isLoading: stockLoading } = useStock({ page:stockPage, pageSize:20, keyword:stockKw })
  const { data: logs, isLoading: logLoading } = useLogs({ page:logPage, pageSize:20, type:logType })
  const { mutate: outbound, isPending } = useOutbound()
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  useEffect(() => {
    setStockSearch(stockKw)
  }, [stockKw])

  function updateParams(updates: Record<string, string | number | null | undefined>) {
    setSearchParams(upsertSearchParams(searchParams, updates))
  }

  function openOp(t: OpType) { setOpType(t); setForm(emptyOp); setOpOpen(true) }
  function handleOp(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const base = { productId:+form.productId, warehouseId:+form.warehouseId, quantity:+form.quantity, remark:form.remark||undefined }
    const cb = { onSuccess:()=>setOpOpen(false) }
    outbound({ ...base, supplierId:null, unitPrice:form.unitPrice?+form.unitPrice:null }, cb)
  }

  function handleProductConfirm(p: ProductFinderResult) {
    setForm(f => ({ ...f, productId: String(p.id), productName: p.name }))
    setProductFinderOpen(false)
  }

  const OP_LABELS: Record<OpType, string> = { outbound:'出库' }
  const TYPE_VARIANT: Record<number, 'default'|'secondary'|'outline'> = { 1:'default', 2:'secondary', 3:'outline' }
  const TYPE_NAMES: Record<number, string> = { 1:'入库', 2:'出库', 3:'调整' }

  const stockCols: TableColumn<StockItem>[] = [
    { key:'productCode', title:'商品编码', width:130 },
    { key:'productName', title:'商品名称' },
    { key:'unit', title:'单位', width:70 },
    { key:'warehouseName', title:'仓库', width:130 },
    { key:'quantity', title:'当前库存', width:110, render:(_,r)=><span className={`font-mono font-medium ${r.quantity<=0?'text-destructive':''}`}>{r.quantity}</span> },
    { key:'reserved', title:'已占用', width:100, render:(_,r)=><span className="font-mono text-amber-600">{r.reserved ? r.reserved : '—'}</span> },
    { key:'available', title:'可用库存', width:110, render:(_,r)=><span className="font-mono text-emerald-600">{r.available ?? r.quantity}</span> },
  ]

  const logCols: TableColumn<InventoryLog>[] = [
    { key:'createdAt', title:'时间', width:160, render:v=>formatDisplayDateTime(v) },
    { key:'typeName', title:'类型', width:80, render:(_,r)=><Badge variant={TYPE_VARIANT[r.type]??'outline'}>{TYPE_NAMES[r.type]}</Badge> },
    { key:'productName', title:'商品' },
    { key:'warehouseName', title:'仓库', width:120 },
    { key:'quantity', title:'数量', width:90, render:(_,r)=><span className="font-mono">{r.type===2?`-${r.quantity}`:r.quantity}</span> },
    { key:'beforeQty', title:'变动前', width:90, render:v=><span className="font-mono text-muted-foreground">{v as number}</span> },
    { key:'afterQty', title:'变动后', width:90, render:v=><span className="font-mono">{v as number}</span> },
    { key:'supplierName', title:'供应商', width:120, render:v=>(v as string)||'-' },
    { key:'operatorName', title:'操作人', width:90 },
    { key:'remark', title:'备注', render:v=>(v as string)||'-' },
  ]

  return (
    <div className="space-y-4">
      <PageHeader title="库存管理" description="库存查询；采购入库请走「收货订单」上架后计入库存" actions={
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" onClick={()=>downloadExport(tab==='stock'?'/export/stock':'/export/inventory-logs').catch(e=>toast.error((e as Error).message))}>导出 Excel</Button>
          <Button variant="outline" onClick={()=>openOp('outbound')}>出库</Button>
          <Button variant="outline" asChild><Link to="/stockcheck">盘点调整</Link></Button>
        </div>
      } />

      {/* 标签切换 */}
      <div className="mb-4 flex gap-1 border-b border-border">
        {(['stock','logs'] as Tab[]).map(t=>(
          <button key={t} onClick={()=>updateParams({ tab: t })}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${tab===t?'border-primary text-foreground':'border-transparent text-muted-foreground hover:text-foreground'}`}>
            {t==='stock'?'当前库存':'出入库记录'}
          </button>
        ))}
      </div>

      {tab==='stock' && (
        <>
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/[0.08] px-4 py-3 text-sm text-muted-foreground">
            当前库存显示的是在库数量（on-hand）。销售单“已占库”会增加预占、减少可用，但不会直接减少在库；只有仓库任务实际出库后，在库才会下降。
          </div>
          <FilterCard>
            <Input placeholder="搜索商品编码或名称" value={stockSearch} onChange={(e:React.ChangeEvent<HTMLInputElement>)=>setStockSearch(e.target.value)} onKeyDown={(e:React.KeyboardEvent)=>e.key==='Enter'&&updateParams({ stockKeyword: stockSearch, stockPage: 1 })} className="h-9 w-60" />
            <Button size="sm" variant="outline" onClick={()=>updateParams({ stockKeyword: stockSearch, stockPage: 1 })}>搜索</Button>
            {stockKw&&<Button size="sm" variant="ghost" onClick={()=>{
              setStockSearch('')
              updateParams({ stockKeyword: null, stockPage: 1 })
            }}>重置</Button>}
          </FilterCard>
          <DataTable columns={stockCols} data={stocks?.list??[]} loading={stockLoading} pagination={stocks?.pagination} onPageChange={(nextPage)=>updateParams({ stockPage: nextPage })} rowKey="id" emptyText="暂无库存记录，请先进行入库操作" />
        </>
      )}

      {tab==='logs' && (
        <>
          <FilterCard>
            <Select
              value={logType == null ? '__all__' : String(logType)}
              onValueChange={v => {
                updateParams({ logType: v === '__all__' ? null : +v, logPage: 1 })
              }}
            >
              <SelectTrigger className="h-9 w-36">
                <SelectValue placeholder="全部类型" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">全部类型</SelectItem>
                <SelectItem value="1">入库</SelectItem>
                <SelectItem value="2">出库</SelectItem>
                <SelectItem value="3">调整</SelectItem>
              </SelectContent>
            </Select>
          </FilterCard>
          <DataTable columns={logCols} data={logs?.list??[]} loading={logLoading} pagination={logs?.pagination} onPageChange={(nextPage)=>updateParams({ logPage: nextPage })} rowKey="id" />
        </>
      )}

      {/* 操作弹窗 */}
      <Dialog open={opOpen} onOpenChange={v=>!v&&setOpOpen(false)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>{OP_LABELS[opType]}</DialogTitle></DialogHeader>
          <form onSubmit={handleOp} className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>商品 *</Label>
              <FinderTrigger
                value={form.productName}
                placeholder="点击选择商品..."
                onClick={() => setProductFinderOpen(true)}
                disabled={isPending}
              />
            </div>
            <div className="space-y-2">
              <Label>仓库 *</Label>
              <FinderTrigger
                value={form.warehouseName}
                placeholder="点击选择仓库..."
                onClick={() => setWarehouseFinderOpen(true)}
                disabled={isPending}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2"><Label>数量 *</Label><Input type="number" step="0.0001" min="0" value={form.quantity} onChange={(e:React.ChangeEvent<HTMLInputElement>)=>set('quantity',e.target.value)} disabled={isPending}/></div>
              <div className="space-y-2"><Label>单价</Label><Input type="number" step="0.01" min="0" value={form.unitPrice} onChange={(e:React.ChangeEvent<HTMLInputElement>)=>set('unitPrice',e.target.value)} disabled={isPending} placeholder="选填"/></div>
            </div>
            <div className="space-y-2"><Label>备注</Label><Input value={form.remark} onChange={(e:React.ChangeEvent<HTMLInputElement>)=>set('remark',e.target.value)} disabled={isPending} placeholder="选填"/></div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={()=>setOpOpen(false)} disabled={isPending}>取消</Button>
              <Button type="submit" disabled={isPending||!form.productId||!form.warehouseId||!form.quantity}>{isPending?'提交中...':OP_LABELS[opType]}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Finder 弹窗（渲染在 Dialog 之外，通过 Portal 叠加） */}
      <ProductFinder
        open={productFinderOpen}
        warehouseId={form.warehouseId ? +form.warehouseId : null}
        onConfirm={handleProductConfirm}
        onClose={() => setProductFinderOpen(false)}
      />
      <WarehouseFinder
        open={warehouseFinderOpen}
        onClose={() => setWarehouseFinderOpen(false)}
        onConfirm={r => { setForm(f => ({ ...f, warehouseId: String(r.id), warehouseName: r.name })); setWarehouseFinderOpen(false) }}
      />
    </div>
  )
}
