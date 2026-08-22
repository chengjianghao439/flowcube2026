import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import PageHeader from '@/components/shared/PageHeader'
import DataTable from '@/components/shared/DataTable'
import Pagination from '@/components/shared/Pagination'
import { FilterCard } from '@/components/shared/FilterCard'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SoftStatusLabel } from '@/components/shared/StatusBadge'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from '@/lib/toast'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import ProductFinderModal from '@/components/shared/ProductFinderModal'
import { payloadClient } from '@/api/client'
import { usePermission } from '@/hooks/usePermission'
import { readNullableIntParam } from '@/lib/urlSearchParams'
import type { TableColumn } from '@/types'

const STATUS_TONE: Record<number, 'warning' | 'success' | 'danger' | 'info'> = { 1: 'warning', 2: 'success', 3: 'danger', 4: 'info' }
const STATUS_LABEL: Record<number, string> = { 1: '待审批', 2: '已通过', 3: '已驳回', 4: '已取消' }
const PRICE_TYPE_LABEL: Record<string, string> = { sale: '销售价', cost: '成本价', a: '等级A', b: '等级B', c: '等级C', d: '等级D' }

interface PriceChangeRequest {
  id: number
  requestNo: string
  productCode: string | null
  productName: string | null
  priceType: string
  oldPrice: number | null
  newPrice: number
  reason: string | null
  status: number
  statusName: string
  applicantName: string | null
  createdAt: string
}

interface PriceChangeListResult {
  list: PriceChangeRequest[]
  pagination: { page: number; pageSize: number; total: number }
}

interface CreateResult {
  id: number
  requestNo: string
}

interface ApproveResult {
  id: number
  finished: boolean
}

