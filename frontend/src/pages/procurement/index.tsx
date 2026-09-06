import { createRequestKey, withRequestKeyHeaders } from '@/lib/requestKey'
import { RecordIdentity } from '@/components/shared/RecordIdentity'
import { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import PageHeader from '@/components/shared/PageHeader'
import DataTable from '@/components/shared/DataTable'
import { FilterCard } from '@/components/shared/FilterCard'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { SoftStatusLabel } from '@/components/shared/StatusBadge'
import { toast } from '@/lib/toast'
import { formatDisplayDateTime } from '@/lib/dateTime'
import { useWarehousesActive } from '@/hooks/useWarehouses'
import { usePermission } from '@/hooks/usePermission'
import { PERMISSIONS } from '@/lib/permission-codes'
import { listPlansApi, generatePlanApi } from '@/api/procurement'
import type { ProcurementPlan } from '@/types/procurement'
import type { StatusTone } from '@/lib/statusTone'
import type { TableColumn } from '@/types'

const STATUS_TONE: Record<number, StatusTone> = { 1: 'draft', 2: 'active', 3: 'success', 4: 'danger' }

export default function ProcurementPlanListPage() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const requestKey = useRef(createRequestKey('procurement-plan'))
  const { can } = usePermission()
  const canManage = can(PERMISSIONS.PROCUREMENT_PLAN_MANAGE)
  const { data: warehouses } = useWarehousesActive()
  const [keyword, setKeyword] = useState('')
  const [search, setSearch] = useState('')
  const [genOpen, setGenOpen] = useState(false)
  const [win, setWin] = useState(30)
  const [horizon, setHorizon] = useState(30)
  const [method, setMethod] = useState<'sma' | 'wma'>('sma')
  const [whId, setWhId] = useState('0')
  const [name, setName] = useState('')

  const { data, isLoading } = useQuery({
    queryKey: ['procurement-plans', keyword],
    queryFn: () => listPlansApi({ pageSize: 200, keyword }),
  })

  const generate = useMutation({
    mutationFn: () => generatePlanApi({ window: win, horizon, warehouseId: whId === '0' ? null : Number(whId), name: name.trim() || null, forecastMethod: method }, { skipGlobalError: true, headers: withRequestKeyHeaders(requestKey.current) }),
    onSuccess: (r) => {
      requestKey.current = createRequestKey('procurement-plan')
      toast.success(`已生成采购计划 ${r!.code}（${r!.itemCount} 行）`)
      setGenOpen(false); setName('')
      qc.invalidateQueries({ queryKey: ['procurement-plans'] })
      navigate(`/procurement/${r!.id}`)
    },
    onError: (e: unknown) => toast.error((e as { message?: string })?.message || '生成失败'),
  })

  const columns: TableColumn<ProcurementPlan>[] = [
    { key: 'code', title: '采购计划 / 编号', width: 280, render: (_, r) => <RecordIdentity title={r.name || '采购计划'} code={r.code} /> },
    { key: 'forecastWindow', title: '预测窗口', width: 100, align: 'right', render: v => <span className="tabular-nums">{Number(v)} 天</span> },
    { key: 'horizonDays', title: '覆盖周期', width: 100, align: 'right', render: v => <span className="tabular-nums">{Number(v)} 天</span> },
    { key: 'itemCount', title: '建议行数', width: 100, align: 'right', render: v => <span className="tabular-nums">{Number(v)}</span> },
    { key: 'status', title: '状态', width: 110, render: (_, r) => <SoftStatusLabel label={r.statusName} tone={STATUS_TONE[r.status] ?? 'draft'} /> },
    { key: 'operatorName', title: '生成人', width: 100 },
    { key: 'createdAt', title: '生成时间', width: 160, render: v => formatDisplayDateTime(String(v)) },
    { key: 'id', title: '操作', width: 90, render: (_, r) => <Button size="sm" variant="outline" onClick={() => navigate(`/procurement/${r.id}`)}>查看</Button> },
  ]

  return (
    <div className="space-y-4">
      <PageHeader
        title="采购计划"
        description="按未发销售、历史预测与现有供给生成采购计划，核对包装、交期和覆盖后转为采购单草稿。"
        actions={canManage ? <Button onClick={() => setGenOpen(true)}>+ 生成计划</Button> : undefined}
      />
      <FilterCard>
        <Input placeholder="搜索计划编号/名称…" value={search} onChange={(e) => setSearch(e.target.value)} className="h-9 w-56" onKeyDown={(e) => { if (e.key === 'Enter') setKeyword(search) }} />
        <Button size="sm" variant="outline" onClick={() => setKeyword(search)}>搜索</Button>
        {keyword && <Button size="sm" variant="ghost" onClick={() => { setSearch(''); setKeyword('') }}>重置</Button>}
      </FilterCard>
      <DataTable columns={columns} data={data?.list ?? []} loading={isLoading} />

      <Dialog open={genOpen} onOpenChange={setGenOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader><DialogTitle>生成采购计划</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>预测窗口（天）</Label>
                <Input type="number" value={win} onChange={(e) => setWin(Number(e.target.value) || 30)} className="h-10 text-right tabular-nums" />
                <p className="text-xs text-muted-foreground">用最近 N 天出库算日均</p>
              </div>
              <div className="space-y-1">
                <Label>覆盖周期（天）</Label>
                <Input type="number" value={horizon} onChange={(e) => setHorizon(Number(e.target.value) || 30)} className="h-10 text-right tabular-nums" />
                <p className="text-xs text-muted-foreground">计划覆盖未来多少天的需求</p>
              </div>
            </div>
            <div className="space-y-1">
              <Label>预测方法</Label>
              <Select value={method} onValueChange={(v) => setMethod(v as 'sma' | 'wma')}>
                <SelectTrigger className="h-10 w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="sma">简单移动平均（SMA）</SelectItem>
                  <SelectItem value="wma">加权移动平均（WMA，近期权重更高）</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">WMA 对近期出库趋势更敏感，适合销量波动大的商品</p>
            </div>
            <div className="space-y-1">
              <Label>仓库范围</Label>
              <Select value={whId} onValueChange={setWhId}>
                <SelectTrigger className="h-10 w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">全部仓库（我的数据权限内）</SelectItem>
                  {warehouses?.map(w => <SelectItem key={w.id} value={String(w.id)}>{w.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>计划名称（可选）</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="默认按生成时间" className="h-10" />
            </div>
            <p className="text-xs text-muted-foreground">使用 ACTIVE 实物与预计采购；未发销售包含未占库订单，销售先消耗预测。已有计划、申请和采购草稿会抵扣，避免重复采购。</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setGenOpen(false)} disabled={generate.isPending}>取消</Button>
            <Button onClick={() => generate.mutate()} disabled={generate.isPending}>{generate.isPending ? '生成中…' : '生成'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
