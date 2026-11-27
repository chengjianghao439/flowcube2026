import { QueryErrorState } from '@/components/shared/QueryErrorState'
import { useApprovalDetailHandoff } from '@/hooks/useApprovalDetailHandoff'
import { useApprovalReadScope } from '@/hooks/useApprovalReadScope'
import { useActiveWorkspaceTab } from '@/hooks/useActiveWorkspaceTab'
import { ApprovalHandoffNotice } from '@/components/shared/ApprovalHandoffNotice'
import { TabPathContext } from '@/components/layout/TabPathContext'
import { unitPrice } from '@/lib/format'
import { invalidateAfterPriceChange } from '@/hooks/useProducts'
import { OrderActivityDialog } from '@/components/shared/OrderActivityDialog'
import { productIdentityColumns } from '@/components/shared/productIdentityColumns'
import { useContext, useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocation } from 'react-router-dom'
import PageHeader from '@/components/shared/PageHeader'
import DataTable from '@/components/shared/DataTable'
import ListSummary from '@/components/shared/ListSummary'
import { KeywordStatusFilters } from '@/components/shared/KeywordStatusFilters'
import { EMPTY_KEYWORD_STATUS } from '@/components/shared/keywordStatusFilterDefaults'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SoftStatusLabel } from '@/components/shared/StatusBadge'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from '@/lib/toast'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import ProductFinderModal from '@/components/shared/ProductFinderModal'
import { payloadClient } from '@/api/client'
import { getProductApi } from '@/api/products'
import { usePermission } from '@/hooks/usePermission'
import { PERMISSIONS } from '@/lib/permission-codes'
import { useInvalidate } from '@/hooks/useInvalidate'
import { readNullableIntParam } from '@/lib/urlSearchParams'
import { formatDisplayDateTime } from '@/lib/dateTime'
import type { TableColumn } from '@/types'
import type { Product } from '@/types/products'

const STATUS_TONE: Record<number, 'warning' | 'success' | 'danger' | 'info'> = { 1: 'warning', 2: 'success', 3: 'danger', 4: 'info' }
const PRICE_TYPES = {
  sale: { label: '标签销售价', field: 'labelSalePrice' },
  cost: { label: '成本价', field: 'costPrice' },
  a: { label: '等级A', field: 'salePriceA' },
  b: { label: '等级B', field: 'salePriceB' },
  c: { label: '等级C', field: 'salePriceC' },
  d: { label: '等级D', field: 'salePriceD' },
} satisfies Record<string, { label: string; field: keyof Product }>
type PriceType = keyof typeof PRICE_TYPES
const priceTypeLabel = (type: string) => Object.hasOwn(PRICE_TYPES, type) ? PRICE_TYPES[type as PriceType].label : '价格类型待核'

