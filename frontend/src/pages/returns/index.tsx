import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import PageHeader from '@/components/shared/PageHeader'
import DataTable from '@/components/shared/DataTable'
import { FilterCard } from '@/components/shared/FilterCard'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import TableActionsMenu from '@/components/shared/TableActionsMenu'
import { SoftStatusLabel } from '@/components/shared/StatusBadge'
import { getPurchaseReturnsApi, createPurchaseReturnApi, confirmPurchaseReturnApi, executePurchaseReturnApi, cancelPurchaseReturnApi, getSaleReturnsApi, createSaleReturnApi, confirmSaleReturnApi, executeSaleReturnApi, cancelSaleReturnApi, getPurchaseReturnSourceOrderApi, getSaleReturnSourceOrderApi } from '@/api/returns'
import { downloadExport } from '@/lib/exportDownload'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { toast } from '@/lib/toast'
import { useSuppliers } from '@/hooks/useSuppliers'
import { useCustomersActive } from '@/hooks/useCustomers'
import { useWarehousesActive } from '@/hooks/useWarehouses'
import { useProducts } from '@/hooks/useProducts'
import { formatDisplayDateTime } from '@/lib/dateTime'
import type { PurchaseReturn, SaleReturn, PurchaseReturnSourceOrder, SaleReturnSourceOrder } from '@/api/returns'
import type { TableColumn } from '@/types'

interface DraftItem{_key:number;sourceItemId?:number|null;productId:number;productCode:string;productName:string;unit:string;quantity:number;unitPrice:number;originalQty?:number;returnedQty?:number;remainingQty?:number}
type BoundSourceOrder = PurchaseReturnSourceOrder | SaleReturnSourceOrder

