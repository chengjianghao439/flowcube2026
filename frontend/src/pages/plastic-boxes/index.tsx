import { productIdentityColumns } from '@/components/shared/productIdentityColumns'
import { useState } from 'react'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { SoftStatusLabel } from '@/components/shared/StatusBadge'
import { ProductFinder } from '@/components/finder'
import { PickerField } from '@/components/shared/PickerField'
import { EmptyState } from '@/components/shared/EmptyState'
import { WarehouseSelect } from '@/components/shared/WarehouseSelect'
import { toast } from '@/lib/toast'
import { formatDisplayDateTime } from '@/lib/dateTime'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useRef } from 'react'
import { getPlasticBoxSourcesApi, repackPlasticBoxApi } from '@/api/inventory'
import { usePermission } from '@/hooks/usePermission'
import { PERMISSIONS } from '@/lib/permission-codes'
import { useIdempotentSubmit, receiptDecision } from '@/components/shared/payments/useIdempotentSubmit'
import { getOperationRequestStatusApi } from '@/api/operation-requests'
import { FilterCard } from '@/components/shared/FilterCard'
import { Button } from '@/components/ui/button'
import TableActionsMenu from '@/components/shared/TableActionsMenu'
import type { TableColumn } from '@/types'
import type { FinderResult } from '@/types/finder'
import BaseCrudPage from '@/components/shared/BaseCrudPage'
import { QueryErrorState } from '@/components/shared/QueryErrorState'
import { downloadExport } from '@/lib/exportDownload'
import {
  getPlasticBoxesApi,
  createPlasticBoxApi,
  deletePlasticBoxApi,
  printPlasticBoxLabelApi,
  usePlasticBoxMovements,
  type PlasticBox,
} from '@/hooks/usePlasticBoxes'

