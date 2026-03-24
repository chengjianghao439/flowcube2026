/**
 * 波次拣货管理页
 * 路由：/picking-waves
 */
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from '@/lib/toast'
import PageHeader from '@/components/shared/PageHeader'
import { FilterCard } from '@/components/shared/FilterCard'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import {
  getWavesApi, getWaveByIdApi, startWaveApi, finishPickingApi, finishWaveApi, cancelWaveApi,
  WAVE_STATUS_LABEL, WAVE_PRIORITY_LABEL,
  type PickingWave, type WaveStatus,
} from '@/api/picking-waves'
import DataTable from '@/components/shared/DataTable'
import type { TableColumn } from '@/types'

const STATUS_VARIANT: Record<WaveStatus, 'default'|'secondary'|'outline'|'destructive'> = {
  1: 'outline', 2: 'secondary', 3: 'default', 4: 'default', 5: 'destructive',
}

export default function PickingWavesPage() {
  const qc = useQueryClient()
  const [keyword, setKeyword]         = useState('')
  const [search, setSearch]           = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('')
  const [page, setPage]               = useState(1)
  const [detailWave, setDetailWave]   = useState<PickingWave | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['picking-waves', keyword, statusFilter, page],
    queryFn: () => getWavesApi({ keyword, status: statusFilter || undefined, page, pageSize: 20 })
      .then(r => r.data.data),
  })

  const { data: detail } = useQuery({
    queryKey: ['picking-wave-detail', detailWave?.id],
    queryFn: () => getWaveByIdApi(detailWave!.id).then(r => r.data.data),
    enabled: !!detailWave,
  })

  function invalidate() { qc.invalidateQueries({ queryKey: ['picking-waves'] }) }

  const startMut       = useMutation({ mutationFn: startWaveApi,       onSuccess: () => { toast.success('已开始拣货'); invalidate() }, onError: () => toast.error('操作失败') })
  const finishPickMut  = useMutation({ mutationFn: finishPickingApi,   onSuccess: () => { toast.success('拣货完成'); invalidate() }, onError: () => toast.error('操作失败') })
  const finishMut      = useMutation({ mutationFn: finishWaveApi,      onSuccess: () => { toast.success('波次已完成'); invalidate(); setDetailWave(null) }, onError: () => toast.error('操作失败') })
  const cancelMut      = useMutation({ mutationFn: cancelWaveApi,      onSuccess: () => { toast.success('已取消'); invalidate(); setDetailWave(null) }, onError: () => toast.error('取消失败') })

  const columns: TableColumn<PickingWave>[] = [
    { key: 'waveNo',         title: '波次单号', width: 160,
      render: v => <span className="font-mono text-xs">{v as string}</span> },
    { key: 'warehouseName',  title: '仓库',
      render: v => v ?? <span className="text-muted-foreground">—</span> },
    { key: 'status',         title: '状态', width: 90,
      render: v => <Badge variant={STATUS_VARIANT[v as WaveStatus]}>{WAVE_STATUS_LABEL[v as WaveStatus]}</Badge> },
    { key: 'priority',       title: '优先级', width: 80,
      render: v => WAVE_PRIORITY_LABEL[v as 1|2|3] },
    { key: 'taskCount',      title: '任务数', width: 80 },
    { key: 'operatorName',   title: '拣货人',
      render: v => v ?? <span className="text-muted-foreground">—</span> },
    { key: 'createdAt',      title: '创建时间', width: 160,
      render: v => (v as string)?.slice(0, 16) },
    { key: 'id', title: '操作', width: 80,
      render: (_, row) => (
        <Button size="sm" variant="ghost" onClick={() => setDetailWave(row)}>详情</Button>
      ) },
  ]

  return (
    <div className="space-y-5">
      <PageHeader title="波次拣货" description="管理拣货波次的创建与执行" />

      <FilterCard>
        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex-1 min-w-[180px]">
            <Input placeholder="波次单号" value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { setKeyword(search); setPage(1) } }}
            />
          </div>
          <Select value={statusFilter || '__all__'} onValueChange={v => { setStatusFilter(v === '__all__' ? '' : v); setPage(1) }}>
            <SelectTrigger className="w-32"><SelectValue placeholder="全部状态" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">全部</SelectItem>
              {([1,2,3,4,5] as WaveStatus[]).map(s => (
                <SelectItem key={s} value={String(s)}>{WAVE_STATUS_LABEL[s]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button onClick={() => { setKeyword(search); setPage(1) }}>搜索</Button>
          <Button variant="outline" onClick={() => { setSearch(''); setKeyword(''); setStatusFilter(''); setPage(1) }}>重置</Button>
        </div>
      </FilterCard>

      <DataTable
        columns={columns}
        data={data?.list ?? []}
        loading={isLoading}
        rowKey="id"
      />

      {data && (
        <div className="flex items-center justify-between px-1 text-sm text-muted-foreground">
          <span>共 {data.total} 条</span>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>上一页</Button>
            <Button size="sm" variant="outline" disabled={page * 20 >= data.total} onClick={() => setPage(p => p + 1)}>下一页</Button>
          </div>
        </div>
      )}

      <Dialog open={!!detailWave} onOpenChange={v => !v && setDetailWave(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>波次详情 — {detail?.waveNo ?? detailWave?.waveNo}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div><span className="text-muted-foreground">仓库：</span>{detail?.warehouseName ?? '—'}</div>
              <div><span className="text-muted-foreground">状态：</span>
                {detail && <Badge variant={STATUS_VARIANT[detail.status]}>{WAVE_STATUS_LABEL[detail.status]}</Badge>}
              </div>
              <div><span className="text-muted-foreground">优先级：</span>{detail && WAVE_PRIORITY_LABEL[detail.priority]}</div>
              <div><span className="text-muted-foreground">拣货人：</span>{detail?.operatorName ?? '—'}</div>
              <div><span className="text-muted-foreground">任务数：</span>{detail?.taskCount}</div>
            </div>
            {detail?.items && detail.items.length > 0 && (
              <table className="w-full text-sm border rounded">
                <thead>
                  <tr className="bg-muted/40">
                    <th className="px-3 py-2 text-left">商品</th>
                    <th className="px-3 py-2 text-right">需拣数</th>
                    <th className="px-3 py-2 text-right">已拣数</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {detail.items.map(item => (
                    <tr key={item.id}>
                      <td className="px-3 py-2">{item.productName}</td>
                      <td className="px-3 py-2 text-right">{item.totalQty}</td>
                      <td className="px-3 py-2 text-right">{item.pickedQty}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <DialogFooter className="gap-2">
            {detail?.status === 1 && <Button onClick={() => startMut.mutate(detail.id)} disabled={startMut.isPending}>开始拣货</Button>}
            {detail?.status === 2 && <Button onClick={() => finishPickMut.mutate(detail.id)} disabled={finishPickMut.isPending}>完成拣货</Button>}
            {detail?.status === 3 && <Button onClick={() => finishMut.mutate(detail.id)} disabled={finishMut.isPending}>完成波次</Button>}
            {detail && [1,2,3].includes(detail.status) && <Button variant="destructive" onClick={() => cancelMut.mutate(detail.id)} disabled={cancelMut.isPending}>取消</Button>}
            <Button variant="outline" onClick={() => setDetailWave(null)}>关闭</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
