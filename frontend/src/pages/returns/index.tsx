import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import PageHeader from '@/components/shared/PageHeader'
import DataTable from '@/components/shared/DataTable'
import { FilterCard } from '@/components/shared/FilterCard'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import TableActionsMenu from '@/components/shared/TableActionsMenu'
import { SoftStatusLabel } from '@/components/shared/StatusBadge'
import { getPurchaseReturnsApi, confirmPurchaseReturnApi, cancelPurchaseReturnApi, getSaleReturnsApi, confirmSaleReturnApi, cancelSaleReturnApi } from '@/api/returns'
import { downloadExport } from '@/lib/exportDownload'
import { OrderPrintOverlay } from '@/components/print/OrderPrintOverlay'
import { mapReturnOrderToPrint } from '@/lib/orderPrintData'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { toast } from '@/lib/toast'
import { useWorkspaceStore } from '@/store/workspaceStore'
import { formatDisplayDateTime } from '@/lib/dateTime'
import type { PurchaseReturn, SaleReturn } from '@/api/returns'
import type { TableColumn } from '@/types'

type RowType = PurchaseReturn | SaleReturn

function ReturnList({ type }: { type: 'purchase'|'sale' }) {
  const qc=useQueryClient()
  const navigate = useNavigate()
  const { addTab } = useWorkspaceStore()
  const [keyword,setKeyword]=useState(''); const [search,setSearch]=useState('')
  const [confirmState,setConfirmState]=useState<{open:boolean;title:string;description:string;onConfirm:()=>void}>({open:false,title:'',description:'',onConfirm:()=>{}})
  const openConfirm=(title:string,description:string,onConfirm:()=>void)=>setConfirmState({open:true,title,description,onConfirm})
  const closeConfirm=()=>setConfirmState(s=>({...s,open:false}))
  const [pendingId,setPendingId]=useState<number|null>(null)
  const [printTarget,setPrintTarget]=useState<RowType|null>(null)
  const apiList = type==='purchase'?getPurchaseReturnsApi:getSaleReturnsApi
  const {data,isLoading}=useQuery({queryKey:['returns',type,{keyword}],queryFn:()=>apiList({pageSize:99999,keyword}).then(r=>r!)})
  const inv=()=>qc.invalidateQueries({queryKey:['returns',type]})
  const confirmFn=type==='purchase'?confirmPurchaseReturnApi:confirmSaleReturnApi
  const cancelFn =type==='purchase'?cancelPurchaseReturnApi:cancelSaleReturnApi
  const mut=(fn:()=>Promise<unknown>,id?:number)=>{
    if(id) setPendingId(id)
    fn()
      .then(inv)
      .finally(() => { if(id) setPendingId(null) })
  }
  const partyKey = type==='purchase' ? 'supplierName' : 'customerName'

  function goToNew() {
    const path = `/returns/${type}/new`
    addTab({ key: path, title: type === 'purchase' ? '新建采购退货单' : '新建销售退货单', path })
    navigate(path)
  }
  function goToDetail(row: RowType) {
    const path = `/returns/${type}/${row.id}`
    addTab({ key: path, title: row.returnNo, path })
    navigate(path)
  }

  const columns:TableColumn<RowType>[]=[
    {key:'returnNo',title:'退货单号',width:170,render:v => <span className="text-doc-code">{String(v)}</span>},
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
    {key:'id',title:'操作',width:140,render:(_,row)=>{const r=row as RowType;
      return(
        <TableActionsMenu
          primaryLabel="详情"
          primaryVariant="outline"
          onPrimaryClick={() => goToDetail(r)}
          items={[
            ...(r.status === 1 ? [{
              label: pendingId===r.id ? '处理中...' : '确认',
              onClick: () => mut(() => confirmFn(r.id), r.id),
              disabled: pendingId===r.id,
            }] : []),
            { label: '打印', onClick: () => setPrintTarget(r) },
            ...((r.status === 1 || r.status === 2) ? [{
              label: pendingId===r.id ? '处理中...' : '取消',
              onClick:()=>openConfirm('取消退货单','确认取消此退货单？',()=>mut(()=>cancelFn(r.id),r.id)),
              disabled: pendingId===r.id,
              destructive:true,
              separatorBefore:true,
            }] : []),
          ]}
        />
      )
    }}
  ]
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <FilterCard className="flex-1">
          <Input placeholder="搜索单号..." value={search} onChange={(e:React.ChangeEvent<HTMLInputElement>)=>setSearch(e.target.value)} className="h-9 w-56" onKeyDown={(e:React.KeyboardEvent)=>{if(e.key==='Enter'){setKeyword(search)}}} />
          <Button size="sm" variant="outline" onClick={()=>{setKeyword(search)}}>搜索</Button>
          {keyword && <Button size="sm" variant="ghost" onClick={()=>{setSearch('');setKeyword('')}}>重置</Button>}
        </FilterCard>
        <div className="flex shrink-0 gap-2">
          <Button variant="outline" onClick={()=>downloadExport(type==='purchase'?'/export/purchase-returns':'/export/sale-returns').catch(e=>toast.error((e as Error).message))}>导出 Excel</Button>
          <Button onClick={goToNew}>+ 新建{type==='purchase'?'采购':'销售'}退货单</Button>
        </div>
      </div>
      <DataTable columns={columns} data={(data?.list||[]) as RowType[]} loading={isLoading} onRowDoubleClick={goToDetail} />
      <ConfirmDialog
        open={confirmState.open}
        title={confirmState.title}
        description={confirmState.description}
        variant={confirmState.title.includes('取消')?'destructive':'default'}
        confirmText={confirmState.title.includes('取消')?'确认取消':'确认'}
        onConfirm={()=>{ closeConfirm(); confirmState.onConfirm() }}
        onCancel={closeConfirm}
      />
      {printTarget && (
        <OrderPrintOverlay
          templateType={3}
          title={printTarget.returnNo}
          {...mapReturnOrderToPrint({...printTarget, type})}
          onClose={() => setPrintTarget(null)}
        />
      )}
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