interface PriceChangeRequest {
  id: number
  requestNo: string
  productCode: string | null
  productName: string | null
  articleNumber: string | null
  spec: string | null
  color: string | null
  priceType: string
  oldPrice: number | null
  newPrice: number
  reason: string | null
  status: number
  statusName: string
  approvalId: number | null
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

const readPriceChange = (id: number) => payloadClient.get<PriceChangeRequest>(`/price-change/${id}`)

const STATUS_OPTIONS = [
  { value: '', label: '全部申请' },
  { value: '1', label: '草稿 / 待审批' },
  { value: '2', label: '已通过' },
  { value: '3', label: '已驳回' },
  { value: '4', label: '已取消' },
]

export default function PriceChangePage() {
  const qc = useQueryClient()
  const invalidate = useInvalidate()
  const tabPath = useContext(TabPathContext)
  const location = useLocation()
  const [ownPath, ownSearch = ''] = (tabPath || `${location.pathname}${location.search}`).split('?')
  const searchParams = new URLSearchParams(ownSearch)
  const [filters, setFilters] = useState(EMPTY_KEYWORD_STATUS)
  const [queryOpen, setQueryOpen] = useState(false)
  const { keyword, status } = filters
  const [createOpen, setCreateOpen] = useState(false)
  const [product, setProduct] = useState<{ id: number; code: string; name: string } | null>(null)
  const [productFinderOpen, setProductFinderOpen] = useState(false)
  const [priceType, setPriceType] = useState<PriceType>('sale')
  const [newPrice, setNewPrice] = useState('')
  const [reason, setReason] = useState('')
  const [rejectTarget, setRejectTarget] = useState<PriceChangeRequest | null>(null)
  const [rejectReason, setRejectReason] = useState('')
  const [cancelTarget, setCancelTarget] = useState<PriceChangeRequest | null>(null)
  const { can } = usePermission()
  const canUpdate = can(PERMISSIONS.PRODUCT_UPDATE)
  const canApprove = can(PERMISSIONS.APPROVAL_TASK_VIEW)
  const [manualDetailOpen, setManualDetailOpen] = useState(false)
  const handoff = useApprovalDetailHandoff('/price-change', 'product.view', readPriceChange, createOpen || productFinderOpen || !!rejectTarget || !!cancelTarget || manualDetailOpen)
  const scope = useApprovalReadScope()
  const active = useActiveWorkspaceTab()
  const canReadReference = can(PERMISSIONS.PRODUCT_VIEW)
  const productId = product?.id
  const priceReference = useQuery({
    queryKey: ['products', productId, 'price-change-reference', scope.key],
    enabled: active && createOpen && canUpdate && canReadReference && productId != null,
    staleTime: 0,
    retry: false,
    queryFn: async ({ signal }) => {
      const detail = await getProductApi(productId!, {
        signal, baseURL: scope.server, _authSessionGeneration: scope.generation,
        _erpApiFallbackTried: true, automaticReplay: false, skipGlobalError: true,
      })
      if (detail?.id !== productId || !scope.isCurrent()) throw new Error('当前商品价格无法核对')
      return detail
    },
  })
  const reference = priceReference.data
  const referenceValue = reference?.[PRICE_TYPES[priceType].field]
  const referenceKnown = typeof referenceValue === 'number' && Number.isFinite(referenceValue)
  // 商品详情对历史空等级 A 可能返回标签价。相同值时仅显示资料参考，不用它推算差额。
  const gradeAFallbackPossible = priceType === 'a'
    && (reference?.labelSalePrice === undefined || referenceValue === reference.labelSalePrice)
  const targetPrice = Number(newPrice)
  const difference = referenceKnown && !gradeAFallbackPossible && newPrice.trim() !== ''
    && Number.isFinite(targetPrice) && targetPrice >= 0 && Number(targetPrice.toFixed(4)) === targetPrice
    ? targetPrice - referenceValue : null

  // 商品列表「申请改价」跳转（?productId=）时预填商品并打开申请弹窗
  const preselectProductId = readNullableIntParam(searchParams, 'productId')
  const canPreselectProduct = ownPath === '/price-change' && active && !searchParams.has('detailId') && can(PERMISSIONS.PRODUCT_VIEW) && canUpdate
    && !createOpen && !productFinderOpen && !rejectTarget && !cancelTarget && !manualDetailOpen && !handoff.open
  const consumedProduct = useRef('')
  useEffect(() => {
    let obsolete = false
    const identity = `${scope.key}:${preselectProductId}`
    if (canPreselectProduct && preselectProductId != null && !product && consumedProduct.current !== identity) {
      payloadClient.get<{ id: number; code: string; name: string }>(`/products/${preselectProductId}`).then((p) => {
        if (!obsolete && scope.isCurrent() && p?.id === preselectProductId) {
          consumedProduct.current = identity
          setProduct({ id: p.id, code: p.code, name: p.name })
          setCreateOpen(true)
        }
      }).catch(() => { /* 商品不可查看时保留当前输入 */ })
    }
    return () => { obsolete = true }
    // isCurrent 由此代次的key和服务器快照核对，不依赖每次渲染创建的函数引用。
    // eslint-disable-next-line react-hooks/exhaustive-deps -- key变化使旧会话读取失效，已有草稿保持
  }, [preselectProductId, product, canPreselectProduct, scope.key])

  const PAGE_SIZE = 20
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['price-change', { page: 1, keyword, ...(status && { status: Number(status) }) }],
    queryFn: () => payloadClient.get<PriceChangeListResult>('/price-change', { params: { page: 1, pageSize: PAGE_SIZE, keyword, ...(status && { status: Number(status) }) } }),
  })
  const total = data?.pagination?.total ?? 0
  const list: PriceChangeRequest[] = data?.list ?? []

  const createMut = useMutation({
    mutationFn: () => {
      if (!can(PERMISSIONS.PRODUCT_UPDATE)) throw new Error('没有申请改价权限')
      return payloadClient.post<CreateResult>('/price-change', { productId: product!.id, priceType, newPrice: Number(newPrice), reason })
    },
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: ['price-change'] })
      setCreateOpen(false)
      setProduct(null); setNewPrice(''); setReason('')
      toast.success(`改价申请 ${d?.requestNo} 已创建`)
    },
    onError: (e: unknown) => toast.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? '创建失败'),
  })

  const submitMut = useMutation({
    mutationFn: (id: number) => {
      if (!can(PERMISSIONS.PRODUCT_UPDATE)) throw new Error('没有提交改价权限')
      return payloadClient.post(`/price-change/${id}/submit`)
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['price-change'] }); invalidate('approval_pending_changed'); toast.success('已提交审批') },
    onError: (e: unknown) => toast.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? '提交失败'),
  })

  const approveMut = useMutation({
    mutationFn: (id: number) => {
      if (!can(PERMISSIONS.APPROVAL_TASK_VIEW)) throw new Error('没有审批权限')
      return payloadClient.post<ApproveResult>(`/price-change/${id}/approve`)
    },
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: ['price-change'] })
      invalidate('approval_pending_changed')
      // 审批真正完成时价格才落库 ⇒ 连带失效商品缓存（详情/列表/Finder），否则编辑页会在
      // 5min staleTime 内继续显示旧的 labelSalePrice。具体与理由见 useProducts 的同名函数。
      invalidateAfterPriceChange(qc, d)
      toast.success(d?.finished ? '审批通过，价格已生效' : '本步骤已批准')
    },
    onError: (e: unknown) => toast.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? '审批失败'),
  })

  const rejectMut = useMutation({
    mutationFn: ({ id, reason: r }: { id: number; reason: string }) => {
      if (!can(PERMISSIONS.APPROVAL_TASK_VIEW)) throw new Error('没有审批权限')
      return payloadClient.post(`/price-change/${id}/reject`, { reason: r })
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['price-change'] }); invalidate('approval_pending_changed'); setRejectTarget(null); setRejectReason(''); toast.success('已驳回') },
    onError: (e: unknown) => toast.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? '驳回失败'),
  })

  const cancelMut = useMutation({
    mutationFn: (id: number) => {
      if (!can(PERMISSIONS.PRODUCT_UPDATE)) throw new Error('没有取消改价权限')
      return payloadClient.post(`/price-change/${id}/cancel`)
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['price-change'] }); invalidate('approval_pending_changed'); setCancelTarget(null); toast.success('已取消') },
    onError: (e: unknown) => toast.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? '取消失败'),
  })

  const columns: TableColumn<PriceChangeRequest>[] = [
    { key: 'requestNo', title: '申请单号', width: 150 },
    ...productIdentityColumns(),
    { key: 'priceType', title: '价格类型', width: 112, render: v => priceTypeLabel(String(v)) },
    { key: 'oldPrice', title: '申请时原价', width: 112, align: 'right', render: v => v != null ? unitPrice(Number(v)) : '—' },
    { key: 'newPrice', title: '申请新价', width: 104, align: 'right', render: v => unitPrice(Number(v)) },
    { key: 'status', title: '状态', width: 96, minWidth: 96, render: (v, row) => <SoftStatusLabel label={row.statusName ?? String(v)} tone={row.status === 1 && row.approvalId === null ? 'draft' : STATUS_TONE[Number(v)] ?? 'info'} /> },
    { key: 'applicantName', title: '申请人', width: 100 },
    { key: 'createdAt', title: '申请时间', width: 160, render: v => formatDisplayDateTime(v) },
    { key: 'id', title: '操作', width: 200, render: (_, row) => (
      <OrderActivityDialog onOpenChange={setManualDetailOpen} type="price" id={row.id} title={row.requestNo} fields={[
          ['商品', row.productName], ['价格类型', priceTypeLabel(row.priceType)], ['原价格', row.oldPrice], ['申请价格', row.newPrice], ['状态', row.statusName], ['申请人', row.applicantName], ['申请原因', row.reason],
        ]} menuItems={row.status === 1 ? [
          ...(canUpdate && row.approvalId === null ? [{ label: '提交', disabled: submitMut.isPending, onClick: () => submitMut.mutate(row.id) }] : []),
          ...(canApprove && row.approvalId != null ? [
            { label: '通过', disabled: approveMut.isPending, onClick: () => approveMut.mutate(row.id) },
            { label: '驳回', afterMenuClose: true, destructive: true, onClick: () => { setRejectTarget(row); setRejectReason('') } },
          ] : []),
          ...(canUpdate ? [{ label: '取消', afterMenuClose: true, onClick: () => setCancelTarget(row) }] : []),
        ] : []} />
    )},
  ]

  return (
    <div className="space-y-4">
      <PageHeader title="商品改价申请"
        description="改价走审批流，审批通过后自动生效并留变更历史。"  actions={<>
        <Button variant="outline" onClick={() => setQueryOpen(true)}>查询</Button>
        {canUpdate && <Button onClick={() => setCreateOpen(true)}>申请改价</Button>}
      </>} />

      <KeywordStatusFilters title="改价申请" dialogId="price-change-query" placeholder="搜索单号/商品…"
        options={STATUS_OPTIONS} value={filters} onChange={setFilters} open={queryOpen} onClose={() => setQueryOpen(false)} />
      {isError ? <QueryErrorState error={error} onRetry={() => void refetch()} /> : <DataTable fluid columnStorageKey="price-change" scrollLabel="改价申请表格" virtualized preserveFocus retainFocusedRow={manualDetailOpen} columns={columns} data={list} loading={isLoading} />}
      {data && !isLoading && !isError && <ListSummary total={total} unit="单" />}

      <ApprovalHandoffNotice {...handoff} />
      {handoff.data && <OrderActivityDialog type="price" id={handoff.data.id} title={handoff.data.requestNo} open={handoff.open} hideTrigger onOpenChange={open => { if (!open) handoff.close() }} fields={[
        ['商品', handoff.data.productName], ['价格类型', priceTypeLabel(handoff.data.priceType)], ['原价格', handoff.data.oldPrice], ['申请价格', handoff.data.newPrice], ['状态', handoff.data.statusName], ['申请人', handoff.data.applicantName], ['申请原因', handoff.data.reason],
      ]} />}
      {/* 新建改价申请 */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="fc-form-dialog max-w-2xl">
          <DialogHeader><DialogTitle>申请改价</DialogTitle></DialogHeader>
          <div className="fc-form-dialog-body space-y-4">
            <div>
              <p className="mb-1 text-sm font-medium">商品</p>
              <Button variant="outline" className="h-auto min-h-10 w-full justify-start whitespace-normal py-2 text-left" onClick={() => setProductFinderOpen(true)}>
                {product ? `${product.code} · ${product.name}` : '选择商品…'}
              </Button>
            </div>
            <div>
              <p className="mb-1 text-sm font-medium">价格类型</p>
              <Select value={priceType} onValueChange={value => { if (Object.hasOwn(PRICE_TYPES, value)) setPriceType(value as PriceType) }}>
                <SelectTrigger aria-label="价格类型" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(PRICE_TYPES).map(([key, { label }]) => <SelectItem key={key} value={key}>{label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <p className="mb-1 text-sm font-medium">新价格</p>
              <Input aria-label="新价格" type="number" min="0" step="0.01" value={newPrice} onChange={(e) => setNewPrice(e.target.value)} placeholder="输入新价格" />
              {product && canUpdate && canReadReference && active && scope.isCurrent() && <div role="status" className="mt-2 text-sm text-muted-foreground">
                {priceReference.isPaused ? '等待网络连接，价格参考暂不可用。'
                  : priceReference.isFetching || priceReference.isPending ? '正在加载当前价格…'
                    : priceReference.isError ? <>当前价格读取失败。 <Button type="button" size="sm" variant="outline" onClick={() => void priceReference.refetch()}>重试价格读取</Button></>
                      : referenceKnown ? <>
                        {gradeAFallbackPossible ? '商品资料参考价' : '当前价格'} <span className="font-medium tabular-nums text-foreground">{unitPrice(referenceValue)}</span>
                        {gradeAFallbackPossible && <span> · 等级 A 请在商品资料中核对。</span>}
                        {difference != null && <span className="tabular-nums"> · 变化 {difference > 0 ? '+' : ''}{unitPrice(difference)}</span>}
                      </> : '商品资料未提供此价格。'}
              </div>}
            </div>
            <div>
              <p className="mb-1 text-sm font-medium">申请理由</p>
              <Input aria-label="申请理由" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="选填" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>取消</Button>
            {canUpdate && <Button onClick={() => createMut.mutate()} disabled={!product || !newPrice || createMut.isPending}>创建申请</Button>}
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
        <DialogContent className="fc-form-dialog max-w-lg">
          <DialogHeader description={<>{<>商品「{rejectTarget?.productName}」：¥{rejectTarget?.oldPrice ?? '—'} → ¥{rejectTarget?.newPrice}</>}</>}><DialogTitle>驳回改价申请</DialogTitle></DialogHeader>
          <div className="fc-form-dialog-body space-y-4">

            <label className="block space-y-2"><span className="text-sm font-medium">驳回理由（选填）</span><Input value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} placeholder="驳回理由（选填）" /></label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectTarget(null)}>取消</Button>
            {canApprove && <Button variant="destructive" onClick={() => rejectTarget && rejectMut.mutate({ id: rejectTarget.id, reason: rejectReason })} disabled={rejectMut.isPending}>确认驳回</Button>}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!cancelTarget && canUpdate}
        title="取消改价申请"
        description={`取消「${cancelTarget?.productName}」的改价申请？`}
        confirmText="取消申请"
        onConfirm={() => cancelTarget && cancelMut.mutate(cancelTarget.id)}
        onCancel={() => setCancelTarget(null)}
      />
    </div>
  )
}
