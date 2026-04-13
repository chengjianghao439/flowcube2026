import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { downloadExport } from '@/lib/exportDownload'
import { toast } from '@/lib/toast'
import PageHeader from '@/components/shared/PageHeader'
import { FocusModePanel } from '@/components/shared/FocusModePanel'
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

type Tab = 'stock' | 'logs'
type OpType = 'outbound'

const emptyOp = {
  productId: '',  productName: '',
  warehouseId: '', warehouseName: '',
  quantity: '', unitPrice: '', remark: '',
}

export default function InventoryPage() {
  const navigate = useNavigate()
  const [tab, setTab] = useState<Tab>('stock')
  const [stockPage, setStockPage] = useState(1); const [stockKw, setStockKw] = useState(''); const [stockSearch, setStockSearch] = useState('')
  const [logPage, setLogPage] = useState(1); const [logType, setLogType] = useState<number|null>(null)
  const [opOpen, setOpOpen] = useState(false); const [opType, setOpType] = useState<OpType>('outbound')
  const [form, setForm] = useState(emptyOp)
  const [productFinderOpen,  setProductFinderOpen]  = useState(false)
  const [warehouseFinderOpen, setWarehouseFinderOpen] = useState(false)

  const { data: stocks, isLoading: stockLoading } = useStock({ page:stockPage, pageSize:20, keyword:stockKw })
  const { data: logs, isLoading: logLoading } = useLogs({ page:logPage, pageSize:20, type:logType })
  const { mutate: outbound, isPending } = useOutbound()
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

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
    { key:'quantity', title:'库存数量', width:110, render:(_,r)=><span className={`font-mono font-medium ${r.quantity<=0?'text-destructive':''}`}>{r.quantity}</span> },
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

      <FocusModePanel
        badge="默认视角"
        title="库存页负责看库存现状、识别风险，并决定是否进入盘点或异常处理"
        description="这里适合先判断库存数量、库存日志和出库动作是否正常；如果发现负库存、异常波动或需要校正库存，直接切去盘点、岗位工作台或异常工作台。"
        summary={`当前视角：${tab === 'stock' ? '当前库存' : '出入库记录'}`}
        steps={[
          '先看当前库存，优先识别负库存、零库存和重点仓库库存不足。',
          '再看出入库记录，确认最近的出库、调整和现场操作是否合理。',
          '需要调整时直接进入盘点；发现异常时回岗位工作台或异常工作台继续推进。',
        ]}
        actions={[
          { label: '打开库存盘点', variant: 'default', onClick: () => navigate('/stockcheck') },
          { label: '打开岗位工作台', onClick: () => navigate('/reports/role-workbench') },
          { label: '打开异常工作台', onClick: () => navigate('/reports/exception-workbench') },
        ]}
      />

      {/* 标签切换 */}
      <div className="mb-4 flex gap-1 border-b border-border">
        {(['stock','logs'] as Tab[]).map(t=>(
          <button key={t} onClick={()=>setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${tab===t?'border-primary text-foreground':'border-transparent text-muted-foreground hover:text-foreground'}`}>
            {t==='stock'?'当前库存':'出入库记录'}
          </button>
        ))}
      </div>

      {tab==='stock' && (
        <>
          <FilterCard>
            <Input placeholder="搜索商品编码或名称" value={stockSearch} onChange={(e:React.ChangeEvent<HTMLInputElement>)=>setStockSearch(e.target.value)} onKeyDown={(e:React.KeyboardEvent)=>e.key==='Enter'&&(setStockPage(1),setStockKw(stockSearch))} className="h-9 w-60" />
            <Button size="sm" variant="outline" onClick={()=>{setStockPage(1);setStockKw(stockSearch)}}>搜索</Button>
            {stockKw&&<Button size="sm" variant="ghost" onClick={()=>{setStockSearch('');setStockKw('');setStockPage(1)}}>重置</Button>}
          </FilterCard>
          <DataTable columns={stockCols} data={stocks?.list??[]} loading={stockLoading} pagination={stocks?.pagination} onPageChange={setStockPage} rowKey="id" emptyText="暂无库存记录，请先进行入库操作" />
        </>
      )}

      {tab==='logs' && (
        <>
          <FilterCard>
            <Select
              value={logType == null ? '__all__' : String(logType)}
              onValueChange={v => {
                setLogType(v === '__all__' ? null : +v)
                setLogPage(1)
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
          <DataTable columns={logCols} data={logs?.list??[]} loading={logLoading} pagination={logs?.pagination} onPageChange={setLogPage} rowKey="id" />
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