function ReturnForm({ type, onClose, onSuccess }: { type:'purchase'|'sale'; onClose:()=>void; onSuccess:()=>void }) {
  const {data:suppliers}=useSuppliers({page:1,pageSize:200,keyword:''})
  const {data:customers}=useCustomersActive()
  const {data:warehouses}=useWarehousesActive()
  const {data:products}=useProducts({page:1,pageSize:200,keyword:''})
  const [partyId,setPartyId]=useState(''); const [whId,setWhId]=useState('')
  const [orderNo,setOrderNo]=useState(''); const [remark,setRemark]=useState('')
  const [items,setItems]=useState<DraftItem[]>([]); const [counter,setCounter]=useState(0)
  const [submitting,setSubmitting]=useState(false)
  const [loadingSource,setLoadingSource]=useState(false)
  const [boundSource,setBoundSource]=useState<BoundSourceOrder|null>(null)

  const addItem=()=>{setCounter(c=>c+1);setItems(p=>[...p,{_key:counter,productId:0,productCode:'',productName:'',unit:'',quantity:1,unitPrice:0}])}
  const removeItem=(k:number)=>setItems(p=>p.filter(i=>i._key!==k))
  const selectProduct=(k:number,pid:string)=>{
    if(!pid||pid==='__none__'){ setItems(prev=>prev.map(i=>i._key===k?{...i,sourceItemId:null,productId:0,productCode:'',productName:'',unit:'',unitPrice:0,originalQty:undefined,returnedQty:undefined,remainingQty:undefined}:i)); return }
    const p=products?.list.find(x=>String(x.id)===pid); if(p) setItems(prev=>prev.map(i=>i._key===k?{...i,sourceItemId:null,productId:p.id,productCode:p.code,productName:p.name,unit:p.unit,unitPrice:0,originalQty:undefined,returnedQty:undefined,remainingQty:undefined}:i))
  }
  const updateItem=(k:number,f:string,v:number)=>setItems(p=>p.map(i=>i._key===k?{...i,[f]:v}:i))

  const clearSourceBinding=()=>{
    setBoundSource(null)
    setOrderNo('')
    setPartyId('')
    setWhId('')
    setItems([])
  }

  const loadSourceOrder=async()=>{
    const trimmed=orderNo.trim()
    if(!trimmed){ toast.warning('请先填写关联原单号'); return }
    setLoadingSource(true)
    try{
      const source=type==='purchase'
        ? await getPurchaseReturnSourceOrderApi(trimmed)
        : await getSaleReturnSourceOrderApi(trimmed)
      if(!source) return
      setBoundSource(source)
      if(type==='purchase' && 'supplierId' in source) setPartyId(String(source.supplierId))
      if(type==='sale' && 'customerId' in source) setPartyId(String(source.customerId))
      setWhId(String(source.warehouseId))
      const nextItems=source.items
        .filter(item=>item.remainingQty>0)
        .map((item,index)=>({
          _key:index+1,
          sourceItemId:item.sourceItemId,
          productId:item.productId,
          productCode:item.productCode,
          productName:item.productName,
          unit:item.unit,
          quantity:item.remainingQty,
          unitPrice:item.unitPrice,
          originalQty:item.quantity,
          returnedQty:item.returnedQty,
          remainingQty:item.remainingQty,
        }))
      setCounter(nextItems.length)
      setItems(nextItems)
      if(!nextItems.length) toast.warning('该原单已无剩余可退数量')
      else toast.success('已载入原单真实明细与成交价')
    } finally { setLoadingSource(false) }
  }

  const handleSubmit=async(e:React.FormEvent)=>{
    e.preventDefault()
    const wh=warehouses?.find(w=>String(w.id)===whId)
    if(!partyId||!wh||!items.length||items.find(i=>!i.productId)) { toast.warning('请完整填写所有字段'); return }
    const payloadItems=items.map(({_key,...r})=>r)
    setSubmitting(true)
    try {
      if(type==='purchase'){
        const s=suppliers?.list.find(s=>String(s.id)===partyId)
        if(!s) return; await createPurchaseReturnApi({supplierId:s.id,supplierName:s.name,warehouseId:wh.id,warehouseName:wh.name,purchaseOrderId:boundSource&&'supplierId' in boundSource ? boundSource.id : undefined,purchaseOrderNo:orderNo||undefined,remark:remark||undefined,items:payloadItems})
      } else {
        const c=customers?.find(c=>String(c.id)===partyId)
        if(!c) return; await createSaleReturnApi({customerId:c.id,customerName:c.name,warehouseId:wh.id,warehouseName:wh.name,saleOrderId:boundSource&&'customerId' in boundSource ? boundSource.id : undefined,saleOrderNo:orderNo||undefined,remark:remark||undefined,items:payloadItems})
      }
      onSuccess(); onClose()
    } finally { setSubmitting(false) }
  }
  const partyList = type==='purchase' ? suppliers?.list : customers
  const total=items.reduce((s,i)=>s+i.quantity*i.unitPrice,0)

  return (
    <form onSubmit={handleSubmit} className="space-y-4 py-2">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1"><Label>{type==='purchase'?'供应商':'客户'} *</Label>
          <Select value={partyId || '__none__'} onValueChange={v => setPartyId(v === '__none__' ? '' : v)} disabled={!!boundSource}>
            <SelectTrigger className="h-10 w-full"><SelectValue placeholder="请选择" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">请选择</SelectItem>
              {partyList?.map((p: { id: number; name: string }) => (
                <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>
              ))}
            </SelectContent>
          </Select></div>
        <div className="space-y-1"><Label>仓库 *</Label>
          <Select value={whId || '__none__'} onValueChange={v => setWhId(v === '__none__' ? '' : v)} disabled={!!boundSource}>
            <SelectTrigger className="h-10 w-full"><SelectValue placeholder="请选择" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">请选择</SelectItem>
              {warehouses?.map(w => (
                <SelectItem key={w.id} value={String(w.id)}>{w.name}</SelectItem>
              ))}
            </SelectContent>
          </Select></div>
        <div className="space-y-1">
          <Label>关联原单号</Label>
          <div className="flex gap-2">
            <Input value={orderNo} onChange={(e:React.ChangeEvent<HTMLInputElement>)=>{ const next=e.target.value; setOrderNo(next); if(boundSource && next.trim()!==boundSource.orderNo){ setBoundSource(null); setItems([]) } }} placeholder="优先基于原单带价" disabled={loadingSource} />
            <Button type="button" variant="outline" onClick={loadSourceOrder} disabled={loadingSource || !orderNo.trim()}>
              {loadingSource?'载入中...':'载入原单'}
            </Button>
            {boundSource && (
              <Button type="button" variant="ghost" onClick={clearSourceBinding}>
                清除
              </Button>
            )}
          </div>
        </div>
        <div className="space-y-1"><Label>备注</Label><Input value={remark} onChange={(e:React.ChangeEvent<HTMLInputElement>)=>setRemark(e.target.value)} /></div>
      </div>
      {boundSource && (
        <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          已锚定原单 {boundSource.orderNo}。退货单价默认取原单真实成交价，数量默认取剩余可退数量。
        </div>
      )}
      <div>
        <div className="flex items-center justify-between mb-2"><Label className="font-semibold">退货明细</Label><Button type="button" size="sm" variant="outline" onClick={addItem} disabled={!!boundSource}>+ 添加行</Button></div>
        {!items.length&&<p className="text-sm text-muted-foreground text-center py-4 border rounded">暂无明细</p>}
        {items.map(item=>(
          <div key={item._key} className="grid grid-cols-12 gap-2 mb-2 items-center">
            <div className="col-span-4">
              <Select value={item.productId ? String(item.productId) : '__none__'} onValueChange={v => selectProduct(item._key, v)} disabled={!!boundSource}>
                <SelectTrigger className="w-full h-9 text-sm"><SelectValue placeholder="选择商品" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">选择商品</SelectItem>
                  {products?.list.map(p => (
                    <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select></div>
            <div className="col-span-1 text-sm text-center text-muted-foreground">{item.unit||'-'}</div>
            <div className="col-span-3"><Input type="number" min="0.01" step="0.01" placeholder="数量" value={item.quantity} onChange={(e:React.ChangeEvent<HTMLInputElement>)=>updateItem(item._key,'quantity',+e.target.value)} className="text-sm" /></div>
            <div className="col-span-3"><Input type="number" min="0" step="0.01" placeholder="单价" value={item.unitPrice} onChange={(e:React.ChangeEvent<HTMLInputElement>)=>updateItem(item._key,'unitPrice',+e.target.value)} className="text-sm" /></div>
            <div className="col-span-1 text-right"><Button type="button" size="sm" variant="ghost" className="text-red-500 px-2" onClick={()=>removeItem(item._key)}>✕</Button></div>
            {(item.originalQty != null || item.returnedQty != null || item.remainingQty != null) && (
              <div className="col-span-12 -mt-1 text-right text-[11px] text-muted-foreground">
                原单数量 {Number(item.originalQty || 0).toFixed(2)}，已退 {Number(item.returnedQty || 0).toFixed(2)}，剩余可退 {Number(item.remainingQty || 0).toFixed(2)}
              </div>
            )}
          </div>
        ))}
        {items.length>0&&<div className="text-right text-sm font-semibold mt-2">合计：¥{total.toFixed(2)}</div>}
      </div>
      <DialogFooter><Button type="button" variant="outline" onClick={onClose} disabled={submitting}>取消</Button><Button type="submit" disabled={submitting}>{submitting?'创建中...':'创建退货单'}</Button></DialogFooter>
    </form>
  )
}

function ReturnList({ type }: { type: 'purchase'|'sale' }) {
  const qc=useQueryClient()
  const [page,setPage]=useState(1); const [keyword,setKeyword]=useState(''); const [search,setSearch]=useState('')
  const [open,setOpen]=useState(false)
  const [confirmState,setConfirmState]=useState<{open:boolean;title:string;description:string;onConfirm:()=>void}>({open:false,title:'',description:'',onConfirm:()=>{}})
  const openConfirm=(title:string,description:string,onConfirm:()=>void)=>setConfirmState({open:true,title,description,onConfirm})
  const closeConfirm=()=>setConfirmState(s=>({...s,open:false}))
  const [pendingId,setPendingId]=useState<number|null>(null)
  const apiList = type==='purchase'?getPurchaseReturnsApi:getSaleReturnsApi
  const {data,isLoading}=useQuery({queryKey:['returns',type,{page,keyword}],queryFn:()=>apiList({page,pageSize:20,keyword}).then(r=>r!)})
  const inv=()=>qc.invalidateQueries({queryKey:['returns',type]})
  const confirmFn=type==='purchase'?confirmPurchaseReturnApi:confirmSaleReturnApi
  const executeFn=type==='purchase'?executePurchaseReturnApi:executeSaleReturnApi
  const cancelFn =type==='purchase'?cancelPurchaseReturnApi:cancelSaleReturnApi
  const mut=(fn:()=>Promise<unknown>,id?:number)=>{
    if(id) setPendingId(id)
    fn()
      .then(inv)
      .finally(() => { if(id) setPendingId(null) })
  }
  type RowType = PurchaseReturn | SaleReturn
  const partyKey = type==='purchase' ? 'supplierName' : 'customerName'

  const columns:TableColumn<RowType>[]=[
    {key:'returnNo',title:'退货单号',width:170},
    {key:partyKey,title:type==='purchase'?'供应商':'客户'},
    {key:'warehouseName',title:'仓库',width:120},
    {key:'totalAmount',title:'金额',width:100,render:(v)=>`¥${Number(v).toFixed(2)}`},
    {key:'status',title:'状态',width:90,render:(v,row)=>{
      const status = v as number
      const tone = status === 3 ? 'success' : status === 4 ? 'danger' : status === 1 ? 'draft' : 'active'
      return <SoftStatusLabel label={(row as RowType).statusName} tone={tone} />
    }},
    {key:'operatorName',title:'经办人',width:90},
    {key:'createdAt',title:'时间',width:160,render:(v)=>formatDisplayDateTime(v)},
    {key:'id',title:'操作',width:180,render:(_,row)=>{const r=row as RowType;
      if (r.status !== 1 && r.status !== 2) return <span className="text-xs text-muted-foreground">—</span>
      return(
        <TableActionsMenu
          primaryLabel={r.status===1 ? (pendingId===r.id ? '处理中...' : '确认') : (pendingId===r.id ? '处理中...' : '执行退货')}
          onPrimaryClick={()=>{
            if (r.status===1) mut(()=>confirmFn(r.id),r.id)
            else openConfirm('执行退货',type==='purchase'?'确认执行退货？将扣减对应库存。':'确认执行退货入库？将增加对应库存。',()=>mut(()=>executeFn(r.id),r.id))
          }}
          primaryDisabled={pendingId===r.id}
          items={[
            {
              label: pendingId===r.id ? '处理中...' : '取消',
              onClick:()=>openConfirm('取消退货单','确认取消此退货单？',()=>mut(()=>cancelFn(r.id),r.id)),
              disabled: pendingId===r.id,
              destructive:true,
              separatorBefore:true,
            },
          ]}
        />
      )
    }}
  ]
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <FilterCard className="flex-1">
          <Input placeholder="搜索单号..." value={search} onChange={(e:React.ChangeEvent<HTMLInputElement>)=>setSearch(e.target.value)} className="h-9 w-56" onKeyDown={(e:React.KeyboardEvent)=>{if(e.key==='Enter'){setKeyword(search);setPage(1)}}} />
          <Button size="sm" variant="outline" onClick={()=>{setKeyword(search);setPage(1)}}>搜索</Button>
          {keyword && <Button size="sm" variant="ghost" onClick={()=>{setSearch('');setKeyword('');setPage(1)}}>重置</Button>}
        </FilterCard>
        <div className="flex shrink-0 gap-2">
          <Button variant="outline" onClick={()=>downloadExport(type==='purchase'?'/export/purchase-returns':'/export/sale-returns').catch(e=>toast.error((e as Error).message))}>导出 Excel</Button>
          <Button onClick={()=>setOpen(true)}>+ 新建{type==='purchase'?'采购':'销售'}退货单</Button>
        </div>
      </div>
      <DataTable columns={columns} data={(data?.list||[]) as RowType[]} loading={isLoading} pagination={data?.pagination} onPageChange={setPage} />
      <ConfirmDialog
        open={confirmState.open}
        title={confirmState.title}
        description={confirmState.description}
        variant={confirmState.title.includes('取消')?'destructive':'default'}
        confirmText={confirmState.title.includes('取消')?'确认取消':'确认执行'}
        onConfirm={()=>{ closeConfirm(); confirmState.onConfirm() }}
        onCancel={closeConfirm}
      />
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>新建{type==='purchase'?'采购':'销售'}退货单</DialogTitle></DialogHeader>
          <ReturnForm type={type} onClose={()=>setOpen(false)} onSuccess={inv} />
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default function ReturnsPage() {
  const [tab,setTab]=useState<'purchase'|'sale'>('purchase')
  return (
    <div className="space-y-4">
      <PageHeader title="退货管理" description="采购退货（减库存）与销售退货（加库存）" />
      <div className="flex gap-1 border-b">
        {(['purchase','sale'] as const).map(t=>(
          <button key={t} onClick={()=>setTab(t)} className={`px-4 py-2 text-sm font-medium transition-colors ${tab===t?'border-b-2 border-primary text-primary':'text-muted-foreground hover:text-foreground'}`}>
            {t==='purchase'?'采购退货':'销售退货'}
          </button>
        ))}
      </div>
      <ReturnList type={tab} />
    </div>
  )
}
