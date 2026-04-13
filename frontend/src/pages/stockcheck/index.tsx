import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from '@/lib/toast'
import PageHeader from '@/components/shared/PageHeader'
import { FocusModePanel } from '@/components/shared/FocusModePanel'
import { ExecutionBridgePanel } from '@/components/shared/ExecutionBridgePanel'
import DataTable from '@/components/shared/DataTable'
import { FilterCard } from '@/components/shared/FilterCard'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useCheckList, useCreateCheck } from '@/hooks/useStockCheck'
import { useWarehousesActive } from '@/hooks/useWarehouses'
import CheckDetailDialog from './components/CheckDetailDialog'
import type { StockCheck } from '@/types/stockcheck'
import type { TableColumn } from '@/types'

const STATUS_COLOR: Record<number, 'default' | 'secondary' | 'destructive' | 'outline'> = { 1:'default', 2:'outline', 3:'destructive' }

export default function StockCheckPage() {
  const navigate = useNavigate()
  const [page, setPage] = useState(1)
  const [keyword, setKeyword] = useState('')
  const [search, setSearch] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [detailId, setDetailId] = useState<number|null>(null)
  const [whId, setWhId] = useState('')
  const [remark, setRemark] = useState('')

  const { data, isLoading } = useCheckList({ page, pageSize:20, keyword })
  const { data: warehouses } = useWarehousesActive()
  const create = useCreateCheck()

  const columns: TableColumn<StockCheck>[] = [
    { key:'checkNo', title:'盘点单号', width:160, render:(v)=><span className="text-doc-code">{String(v)}</span> },
    { key:'warehouseName', title:'仓库' },
    { key:'status', title:'状态', width:90, render:(v,row)=><Badge variant={STATUS_COLOR[v as number]}>{(row as StockCheck).statusName}</Badge> },
    { key:'operatorName', title:'经办人', width:100 },
    { key:'createdAt', title:'创建时间', width:160, render:(v)=>String(v).slice(0,16) },
    { key:'id', title:'操作', width:100, render:(_,row)=>(
      <Button size="sm" variant="outline" onClick={()=>setDetailId((row as StockCheck).id)}>查看/填写</Button>
    )}
  ]

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    const wh = warehouses?.find(w=>String(w.id)===whId)
    if(!wh) { toast.warning('请选择仓库'); return }
    await create.mutateAsync({ warehouseId:wh.id, warehouseName:wh.name, remark:remark||undefined })
    setCreateOpen(false); setWhId(''); setRemark('')
  }

  return (
    <div className="space-y-4">
      <PageHeader title="库存盘点" description="创建盘点单并填写实盘数量，提交后自动调整库存" actions={<Button onClick={()=>setCreateOpen(true)}>+ 新建盘点</Button>} />
      <FocusModePanel
        badge="下一步推荐入口"
        title="库存盘点负责把账面库存和现场实盘收口到同一条调整链"
        description="这页最适合先判断是否需要新建盘点，再进入盘点单详情填写实盘数；提交前如果发现风险或来源不明的波动，先回库存页、岗位工作台或异常工作台确认。"
        summary={detailId ? `当前打开盘点单 #${detailId}` : '当前焦点：盘点列表'}
        steps={[
          '先按仓库查看盘点单，确定是新建盘点还是继续填写已有盘点。',
          '进入盘点单详情录入实盘数，提交前再次确认差异原因。',
          '如果差异关联现场异常，回库存管理、岗位工作台或异常工作台继续排查。',
        ]}
        actions={[
          { label: '打开库存管理', variant: 'default', onClick: () => navigate('/inventory') },
          { label: '打开岗位工作台', onClick: () => navigate('/reports/role-workbench') },
          { label: '打开异常工作台', onClick: () => navigate('/reports/exception-workbench') },
        ]}
      />
      <ExecutionBridgePanel
        badge="ERP / 现场执行桥接"
        title="盘点列表统一承接盘点组织与现场校正协同"
        description="ERP 在这里负责决定什么时候新建盘点、继续已有盘点、是否允许正式调整；现场则负责复点、核查差异来源，并通过盘点详情、收货、仓库任务等链路完成实际校正。"
        erpTitle="先在 ERP 决定盘点批次、优先级和正式调整时机"
        erpItems={[
          '先按仓库和盘点状态判断是否新建盘点，还是继续推进已有盘点单。',
          '差异来源不明时，优先回库存日志、岗位工作台和异常工作台继续核查。',
          '只有确认差异原因和实盘可信后，才把盘点提交成正式库存调整。',
        ]}
        pdaTitle="再由现场复点和业务链路完成真实数量校正"
        pdaItems={[
          '现场先重新核对异常商品和库位，必要时回收货、上架、拣货或出库链路复盘。',
          '盘点单详情负责录入实盘数，但真实差异仍要回现场动作确认。',
          '校正完成后，再回盘点列表确认盘点状态、差异结果和后续是否需要继续追查。',
        ]}
        actions={[
          { label: '打开库存管理', variant: 'default', onClick: () => navigate('/inventory') },
          { label: '打开 PDA 工作台', onClick: () => navigate('/pda') },
          { label: '打开异常工作台', onClick: () => navigate('/reports/exception-workbench') },
        ]}
      />
      <FilterCard>
        <Input placeholder="搜索单号/仓库..." value={search} onChange={(e: React.ChangeEvent<HTMLInputElement>)=>setSearch(e.target.value)} className="h-9 w-56" onKeyDown={(e: React.KeyboardEvent)=>{ if(e.key==='Enter'){ setKeyword(search); setPage(1) } }} />
        <Button size="sm" variant="outline" onClick={()=>{ setKeyword(search); setPage(1) }}>搜索</Button>
        {keyword && <Button size="sm" variant="ghost" onClick={()=>{ setSearch(''); setKeyword(''); setPage(1) }}>重置</Button>}
      </FilterCard>
      <DataTable columns={columns} data={data?.list||[]} loading={isLoading} pagination={data?.pagination} onPageChange={setPage} />

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
              <p className="text-xs text-muted-foreground">系统将自动拉取该仓库所有有库存的商品作为盘点明细</p>
            </div>
            <div className="space-y-1">
              <Label>备注</Label>
              <Input value={remark} onChange={(e: React.ChangeEvent<HTMLInputElement>)=>setRemark(e.target.value)} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={()=>setCreateOpen(false)}>取消</Button>
              <Button type="submit" disabled={create.isPending}>{create.isPending?'创建中...':'创建盘点'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <CheckDetailDialog open={!!detailId} onClose={()=>setDetailId(null)} checkId={detailId} />
    </div>
  )
}
