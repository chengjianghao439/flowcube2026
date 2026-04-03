import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import PageHeader from '@/components/shared/PageHeader'
import DataTable from '@/components/shared/DataTable'
import { FilterCard } from '@/components/shared/FilterCard'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { getTransferListApi, createTransferApi, confirmTransferApi, executeTransferApi, cancelTransferApi } from '@/api/transfer'
import { downloadExport } from '@/lib/exportDownload'
import { formatDisplayDateTime } from '@/lib/dateTime'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { toast } from '@/lib/toast'
import { useWarehousesActive } from '@/hooks/useWarehouses'
import { useProducts } from '@/hooks/useProducts'
import type { TransferOrder, TransferItem } from '@/api/transfer'
import type { TableColumn } from '@/types'

const SC: Record<number,'default'|'secondary'|'outline'|'destructive'> = {1:'secondary',2:'default',3:'outline',4:'destructive'}

interface DraftItem extends Omit<TransferItem,'id'> { _key:number }

export default function TransferPage() {
  const qc = useQueryClient()
  const [page,setPage]=useState(1); const [keyword,setKeyword]=useState(''); const [search,setSearch]=useState('')
  const [open,setOpen]=useState(false)
  const [fromWh,setFromWh]=useState(''); const [toWh,setToWh]=useState(''); const [remark,setRemark]=useState('')
  const [items,setItems]=useState<DraftItem[]>([]); const [counter,setCounter]=useState(0)
  const [confirmState,setConfirmState]=useState<{open:boolean;title:string;description:string;onConfirm:()=>void}>({open:false,title:'',description:'',onConfirm:()=>{}})
  const openConfirm=(title:string,description:string,onConfirm:()=>void)=>setConfirmState({open:true,title,description,onConfirm})
  const closeConfirm=()=>setConfirmState(s=>({...s,open:false}))
  const [submitting,setSubmitting]=useState(false)
  const [pendingId,setPendingId]=useState<number|null>(null)

  const {data,isLoading}=useQuery({queryKey:['transfer',{page,keyword}],queryFn:()=>getTransferListApi({page,pageSize:20,keyword}).then(r=>r.data.data!)})
  const {data:warehouses}=useWarehousesActive()
  const {data:products}=useProducts({page:1,pageSize:200,keyword:''})
  const mut=(fn:()=>Promise<unknown>,id?:number)=>{
    if(id) setPendingId(id)
    fn().then(()=>qc.invalidateQueries({queryKey:['transfer']})).catch(()=>{}).finally(()=>{if(id)setPendingId(null)})
  }

  const addItem=()=>{setCounter(c=>c+1);setItems(p=>[...p,{_key:counter,productId:0,productCode:'',productName:'',unit:'',quantity:1,remark:''}])}
  const removeItem=(k:number)=>setItems(p=>p.filter(i=>i._key!==k))
  const selectProduct=(k:number,pid:string)=>{
    if(!pid||pid==='__none__'){ setItems(prev=>prev.map(i=>i._key===k?{...i,productId:0,productCode:'',productName:'',unit:''}:i)); return }
    const p=products?.list.find(x=>String(x.id)===pid); if(p) setItems(prev=>prev.map(i=>i._key===k?{...i,productId:p.id,productCode:p.code,productName:p.name,unit:p.unit}:i))
  }
  const updateQty=(k:number,v:number)=>setItems(p=>p.map(i=>i._key===k?{...i,quantity:v}:i))

  const handleSubmit=async(e:React.FormEvent)=>{ e.preventDefault()
    const fw=warehouses?.find(w=>String(w.id)===fromWh); const tw=warehouses?.find(w=>String(w.id)===toWh)
    if(!fw||!tw) { toast.warning('请选择源仓库和目标仓库'); return }
    if(fw.id===tw.id) { toast.warning('源仓库和目标仓库不能相同'); return }
    if(!items.length||items.find(i=>!i.productId)) { toast.warning('请完整填写明细'); return }
    setSubmitting(true)
    try {
      await createTransferApi({fromWarehouseId:fw.id,fromWarehouseName:fw.name,toWarehouseId:tw.id,toWarehouseName:tw.name,remark:remark||undefined,items:items.map(({_key,...r})=>r)})
      qc.invalidateQueries({queryKey:['transfer']}); setOpen(false); setItems([]); setFromWh(''); setToWh(''); setRemark('')
    } finally { setSubmitting(false) }
  }

  const columns:TableColumn<TransferOrder>[]=[
    {key:'orderNo',title:'调拨单号',width:170,render:(v)=><span className="text-doc-code">{String(v)}</span>},
    {key:'fromWarehouseName',title:'源仓库',width:130},
    {key:'toWarehouseName',title:'目标仓库',width:130},
    {key:'status',title:'状态',width:90,render:(v,row)=><Badge variant={SC[v as number]}>{(row as TransferOrder).statusName}</Badge>},
    {key:'operatorName',title:'经办人',width:90},
    {key:'createdAt',title:'创建时间',width:160,render:(v)=>formatDisplayDateTime(v)},
    {key:'id',title:'操作',width:200,render:(_,row)=>{const r=row as TransferOrder; return(
      <div className="flex gap-1 flex-wrap">
        {r.status===1&&<Button size="sm" variant="outline" disabled={pendingId===r.id} onClick={()=>mut(()=>confirmTransferApi(r.id),r.id)}>{pendingId===r.id?'处理中...':'确认'}</Button>}
        {r.status===2&&<Button size="sm" variant="outline" disabled={pendingId===r.id} onClick={()=>openConfirm('执行调拨','确认执行调拨？将同步两个仓库库存，不可撤销。',()=>mut(()=>executeTransferApi(r.id),r.id))}>{pendingId===r.id?'处理中...':'执行调拨'}</Button>}
        {(r.status===1||r.status===2)&&<Button size="sm" variant="destructive" disabled={pendingId===r.id} onClick={()=>openConfirm('取消调拨','确认取消此调拨单？',()=>mut(()=>cancelTransferApi(r.id),r.id))}>{pendingId===r.id?'处理中...':'取消'}</Button>}
      </div>
    )}}
  ]

  return (
    <div className="space-y-4">
      <PageHeader title="库存调拨" description="在仓库之间调拨商品，自动同步两端库存" actions={
        <div className="flex gap-2">
          <Button variant="outline" onClick={()=>downloadExport('/export/transfer').catch(e=>toast.error((e as Error).message))}>导出 Excel</Button>
          <Button onClick={()=>setOpen(true)}>+ 新建调拨单</Button>
        </div>
      } />
      <FilterCard>
        <Input placeholder="搜索单号/仓库..." value={search} onChange={(e:React.ChangeEvent<HTMLInputElement>)=>setSearch(e.target.value)} className="h-9 w-56" onKeyDown={(e:React.KeyboardEvent)=>{ if(e.key==='Enter'){setKeyword(search);setPage(1)} }} />
        <Button size="sm" variant="outline" onClick={()=>{setKeyword(search);setPage(1)}}>搜索</Button>
        {keyword && <Button size="sm" variant="ghost" onClick={()=>{setSearch('');setKeyword('');setPage(1)}}>重置</Button>}
      </FilterCard>
      <DataTable columns={columns} data={data?.list||[]} loading={isLoading} pagination={data?.pagination} onPageChange={setPage} />

      <ConfirmDialog
        open={confirmState.open}
        title={confirmState.title}
        description={confirmState.description}
        variant={confirmState.title.includes('取消')?'destructive':'default'}
        confirmText={confirmState.title.includes('取消')?'确认取消':'确认'}
        onConfirm={()=>{ closeConfirm(); confirmState.onConfirm() }}
        onCancel={closeConfirm}
      />
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>新建调拨单</DialogTitle></DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1"><Label>源仓库 *</Label>
                <Select value={fromWh || '__none__'} onValueChange={v => setFromWh(v === '__none__' ? '' : v)}>
                  <SelectTrigger className="h-10 w-full"><SelectValue placeholder="请选择" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">请选择</SelectItem>
                    {warehouses?.map(w => (
                      <SelectItem key={w.id} value={String(w.id)}>{w.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select></div>
              <div className="space-y-1"><Label>目标仓库 *</Label>
                <Select value={toWh || '__none__'} onValueChange={v => setToWh(v === '__none__' ? '' : v)}>
                  <SelectTrigger className="h-10 w-full"><SelectValue placeholder="请选择" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">请选择</SelectItem>
                    {warehouses?.map(w => (
                      <SelectItem key={w.id} value={String(w.id)}>{w.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select></div>
              <div className="col-span-2 space-y-1"><Label>备注</Label><Input value={remark} onChange={(e:React.ChangeEvent<HTMLInputElement>)=>setRemark(e.target.value)} /></div>
            </div>
            <div>
              <div className="flex items-center justify-between mb-2"><Label className="font-semibold">调拨明细</Label><Button type="button" size="sm" variant="outline" onClick={addItem}>+ 添加行</Button></div>
              {!items.length&&<p className="text-sm text-muted-foreground text-center py-4 border rounded">暂无明细</p>}
              {items.map(item=>(
                <div key={item._key} className="grid grid-cols-12 gap-2 mb-2 items-center">
                  <div className="col-span-5">
                    <Select value={item.productId ? String(item.productId) : '__none__'} onValueChange={v => selectProduct(item._key, v)}>
                      <SelectTrigger className="w-full h-9 text-sm"><SelectValue placeholder="选择商品" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">选择商品</SelectItem>
                        {products?.list.map(p => (
                          <SelectItem key={p.id} value={String(p.id)}>{p.name}({p.code})</SelectItem>
                        ))}
                      </SelectContent>
                    </Select></div>
                  <div className="col-span-2 text-sm text-muted-foreground text-center">{item.unit||'-'}</div>
                  <div className="col-span-4"><Input type="number" min="0.01" step="0.01" placeholder="数量" value={item.quantity} onChange={(e:React.ChangeEvent<HTMLInputElement>)=>updateQty(item._key,+e.target.value)} className="text-sm" /></div>
                  <div className="col-span-1 text-right"><Button type="button" size="sm" variant="ghost" className="text-red-500 px-2" onClick={()=>removeItem(item._key)}>✕</Button></div>
                </div>
              ))}
            </div>
            <DialogFooter><Button type="button" variant="outline" onClick={()=>setOpen(false)} disabled={submitting}>取消</Button><Button type="submit" disabled={submitting}>{submitting?'创建中...':'创建调拨单'}</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