export default function PriceChangePage() {
  const qc = useQueryClient()
  const [searchParams] = useSearchParams()
  const [page, setPage] = useState(1)
  const [keyword, setKeyword] = useState('')
  const [search, setSearch] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [product, setProduct] = useState<{ id: number; code: string; name: string } | null>(null)
  const [productFinderOpen, setProductFinderOpen] = useState(false)
  const [priceType, setPriceType] = useState('sale')
  const [newPrice, setNewPrice] = useState('')
  const [reason, setReason] = useState('')
  const [rejectTarget, setRejectTarget] = useState<PriceChangeRequest | null>(null)
  const [rejectReason, setRejectReason] = useState('')
  const [cancelTarget, setCancelTarget] = useState<PriceChangeRequest | null>(null)
  const { can } = usePermission()
  const canApprove = can('approval.task.view')

  // 商品列表「申请改价」跳转（?productId=）时预填商品并打开申请弹窗
  const preselectProductId = readNullableIntParam(searchParams, 'productId')
  useEffect(() => {
    if (preselectProductId != null && !product) {
      payloadClient.get<{ id: number; code: string; name: string }>(`/products/${preselectProductId}`).then((p) => {
        if (p?.id) {
          setProduct({ id: p.id, code: p.code, name: p.name })
          setCreateOpen(true)
        }
      }).catch(() => { /* 商品不存在则忽略 */ })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preselectProductId])

  const PAGE_SIZE = 20
  const { data, isLoading } = useQuery({
    queryKey: ['price-change', { page, keyword }],
    queryFn: () => payloadClient.get<PriceChangeListResult>('/price-change', { params: { page, pageSize: PAGE_SIZE, keyword } }),
  })
  const total = data?.pagination?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const list: PriceChangeRequest[] = data?.list ?? []

  const createMut = useMutation({
    mutationFn: () => payloadClient.post<CreateResult>('/price-change', { productId: product!.id, priceType, newPrice: Number(newPrice), reason }),
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: ['price-change'] })
      setCreateOpen(false)
      setProduct(null); setNewPrice(''); setReason('')
      toast.success(`改价申请 ${d?.requestNo} 已创建`)
    },
    onError: (e: unknown) => toast.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? '创建失败'),
  })

  const submitMut = useMutation({
    mutationFn: (id: number) => payloadClient.post(`/price-change/${id}/submit`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['price-change'] }); toast.success('已提交审批') },
    onError: (e: unknown) => toast.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? '提交失败'),
  })

  const approveMut = useMutation({
    mutationFn: (id: number) => payloadClient.post<ApproveResult>(`/price-change/${id}/approve`),
    onSuccess: (d) => { qc.invalidateQueries({ queryKey: ['price-change'] }); toast.success(d?.finished ? '审批通过，价格已生效' : '审批已通过本步骤') },
    onError: (e: unknown) => toast.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? '审批失败'),
  })

  const rejectMut = useMutation({
    mutationFn: ({ id, reason: r }: { id: number; reason: string }) => payloadClient.post(`/price-change/${id}/reject`, { reason: r }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['price-change'] }); setRejectTarget(null); setRejectReason(''); toast.success('已驳回') },
    onError: (e: unknown) => toast.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? '驳回失败'),
  })

  const cancelMut = useMutation({
    mutationFn: (id: number) => payloadClient.post(`/price-change/${id}/cancel`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['price-change'] }); setCancelTarget(null); toast.success('已取消') },
    onError: (e: unknown) => toast.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? '取消失败'),
  })

  const columns: TableColumn<PriceChangeRequest>[] = [
    { key: 'requestNo', title: '申请单号', width: 150 },
    { key: 'productCode', title: '商品编码', width: 110 },
    { key: 'productName', title: '商品名称', width: 180 },
    { key: 'priceType', title: '价格类型', width: 90, render: (v) => PRICE_TYPE_LABEL[String(v)] ?? String(v) },
    { key: 'oldPrice', title: '现价', width: 90, align: 'right', render: (v) => v != null ? `¥${Number(v).toFixed(2)}` : '—' },
    { key: 'newPrice', title: '新价', width: 90, align: 'right', render: (v) => `¥${Number(v).toFixed(2)}` },
    { key: 'status', title: '状态', width: 80, render: (v) => <SoftStatusLabel label={STATUS_LABEL[Number(v)] ?? String(v)} tone={STATUS_TONE[Number(v)] ?? 'info'} /> },
    { key: 'applicantName', title: '申请人', width: 100 },
    { key: 'createdAt', title: '申请时间', width: 160 },
    { key: 'id', title: '操作', width: 200, render: (_, row) => (
      <div className="flex gap-1">
        {row.status === 1 && (
          <>
            <Button size="sm" variant="outline" onClick={() => submitMut.mutate(row.id)} disabled={submitMut.isPending}>提交</Button>
            {canApprove && <Button size="sm" onClick={() => approveMut.mutate(row.id)} disabled={approveMut.isPending}>通过</Button>}
            {canApprove && <Button size="sm" variant="outline" className="text-destructive" onClick={() => { setRejectTarget(row); setRejectReason('') }}>驳回</Button>}
            <Button size="sm" variant="ghost" onClick={() => setCancelTarget(row)}>取消</Button>
          </>
        )}
      </div>
    )},
  ]

  return (
    <div className="space-y-4">
      <PageHeader title="商品改价申请" description="改价走审批流，审批通过后自动生效并留变更历史" actions={
        <Button onClick={() => setCreateOpen(true)}>+ 申请改价</Button>
      } />
      <FilterCard>
        <Input placeholder="搜索单号/商品…" value={search} onChange={(e) => setSearch(e.target.value)} className="h-9 w-64" onKeyDown={(e) => { if (e.key === 'Enter') { setKeyword(search); setPage(1) } }} />
        <Button size="sm" variant="outline" onClick={() => { setKeyword(search); setPage(1) }}>搜索</Button>
        {keyword && <Button size="sm" variant="ghost" onClick={() => { setSearch(''); setKeyword(''); setPage(1) }}>重置</Button>}
      </FilterCard>
      <DataTable columns={columns} data={list} loading={isLoading} />
      <Pagination page={page} totalPages={totalPages} total={total} unit="单" onPageChange={setPage} />

      {/* 新建改价申请 */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>申请改价</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <p className="mb-1 text-sm font-medium">商品</p>
              <Button variant="outline" className="w-full justify-start" onClick={() => setProductFinderOpen(true)}>
                {product ? `${product.code} · ${product.name}` : '选择商品…'}
              </Button>
            </div>
            <div>
              <p className="mb-1 text-sm font-medium">价格类型</p>
              <Select value={priceType} onValueChange={setPriceType}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(PRICE_TYPE_LABEL).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <p className="mb-1 text-sm font-medium">新价格</p>
              <Input type="number" min="0" step="0.01" value={newPrice} onChange={(e) => setNewPrice(e.target.value)} placeholder="输入新价格" />
            </div>
            <div>
              <p className="mb-1 text-sm font-medium">申请理由</p>
              <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="选填" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>取消</Button>
            <Button onClick={() => createMut.mutate()} disabled={!product || !newPrice || createMut.isPending}>创建申请</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 商品选择 */}
      <ProductFinderModal
        open={productFinderOpen}
        onClose={() => setProductFinderOpen(false)}
        onConfirm={(p) => { setProduct({ id: p.id, code: p.code, name: p.name }); setProductFinderOpen(false) }}
      />

      {/* 驳回 */}
      <Dialog open={!!rejectTarget} onOpenChange={(o) => { if (!o) setRejectTarget(null) }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>驳回改价申请</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">商品「{rejectTarget?.productName}」：¥{rejectTarget?.oldPrice ?? '—'} → ¥{rejectTarget?.newPrice}</p>
            <Input value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} placeholder="驳回理由（选填）" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectTarget(null)}>取消</Button>
            <Button variant="destructive" onClick={() => rejectTarget && rejectMut.mutate({ id: rejectTarget.id, reason: rejectReason })} disabled={rejectMut.isPending}>确认驳回</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!cancelTarget}
        title="取消改价申请"
        description={`取消「${cancelTarget?.productName}」的改价申请？`}
        confirmText="取消申请"
        onConfirm={() => cancelTarget && cancelMut.mutate(cancelTarget.id)}
        onCancel={() => setCancelTarget(null)}
      />
    </div>
  )
}
