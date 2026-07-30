import { useState } from 'react'
import { toast } from '@/lib/toast'
import PageHeader from '@/components/shared/PageHeader'
import DataTable from '@/components/shared/DataTable'
import { FilterCard } from '@/components/shared/FilterCard'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SoftStatusLabel } from '@/components/shared/StatusBadge'
import type { StatusTone } from '@/lib/statusTone'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useCheckList, useCreateCheck } from '@/hooks/useStockCheck'
import { getCycleCandidatesApi, recomputeAbcApi } from '@/api/stockcheck'
import { useWarehousesActive } from '@/hooks/useWarehouses'
import CheckDetailDialog from './components/CheckDetailDialog'
import { formatDisplayDateTime } from '@/lib/dateTime'
import type { StockCheck } from '@/types/stockcheck'
import type { TableColumn } from '@/types'

const STATUS_TONE: Record<number, StatusTone> = { 1:'active', 2:'success', 3:'danger' }

export default function StockCheckPage() {
  const [keyword, setKeyword] = useState('')
  const [search, setSearch] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [detailId, setDetailId] = useState<number|null>(null)
  const [whId, setWhId] = useState('')
  const [remark, setRemark] = useState('')
  const [checkType, setCheckType] = useState<'1'|'2'>('1')
  const [abcClass, setAbcClass] = useState<'A'|'B'|'C'>('A')
  const [createLocked, setCreateLocked] = useState(false)

  const { data, isLoading } = useCheckList({ pageSize: 99999, keyword })
  const { data: warehouses } = useWarehousesActive()
  const create = useCreateCheck()

  const columns: TableColumn<StockCheck>[] = [
    { key:'checkNo', title:'盘点单号', width:160, render:(v)=><span className="text-doc-code">{String(v)}</span> },
    { key:'warehouseName', title:'仓库', width:140 },
    { key:'checkType', title:'类型', width:120, render:(_,row)=>{ const r=row as StockCheck; return <SoftStatusLabel label={r.checkType===2?`循环抽盘${r.scopeValue?`·${r.scopeValue}`:''}`:'全盘'} tone="info" /> } },
    { key:'status', title:'状态', width:90, render:(v,row)=><SoftStatusLabel label={(row as StockCheck).statusName} tone={STATUS_TONE[v as number] ?? 'draft'} /> },
    { key:'operatorName', title:'经办人', width:100 },
    { key:'createdAt', title:'创建时间', width:160, render:(v)=>formatDisplayDateTime(v) },
    { key:'id', title:'操作', width:100, render:(_,row)=>(
      <Button size="sm" variant="outline" onClick={()=>setDetailId((row as StockCheck).id)}>查看/填写</Button>
    )}
  ]

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (createLocked || create.isPending) return
    const wh = warehouses?.find(w=>String(w.id)===whId)
    if(!wh) { toast.warning('请选择仓库'); return }
    try {
      setCreateLocked(true)
      if (checkType === '2') {
        const cand = await getCycleCandidatesApi({ warehouseId: wh.id, scopeType: 'abc', scopeValue: abcClass })
        if (!cand || !cand.productIds.length) { toast.warning(`${abcClass} 类当前没有到期未盘的商品（可先重算 ABC，或改用全盘）`); return }
        await create.mutateAsync({ warehouseId:wh.id, warehouseName:wh.name, remark:remark||undefined, checkType:2, scopeType:'abc', scopeValue:abcClass, productIds:cand.productIds })
      } else {
        await create.mutateAsync({ warehouseId:wh.id, warehouseName:wh.name, remark:remark||undefined })
      }
      setCreateOpen(false); setWhId(''); setRemark(''); setCheckType('1')
    } finally {
      setCreateLocked(false)
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader title="库存盘点" description="创建盘点单并填写实盘数量，提交后自动调整库存" actions={<Button onClick={()=>setCreateOpen(true)}>+ 新建盘点</Button>} />
      <FilterCard>
        <Input placeholder="搜索单号/仓库..." value={search} onChange={(e: React.ChangeEvent<HTMLInputElement>)=>setSearch(e.target.value)} className="h-9 w-56" onKeyDown={(e: React.KeyboardEvent)=>{ if(e.key==='Enter'){ setKeyword(search) } }} />
        <Button size="sm" variant="outline" onClick={()=>{ setKeyword(search) }}>搜索</Button>
        {keyword && <Button size="sm" variant="ghost" onClick={()=>{ setSearch(''); setKeyword('') }}>重置</Button>}
      </FilterCard>
      <DataTable columns={columns} data={data?.list||[]} loading={isLoading} />

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>新建盘点单</DialogTitle></DialogHeader>
          <form onSubmit={handleCreate} className="space-y-4 py-2">
            <div className="space-y-1">
              <Label>选择仓库 *</Label>
              <Select value={whId || '__none__'} onValueChange={v => setWhId(v === '__none__' ? '' : v)}>
                <SelectTrigger className="h-10 w-full">
                  <SelectValue placeholder="请选择" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">请选择</SelectItem>
                  {warehouses?.map(w => (
                    <SelectItem key={w.id} value={String(w.id)}>{w.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{checkType==='2'?'循环抽盘：只拉该 ABC 类到期未盘的商品（不停机）':'全盘：拉该仓库所有有库存的商品'}作为盘点明细</p>
            </div>
            <div className="space-y-1">
              <Label>盘点方式</Label>
              <Select value={checkType} onValueChange={v => setCheckType(v as '1'|'2')}>
                <SelectTrigger className="h-10 w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">全盘（盘全仓所有有货商品）</SelectItem>
                  <SelectItem value="2">循环抽盘（按 ABC 类，不停机）</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {checkType==='2' && (
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <Label>ABC 类别</Label>
                  <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" disabled={!whId} onClick={async () => {
                    const w = warehouses?.find(x=>String(x.id)===whId); if(!w){ toast.warning('请先选仓库'); return }
                    try { const r = await recomputeAbcApi({ warehouseId: w.id }); toast.success(`已重算 ${r!.classified} 个商品的 ABC 分类`) } catch { toast.error('重算失败') }
                  }}>重算本仓 ABC</Button>
                </div>
                <Select value={abcClass} onValueChange={v => setAbcClass(v as 'A'|'B'|'C')}>
                  <SelectTrigger className="h-10 w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="A">A 类（高周转，勤盘）</SelectItem>
                    <SelectItem value="B">B 类（中周转）</SelectItem>
                    <SelectItem value="C">C 类（低周转，稀盘）</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">只盘该类到期未盘的商品。首次抽盘前请先「重算本仓 ABC」。</p>
              </div>
            )}
            <div className="space-y-1">
              <Label>备注</Label>
              <Input value={remark} onChange={(e: React.ChangeEvent<HTMLInputElement>)=>setRemark(e.target.value)} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={()=>setCreateOpen(false)} disabled={create.isPending || createLocked}>取消</Button>
              <Button type="submit" disabled={create.isPending || createLocked}>{create.isPending || createLocked?'创建中...':'创建盘点'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <CheckDetailDialog open={!!detailId} onClose={()=>setDetailId(null)} checkId={detailId} />
    </div>
  )
}
