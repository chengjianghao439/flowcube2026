/**
 * 收货订单列表（采购入库 / inbound_tasks）
 * 路由：/inbound-tasks
 */
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import PageHeader from '@/components/shared/PageHeader'
import { FilterCard } from '@/components/shared/FilterCard'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { getInboundTasksApi } from '@/api/inbound-tasks'
import {
  INBOUND_STATUS_LABEL,
  INBOUND_STATUS_VARIANT,
  type InboundTask,
  type InboundTaskStatus,
  type InboundPurchaseCandidate,
} from '@/types/inbound-tasks'
import DataTable from '@/components/shared/DataTable'
import type { TableColumn } from '@/types'
import { useWorkspaceStore } from '@/store/workspaceStore'
import { SupplierFinder, FinderTrigger } from '@/components/finder'
import type { FinderResult } from '@/types/finder'
import { useCreateInboundTask, useInboundPurchaseCandidates } from '@/hooks/useInboundTasks'
import { toast } from '@/lib/toast'

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card-base p-5">
      <h3 className="text-section-title mb-4 pb-2 border-b border-border/50">{title}</h3>
      {children}
    </div>
  )
}

function CreateInboundDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  onCreated: (taskId: number, taskNo: string) => void
}) {
  const createInbound = useCreateInboundTask()
  const [supplierFinderOpen, setSupplierFinderOpen] = useState(false)
  const [supplier, setSupplier] = useState<FinderResult | null>(null)
  const [keyword, setKeyword] = useState('')
  const [search, setSearch] = useState('')
  const [remark, setRemark] = useState('')
  const [qtyMap, setQtyMap] = useState<Record<number, string>>({})

  const { data: candidates = [], isLoading } = useInboundPurchaseCandidates(supplier?.id ?? null, keyword)

  const selectedRows = useMemo(() => {
    return candidates
      .map(item => ({
        item,
        qty: Number(qtyMap[item.purchaseItemId] || 0),
      }))
      .filter(entry => Number.isFinite(entry.qty) && entry.qty > 0)
  }, [candidates, qtyMap])

  function handleSupplierConfirm(result: FinderResult) {
    setSupplier(result)
    setKeyword('')
    setSearch('')
    setQtyMap({})
  }

  function handleClose() {
    if (createInbound.isPending) return
    onClose()
    setKeyword('')
    setSearch('')
    setRemark('')
    setSupplier(null)
    setQtyMap({})
  }

  function setLineQty(item: InboundPurchaseCandidate, raw: string) {
    const value = raw.trim()
    if (!value) {
      setQtyMap(prev => {
        const next = { ...prev }
        delete next[item.purchaseItemId]
        return next
      })
      return
    }

    const qty = Number(value.replace(/,/g, '.'))
    if (!Number.isFinite(qty) || qty < 0) return
    setQtyMap(prev => ({ ...prev, [item.purchaseItemId]: String(qty) }))
  }

  function submit() {
    if (!supplier) {
      toast.warning('请先选择供应商')
      return
    }
    if (selectedRows.length === 0) {
      toast.warning('请至少填写一条收货数量')
      return
    }

    const overflow = selectedRows.find(entry => entry.qty > entry.item.remainingQty)
    if (overflow) {
      toast.error(`${overflow.item.productName} 超出可建单数量`)
      return
    }

    createInbound.mutate(
      {
        supplierId: supplier.id,
        supplierName: supplier.name,
        remark: remark.trim() || undefined,
        items: selectedRows.map(entry => ({
          purchaseItemId: entry.item.purchaseItemId,
          qty: entry.qty,
        })),
      },
      {
        onSuccess: (data) => {
          toast.success(`收货订单 ${data.taskNo} 已创建`)
          handleClose()
          onCreated(data.taskId, data.taskNo)
        },
        onError: (error: unknown) => {
          const msg = (error as { response?: { data?: { message?: string } } })?.response?.data?.message ?? '创建失败'
          toast.error(msg)
        },
      },
    )
  }

  return (
    <>
      <Dialog open={open} onOpenChange={(next) => { if (!next) handleClose() }}>
        <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto p-0 gap-0">
          <DialogHeader className="border-b px-6 py-5">
            <DialogTitle>新建收货订单</DialogTitle>
            <DialogDescription>
              先选择供应商，再从已提交采购单中挑选本次到货商品并填写实际到货数量。
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 px-6 py-5">
            <Section title="基础信息">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-1.5">
                  <p className="text-sm font-medium">供应商 *</p>
                  <FinderTrigger
                    value={supplier?.name ?? ''}
                    placeholder="点击选择供应商..."
                    onClick={() => setSupplierFinderOpen(true)}
                  />
                </div>
                <div className="space-y-1.5">
                  <p className="text-sm font-medium">备注</p>
                  <Input value={remark} onChange={e => setRemark(e.target.value)} placeholder="选填" />
                </div>
              </div>
            </Section>

            <Section title="到货明细">
              <div className="space-y-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-center">
                  <Input
                    className="flex-1"
                    placeholder="按采购单号 / SKU / 商品名称搜索"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') setKeyword(search.trim())
                    }}
                  />
                  <div className="flex gap-2">
                    <Button variant="outline" onClick={() => setKeyword(search.trim())}>搜索</Button>
                    <Button
                      variant="outline"
                      onClick={() => {
                        setSearch('')
                        setKeyword('')
                        setQtyMap({})
                      }}
                    >
                      清空
                    </Button>
                  </div>
                </div>

                {!supplier && (
                  <div className="rounded-lg border border-dashed py-12 text-center text-sm text-muted-foreground">
                    先选择供应商，再从该供应商已提交的采购单中挑选本次到货商品
                  </div>
                )}

                {supplier && (
                  <div className="overflow-hidden rounded-xl border border-border">
                    <div className="grid grid-cols-[140px_110px_minmax(220px,1fr)_120px_90px_90px_120px] gap-3 border-b bg-muted/30 px-4 py-3 text-xs font-medium text-muted-foreground">
                      <span>采购单</span>
                      <span>SKU</span>
                      <span>商品</span>
                      <span>仓库</span>
                      <span className="text-right">已分配</span>
                      <span className="text-right">可建单</span>
                      <span className="text-right">本次到货</span>
                    </div>

                    <div className="max-h-[46vh] overflow-auto">
                      {!isLoading && candidates.length === 0 && (
                        <div className="py-12 text-center text-sm text-muted-foreground">
                          暂无可用采购明细
                        </div>
                      )}

                      <div className="divide-y">
                        {candidates.map(item => (
                          <div
                            key={item.purchaseItemId}
                            className="grid grid-cols-[140px_110px_minmax(220px,1fr)_120px_90px_90px_120px] gap-3 px-4 py-3 text-sm"
                          >
                            <div className="font-mono text-xs text-foreground">{item.purchaseOrderNo}</div>
                            <div className="font-mono text-xs text-foreground">{item.productCode}</div>
                            <div className="min-w-0">
                              <div className="truncate font-medium text-foreground">{item.productName}</div>
                              <div className="text-xs text-muted-foreground">{item.unit ?? '—'}</div>
                            </div>
                            <div className="text-muted-foreground">{item.warehouseName}</div>
                            <div className="text-right text-muted-foreground">{item.assignedQty}</div>
                            <div className="text-right font-medium text-foreground">{item.remainingQty}</div>
                            <div>
                              <Input
                                className="text-right"
                                placeholder="0"
                                value={qtyMap[item.purchaseItemId] ?? ''}
                                onChange={e => setLineQty(item, e.target.value)}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </Section>

            <Section title="建单汇总">
              <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
                <div className="space-y-1 text-sm text-muted-foreground">
                  <p>已选明细：{selectedRows.length} 行</p>
                  <p>供应商：{supplier?.name ?? '未选择'}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-muted-foreground mb-1">本次到货总数</p>
                  <p className="text-3xl font-bold text-foreground">
                    {selectedRows.reduce((sum, entry) => sum + entry.qty, 0)}
                  </p>
                </div>
              </div>
            </Section>
          </div>

          <DialogFooter className="border-t px-6 py-4">
            <Button variant="outline" onClick={handleClose} disabled={createInbound.isPending}>取消</Button>
            <Button onClick={submit} disabled={createInbound.isPending}>
              {createInbound.isPending ? '创建中...' : '创建收货订单'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <SupplierFinder
        open={supplierFinderOpen}
        onClose={() => setSupplierFinderOpen(false)}
        onConfirm={handleSupplierConfirm}
      />
    </>
  )
}

export default function InboundTasksPage() {
  const navigate = useNavigate()
  const addTab = useWorkspaceStore(s => s.addTab)
  const [keyword, setKeyword] = useState('')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('')
  const [page, setPage] = useState(1)
  const [createOpen, setCreateOpen] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['inbound-tasks', keyword, statusFilter, page],
    queryFn: () => getInboundTasksApi({ keyword, status: statusFilter ? +statusFilter : undefined, page, pageSize: 20 })
      .then(r => r.data.data),
  })

  function openDetail(row: InboundTask) {
    const path = `/inbound-tasks/${row.id}`
    addTab({ key: path, title: row.taskNo, path })
    navigate(path)
  }

  const columns: TableColumn<InboundTask>[] = [
    {
      key: 'taskNo',
      title: '任务单号',
      width: 160,
      render: v => <span className="font-mono text-xs">{v as string}</span>,
    },
    {
      key: 'purchaseOrderNo',
      title: '关联采购',
      width: 160,
      render: v => v ? <span className="text-xs">{v as string}</span> : <span className="text-muted-foreground">混合采购</span>,
    },
    {
      key: 'supplierName',
      title: '供应商',
      render: v => v ?? <span className="text-muted-foreground">—</span>,
    },
    {
      key: 'warehouseName',
      title: '仓库',
      render: v => v ?? <span className="text-muted-foreground">—</span>,
    },
    {
      key: 'status',
      title: '状态',
      width: 90,
      render: v => <Badge variant={INBOUND_STATUS_VARIANT[v as InboundTaskStatus]}>{INBOUND_STATUS_LABEL[v as InboundTaskStatus]}</Badge>,
    },
    {
      key: 'operatorName',
      title: '操作人',
      render: v => v ?? <span className="text-muted-foreground">—</span>,
    },
    {
      key: 'createdAt',
      title: '创建时间',
      width: 160,
      render: v => (v as string)?.slice(0, 16),
    },
    {
      key: 'id',
      title: '操作',
      width: 100,
      render: (_, row) => (
        <Button size="sm" variant="ghost" onClick={() => openDetail(row as InboundTask)}>详情</Button>
      ),
    },
  ]

  return (
    <div className="space-y-5">
      <PageHeader
        title="收货订单"
        description="按供应商一次到货建单；收货生成容器，PDA 打印条码并上架后计入库存"
        actions={<Button onClick={() => setCreateOpen(true)}>+ 新建收货订单</Button>}
      />

      <FilterCard>
        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex-1 min-w-[180px]">
            <Input
              placeholder="任务单号 / 采购单号 / 供应商"
              value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { setKeyword(search); setPage(1) } }}
            />
          </div>
          <Select value={statusFilter || '__all__'} onValueChange={v => { setStatusFilter(v === '__all__' ? '' : v); setPage(1) }}>
            <SelectTrigger className="w-32"><SelectValue placeholder="全部状态" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">全部</SelectItem>
              {([1, 2, 3, 4, 5] as InboundTaskStatus[]).map(s => (
                <SelectItem key={s} value={String(s)}>{INBOUND_STATUS_LABEL[s]}</SelectItem>
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
          <span>共 {data.pagination.total} 条</span>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>上一页</Button>
            <Button size="sm" variant="outline" disabled={page * 20 >= data.pagination.total} onClick={() => setPage(p => p + 1)}>下一页</Button>
          </div>
        </div>
      )}

      <CreateInboundDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(taskId, taskNo) => {
          setCreateOpen(false)
          const path = `/inbound-tasks/${taskId}`
          addTab({ key: path, title: taskNo, path })
          navigate(path)
        }}
      />
    </div>
  )
}