export default function PlasticBoxesPage() {
  const [keyword, setKeyword] = useState('')
  const [search, setSearch] = useState('')
  const page = 1
  const [detailTarget, setDetailTarget] = useState<PlasticBox | null>(null)
  // 新建表单状态（塑料盒不支持编辑，弹窗固定是创建态）
  const [product, setProduct] = useState<FinderResult | null>(null)
  const [warehouse, setWarehouse] = useState<FinderResult | null>(null)
  const [productFinderOpen, setProductFinderOpen] = useState(false)

  const columns: TableColumn<PlasticBox>[] = [
    { key: 'barcode', title: '条码', width: 140, render: v => <span className="text-doc-code">{String(v)}</span> },
    ...productIdentityColumns(),
    { key: 'warehouseName', title: '仓库', width: 140 },
    { key: 'remainingQty', title: '当前数量', width: 80, render: v => <span className="font-semibold">{String(v)}</span> },
    {
      key: 'status', title: '状态', width: 80,
      render: v => Number(v) === 1
        ? <SoftStatusLabel label="在库" tone="active" />
        : <SoftStatusLabel label="空置" tone="draft" />,
    },
    { key: 'createdAt', title: '创建时间', width: 150, render: v => formatDisplayDateTime(v) },
  ]

  return (
    <>
      <BaseCrudPage<PlasticBox>
        title="塑料盒管理"
        description="管理塑料盒（B 条码），每个塑料盒固定存放一个商品，用于零散出货"
        columns={columns}
        queryKey={['plastic-boxes', { page, pageSize: 20, keyword }]}
        listQuery={() => getPlasticBoxesApi({ page, pageSize: 20, keyword })}
        recordUnit="个"
        deleteApi={(id) => deletePlasticBoxApi(id, { skipGlobalError: true })}
        deleteMessage="确认删除该塑料盒？"
        createLabel="+ 新建塑料盒"
        headerActions={
          <Button variant="outline" onClick={() => downloadExport('/export/plastic-boxes').catch(e => toast.error((e as Error).message))}>导出</Button>
        }
        saveSuccessMessage={() => '塑料盒已创建'}
        formWidthClass="max-w-md"
        onOpen={() => { setProduct(null); setWarehouse(null); setProductFinderOpen(false) }}
        canSubmit={() => !!product && !!warehouse}
        renderToolbar={
          <FilterCard>
            <Input
              placeholder="搜索条码 / 商品…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="h-9 w-56"
              onKeyDown={e => { if (e.key === 'Enter') { setKeyword(search) } }}
            />
            <Button size="sm" variant="outline" onClick={() => { setKeyword(search) }}>搜索</Button>
            {keyword && <Button size="sm" variant="ghost" onClick={() => { setSearch(''); setKeyword('') }}>重置</Button>}
          </FilterCard>
        }
        renderActions={(row, helpers) => (
          <TableActionsMenu
            primaryLabel="详情"
            primaryVariant="outline"
            onPrimaryClick={() => setDetailTarget(row)}
            items={[
              {
                label: '打印条码',
                // 塑料盒是固定可复用码，不进补打中心；丢失/破损时在本页重复打印即可
                onClick: () => {
                  void printPlasticBoxLabelApi(row.id)
                    .then((r) => {
                      if (r?.queued) toast.success(`已加入打印队列：${row.barcode}`)
                      else toast.warning('没有可用的标签打印机，请先在「打印机管理」绑定后再试')
                    })
                    .catch((e: unknown) => toast.error((e as Error)?.message ?? '打印失败'))
                },
              },
              ...(row.remainingQty === 0 ? [{
                label: '删除',
                destructive: true,
                onClick: () => helpers.openDelete(row),
              }] : []),
            ]}
          />
        )}
        renderForm={() => (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="plastic-box-product">绑定商品 *</Label>
              <PickerField id="plastic-box-product" value={product?.name ?? ''} placeholder="点击选择商品…" onOpen={() => setProductFinderOpen(true)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="plastic-box-warehouse">所属仓库 *</Label>
              <WarehouseSelect
                id="plastic-box-warehouse"
                value={warehouse?.id ?? null}
                onChange={(id, name) => setWarehouse(id ? { id, name } : null)}
                placeholder="选择仓库"
              />
            </div>
            <ProductFinder open={productFinderOpen} onClose={() => setProductFinderOpen(false)} onConfirm={(p) => { setProduct(p); setProductFinderOpen(false) }} />
          </div>
        )}
        submitForm={() => {
          if (!product) { toast.warning('请选择商品'); throw { response: { data: { message: '请选择商品' } } } }
          if (!warehouse) { toast.warning('请选择仓库'); throw { response: { data: { message: '请选择仓库' } } } }
          return createPlasticBoxApi({
            productId: product.id,
            productName: product.name,
            productCode: product.code,
            warehouseId: warehouse.id,
            warehouseName: warehouse.name,
            unit: (product as unknown as Record<string, unknown>).unit || '',
          }, { skipGlobalError: true })
        }}
        formTitle={() => '新建塑料盒'}
      />
      <DetailDialog
        box={detailTarget}
        onClose={() => setDetailTarget(null)}
        onBoxPatched={(boxId, patch) => setDetailTarget((prev) => (prev && prev.id === boxId ? { ...prev, ...patch } : prev))}
      />
    </>
  )
}

function DetailDialog({
  box, onClose, onBoxPatched,
}: {
  box: PlasticBox | null
  onClose: () => void
  onBoxPatched: (boxId: number, patch: Partial<PlasticBox>) => void
}) {
  const { can } = usePermission()
  const canRepack = can(PERMISSIONS.INVENTORY_CONTAINER_SPLIT)
  const { data, isLoading, isError, error, refetch } = usePlasticBoxMovements(box?.id ?? null)
  const TYPE_NAMES: Record<number, string> = { 1: '入库', 2: '出库', 3: '调整' }
  const TYPE_TONE: Record<number, 'success' | 'danger' | 'info'> = { 1: 'success', 2: 'danger', 3: 'info' }
  const qc = useQueryClient()
  const [repackOpen, setRepackOpen] = useState(false)
  // 来源贡献：**累计贡献口径**（每次放货/复装记一笔来源），不是各批次当前余量
  const sourcesQuery = useQuery({
    queryKey: ['plastic-box-sources', box?.id],
    queryFn: () => getPlasticBoxSourcesApi(box!.id),
    enabled: !!box?.id,
  })
  // PC 侧用既有幂等守卫（与付款/核销同一套）：请求键在**确定结果**前不轮换，
  // 未确认时用同一份内容重试或点「查询上次结果」核对原回执，而不是每次都换新键。
  const idem = useIdempotentSubmit({ action: `plastic_box.repack.${box?.id ?? 'none'}`, prefix: 'pc-repack' })
  // 冻结「这次提交」的快照：重试与查询都用它定位，而不是用「当前界面上的盒/当前输入」
  const frozenRef = useRef<{ boxId: number; body: { perBoxQty?: number; boxCount?: number; items?: number[] }; action: string } | null>(null)

  const repackMut = useMutation({
    mutationFn: () => {
      const f = frozenRef.current
      if (!f) throw new Error('没有待重试的原提交')
      // remember 在**提交时**调用（每次提交让代次 +1）；渲染期调用会让代次每次都变
      idem.remember('还原整件', f.action)
      // 重试发送的是**原内容**，不随界面当前值变化
      return repackPlasticBoxApi(f.boxId, f.body, idem.keyRef.current)
    },
    onSuccess: (res) => {
      const f = frozenRef.current
      idem.settle()
      toast.success(`已生成 ${res.created.length} 个整件码；盒内余 ${res.boxRemainingAfter}`)
      const failed = Number(res.noPrinterCount || 0) + Number(res.renderFailedCount || 0)
      if (failed > 0) toast.warning(`${failed} 个标签未打印，可在打印记录页补打`)
      setRepackOpen(false)
      // 只 patch **原提交那只盒**（按快照定位），绝不给当前可能已切换的别的盒打补丁
      if (f) onBoxPatched(f.boxId, { remainingQty: res.boxRemainingAfter })
      void qc.invalidateQueries({ queryKey: ['plastic-boxes'] })
      if (f) void qc.invalidateQueries({ queryKey: ['plastic-box-sources', f.boxId] })
      // 容器流水同属该盒的拆分事实，成功路径也要刷新，否则同弹窗内看不到刚生成的流水
      if (f) void qc.invalidateQueries({ queryKey: ['plastic-box-movements', f.boxId] })
      frozenRef.current = null
    },
    onError: (e: unknown) => {
      const kind = idem.classify(e)
      if (kind === 'uncertain') toast.warning('结果未确认，请点「查询上次结果」核对原提交后再决定是否重试')
      else toast.error('还原整件失败，请重试')
    },
  })

  const submitRepack = (body: { perBoxQty?: number; boxCount?: number; items?: number[] }) => {
    if (!box) return
    frozenRef.current = { boxId: box.id, body, action: `plastic_box.repack.${box.id}` }
    repackMut.mutate()
  }

  /**
   * 回执查询用**独立 mutation**，拿**本次返回值**判定与展示——
   * `idem.checkLastResult` 的 onDone 无参，若在回调里读 `idem.checkMut.data` 会读到
   * 旧渲染闭包（可能 undefined 或上一次的数据），不能当作本次响应。
   * 判定规则沿用既有 `receiptDecision`：只有 failed 才解除/轮换键。
   */
  const checkMut = useMutation({
    mutationFn: () => {
      const f = frozenRef.current
      const action = f?.action ?? `plastic_box.repack.${box?.id ?? 'none'}`
      return getOperationRequestStatusApi(idem.keyRef.current, action)
    },
  })

  const doCheck = async () => {
    let r
    try { r = await checkMut.mutateAsync() } catch { toast.error('查询上次结果失败，请稍后再试'); return }
    const fid = frozenRef.current?.boxId

    if (r.status === 'success') {
      idem.settle()
      const d = r.data as { boxId?: number; boxRemainingAfter?: number; created?: Array<{ barcode: string; qty: number }> } | null
      if (d && typeof d.boxRemainingAfter === 'number') {
        const targetId = Number(d.boxId ?? fid)
        if (Number.isFinite(targetId)) onBoxPatched(targetId, { remainingQty: d.boxRemainingAfter })
        const codes = (d.created ?? []).map((c) => `${c.barcode}(${c.qty})`).join('、')
        toast.success(`已确认原提交成功：${codes || `${d.created?.length ?? 0} 个整件码`}；盒内余 ${d.boxRemainingAfter}`)
      } else {
        toast.success('已确认原提交成功')
      }
      setRepackOpen(false)
      frozenRef.current = null
      void qc.invalidateQueries({ queryKey: ['plastic-boxes'] })
      if (fid) void qc.invalidateQueries({ queryKey: ['plastic-box-sources', fid] })
      void refetch()
      return
    }

    const dec = receiptDecision(r.status)
    if (dec.rotateKey) {
      // failed：服务端明确写了失败行，确定没做成 → 解除未确认并轮换键
      idem.settle()
      toast.success('已确认上次提交失败，可按原内容重试')
    } else {
      // pending / not_found：保留原 key 与原快照，不猜失败
      toast.warning(
        r.status === 'pending'
          ? '原提交仍在服务器处理中，请稍后再点「查询上次结果」'
          : '系统暂时查不到这次提交：可能仍在处理中，也可能未送达。请按原内容重试（系统会识别为同一笔）',
      )
    }
  }

  // 提交中 / 未确认期间：不允许关详情或换盒（否则原提交快照会失去可见的恢复入口）
  const busyOrUncertain = repackMut.isPending || idem.uncertain

  return (
    <Dialog open={!!box} onOpenChange={(v) => { if (!v && busyOrUncertain) { toast.warning('有还原提交待确认，请先核对原提交结果再关闭'); return } if (!v) onClose() }}>
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle>塑料盒详情 · {box?.barcode}</DialogTitle>
        </DialogHeader>
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm text-muted-foreground">
            {box?.productName ? `绑定商品：${box.productName} (${box.productCode})` : '未绑定商品'}
            {box?.warehouseName ? ` · ${box.warehouseName}` : ''}
            {` · 当前数量 ${box?.remainingQty ?? 0}`}
          </div>
          {/* 可执行入口按权限显示：只有「库存容器拆分」权限才给还原按钮（后端守卫仍然保留） */}
          {canRepack && (
            <Button variant="outline" size="sm" onClick={() => setRepackOpen(true)} disabled={!(box?.remainingQty ?? 0)}>
              还原整件
            </Button>
          )}
        </div>

        {/* 来源贡献（批 A）：累计贡献，非当前批次余量 */}
        <div className="rounded-md border p-3">
          <div className="mb-2 text-xs font-medium text-muted-foreground">
            来源贡献（累计口径，非当前余量{sourcesQuery.data?.mixedBatch ? '；本盒为混合来源' : ''}）
          </div>
          {sourcesQuery.isError ? (
            <QueryErrorState error={sourcesQuery.error} onRetry={() => { void sourcesQuery.refetch() }} title="来源贡献加载失败" compact />
          ) : sourcesQuery.isLoading ? (
            <div className="text-xs text-muted-foreground">加载中…</div>
          ) : !sourcesQuery.data?.sources?.length ? (
            <div className="text-xs text-muted-foreground">暂无来源记录</div>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-1 pr-3 font-medium">来源条码</th>
                  <th className="py-1 pr-3 font-medium">来源批次</th>
                  <th className="py-1 font-medium text-right">累计贡献</th>
                </tr>
              </thead>
              <tbody>
                {sourcesQuery.data.sources.map((s) => (
                  <tr key={s.sourceContainerId} className="border-b last:border-0">
                    <td className="py-1 pr-3 font-mono">{s.sourceBarcode ?? `#${s.sourceContainerId}`}</td>
                    <td className="py-1 pr-3 text-muted-foreground">{s.sourceBatchNo ?? '—'}</td>
                    <td className="py-1 text-right tabular-nums">{s.contributedQty}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* 结果未确认：用同一份内容重试或查询原回执（请求键在确定结果前不轮换） */}
        {idem.uncertain && (
          <div className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
            还原整件结果未确认，请核对原提交后再继续。
            <Button size="sm" variant="outline" disabled={checkMut.isPending || repackMut.isPending}
              onClick={() => { void doCheck() }}>
              {checkMut.isPending ? '查询中…' : '查询上次结果'}
            </Button>
            <Button size="sm" variant="outline" disabled={checkMut.isPending || repackMut.isPending}
              onClick={() => repackMut.mutate()}>
              按原内容重试
            </Button>
          </div>
        )}

        <div className="text-xs font-medium text-muted-foreground">塑料盒流水</div>
        <div className="max-h-[420px] overflow-y-auto">
          {isError ? (
            <QueryErrorState error={error} onRetry={() => { void refetch() }} title="塑料盒流水加载失败" compact />
          ) : isLoading ? (
            <div className="py-8 text-center text-sm text-muted-foreground">加载中…</div>
          ) : !data?.length ? (
            <EmptyState variant="no-data" title="暂无流水" compact />
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">时间</th>
                  <th className="py-2 pr-3 font-medium">类型</th>
                  <th className="py-2 pr-3 font-medium text-right">数量</th>
                  <th className="py-2 pr-3 font-medium">备注</th>
                  <th className="py-2 font-medium">操作人</th>
                </tr>
              </thead>
              <tbody>
                {data.map((m, i) => (
                  <tr key={i} className="border-b last:border-0">
                    <td className="py-2 pr-3 whitespace-nowrap">{formatDisplayDateTime(m.createdAt)}</td>
                    <td className="py-2 pr-3">
                      <SoftStatusLabel label={m.moveTypeName ?? TYPE_NAMES[m.type] ?? `类型${m.type}`} tone={TYPE_TONE[m.type] ?? 'info'} />
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">{m.qty}</td>
                    <td className="py-2 pr-3 text-muted-foreground">{m.remark ?? '—'}</td>
                    <td className="py-2">{m.operatorName ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </DialogContent>
      {box && (
        <RepackDialog
          open={repackOpen}
          box={box}
          pending={repackMut.isPending}
          onClose={() => { if (busyOrUncertain) { toast.warning('有还原提交待确认，请先核对原提交结果'); return } setRepackOpen(false) }}
          onSubmit={submitRepack}
          locked={busyOrUncertain}
          uncertain={idem.uncertain}
          frozen={frozenRef.current}
          onCheck={() => { void doCheck() }}
          checking={checkMut.isPending}
          onRetryOriginal={() => repackMut.mutate()}
        />
      )}
    </Dialog>
  )
}

/** 还原整件（批 A · PC 入口）：等量快捷 或 逐箱清单，两种输入 */
function RepackDialog({
  open, box, pending, onClose, onSubmit, locked,
  uncertain, frozen, onCheck, checking, onRetryOriginal,
}: {
  open: boolean
  box: PlasticBox
  pending: boolean
  onClose: () => void
  onSubmit: (body: { perBoxQty?: number; boxCount?: number; items?: number[] }) => void
  locked: boolean
  uncertain: boolean
  frozen: { boxId: number; body: { perBoxQty?: number; boxCount?: number; items?: number[] }; action: string } | null
  onCheck: () => void
  checking: boolean
  onRetryOriginal: () => void
}) {
  const [mode, setMode] = useState<'quick' | 'list'>('quick')
  const [perBoxQty, setPerBoxQty] = useState('1')
  const [boxCount, setBoxCount] = useState('1')
  const [itemsStr, setItemsStr] = useState('')
  const remaining = Number(box.remainingQty ?? 0)

  // 保留**全部 token** 做校验：非数字/0/负数不能被静默丢掉，否则用户填的箱数会被悄悄改写
  const itemTokens = itemsStr.split(/[\s,，]+/).filter(Boolean)
  const parsedQtys = itemTokens.map(Number)
  const hasInvalidToken = parsedQtys.some((v) => !Number.isFinite(v) || v <= 0)
  const listQtys = parsedQtys
  const listSum = hasInvalidToken ? 0 : parsedQtys.reduce((a, b) => a + b, 0)
  const perNum = Number(perBoxQty)
  const cntNum = Number(boxCount)
  const quickSum = Number.isFinite(perNum) && Number.isInteger(cntNum) && perNum > 0 && cntNum > 0 ? perNum * cntNum : 0
  const sum = mode === 'list' ? listSum : quickSum
  const boxTotal = mode === 'list' ? itemTokens.length : (Number.isInteger(cntNum) && cntNum > 0 ? cntNum : 0)

  let error: string | null = null
  if (mode === 'list' && hasInvalidToken) error = '逐箱数量里含非法数字（每箱须是大于 0 的数字），请修正后再提交'
  else if (sum <= 0) error = '请填写数量'
  else if (sum > remaining) error = `合计 ${sum} 超过盒内余量 ${remaining}`
  else if (boxTotal > 100) error = '一次最多还原 100 箱'

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>还原整件 · {box.barcode}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          {/* 结果未确认时，恢复入口必须落在**当前可操作的弹窗内**——
              父详情的按钮会被这个 modal 挡住，形成恢复死路 */}
          {uncertain && (
            <div className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
              <p>
                上次还原结果未确认。
                {frozen && (
                  <>原提交：盒 #{frozen.boxId}，
                    {Array.isArray(frozen.body.items)
                      ? `逐箱 ${frozen.body.items.join(' / ')}`
                      : `每箱 ${frozen.body.perBoxQty} × ${frozen.body.boxCount} 箱`}
                  </>
                )}
              </p>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={checking || pending} onClick={onCheck}>
                  {checking ? '查询中…' : '查询上次结果'}
                </Button>
                <Button size="sm" variant="outline" disabled={checking || pending} onClick={onRetryOriginal}>
                  按原内容重试
                </Button>
              </div>
            </div>
          )}

          <p className="text-xs text-muted-foreground">盒内余量 {remaining}，将按填写数量生成独立整件码，余量留在盒内。</p>
          <div className="flex gap-2">
            <button type="button" disabled={locked}
              className={`flex-1 rounded-md border px-3 py-1.5 text-xs ${mode === 'quick' ? 'border-primary bg-primary/10 font-semibold' : 'border-border'} disabled:opacity-50`}
              onClick={() => setMode('quick')}>等量快捷</button>
            <button type="button" disabled={locked}
              className={`flex-1 rounded-md border px-3 py-1.5 text-xs ${mode === 'list' ? 'border-primary bg-primary/10 font-semibold' : 'border-border'} disabled:opacity-50`}
              onClick={() => setMode('list')}>逐箱清单</button>
          </div>
          {mode === 'quick' ? (
            <div className="flex gap-2">
              <div className="flex-1 space-y-1">
                <Label className="text-xs text-muted-foreground">每箱数量</Label>
                <Input type="number" inputMode="decimal" min={1} value={perBoxQty} disabled={locked} onChange={(e) => setPerBoxQty(e.target.value)} />
              </div>
              <div className="flex-1 space-y-1">
                <Label className="text-xs text-muted-foreground">箱数</Label>
                <Input type="number" inputMode="numeric" min={1} max={100} value={boxCount} disabled={locked} onChange={(e) => setBoxCount(e.target.value)} />
              </div>
            </div>
          ) : (
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">逐箱数量（空格或逗号分隔，每箱可不同）</Label>
              <Input type="text" value={itemsStr} disabled={locked} onChange={(e) => setItemsStr(e.target.value)} placeholder="如 30 25 25" />
            </div>
          )}
          <p className="text-xs text-muted-foreground">将生成 <span className="font-semibold text-foreground">{boxTotal}</span> 个整件码，合计 <span className="font-semibold text-foreground">{sum}</span>，盒内留 <span className="font-semibold text-foreground">{Math.max(0, remaining - sum)}</span></p>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose} disabled={locked}>取消</Button>
            <Button
              disabled={pending || !!error || locked}
              onClick={() => onSubmit(mode === 'list' ? { items: listQtys } : { perBoxQty: perNum, boxCount: cntNum })}
            >
              {pending ? '提交中…' : '确认还原'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
