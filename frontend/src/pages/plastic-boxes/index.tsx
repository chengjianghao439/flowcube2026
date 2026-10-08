import { productIdentityColumns } from '@/components/shared/productIdentityColumns'
import { useRef, useState, type ReactNode } from 'react'
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
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getPlasticBoxSourcesApi } from '@/api/inventory'
import { usePermission } from '@/hooks/usePermission'
import { PERMISSIONS } from '@/lib/permission-codes'
import { useCriticalOperationRecovery, isRecoveryEndpointCurrent, recoveryRequestConfig } from '@/hooks/useCriticalOperationRecovery'
import { ownsRecovery, ownsStoredRecovery, type RepackBody, type RepackRecoveryRecord } from '@/lib/criticalOperationRecovery'
import { useAuthStore } from '@/store/authStore'
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
  getPlasticBoxApi,
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
  const detailSelectionGeneration = useRef(0)
  const boxOperationGenerations = useRef(new Map<number, number>())
  const advanceBoxOperation = (boxId: number) => {
    const generation = (boxOperationGenerations.current.get(boxId) ?? 0) + 1
    boxOperationGenerations.current.set(boxId, generation)
    return generation
  }
  const selectDetail = (box: PlasticBox | null) => {
    detailSelectionGeneration.current += 1
    setDetailTarget(box)
  }
  // 新建表单状态（塑料盒不支持编辑，弹窗固定是创建态）
  const [product, setProduct] = useState<FinderResult | null>(null)
  const [warehouse, setWarehouse] = useState<FinderResult | null>(null)
  const [productFinderOpen, setProductFinderOpen] = useState(false)
  const qc = useQueryClient()
  const { can } = usePermission()
  const canRepack = can(PERMISSIONS.INVENTORY_CONTAINER_SPLIT)
  const recoveryState = useCriticalOperationRecovery({
    canExecute: canRepack,
    onFailed: record => {
      advanceBoxOperation(record.boxId)
      toast.error(`盒 #${record.boxId} 原提交已确认失败，可以重新提交`)
    },
    onConfirmed: (record, result) => {
      const operationAtConfirmation = advanceBoxOperation(record.boxId)
      if (result) {
        setDetailTarget(prev => prev?.id === record.boxId ? { ...prev, remainingQty: result.boxRemainingAfter } : prev)
        toast.success(`盒 #${record.boxId} 原提交成功：${result.created.map(c => `${c.barcode}(${c.qty})`).join('、') || '已生成整件码'}；盒内余 ${result.boxRemainingAfter}`)
        const failed = result.noPrinterCount + result.renderFailedCount
        if (failed > 0) toast.warning(`${failed} 个标签未打印，可在打印记录页补打`)
      } else {
        toast.success(`已确认盒 #${record.boxId} 原提交成功；正在重读原盒，打印状态以打印记录为准`)
        const auth = useAuthStore.getState()
        const selectionAtRead = detailSelectionGeneration.current
        const readStillCurrent = () => {
          const current = useAuthStore.getState()
          return detailSelectionGeneration.current === selectionAtRead
            && boxOperationGenerations.current.get(record.boxId) === operationAtConfirmation
            && current.user?.id === record.accountId && current.sessionGeneration === auth.sessionGeneration
            && isRecoveryEndpointCurrent(record)
        }
        void getPlasticBoxApi(record.boxId, recoveryRequestConfig(record, auth.sessionGeneration)).then(latest => {
          if (!readStillCurrent() || latest.id !== record.boxId) return
          setDetailTarget(prev => prev?.id === record.boxId ? latest : prev)
        }).catch(() => {
          if (readStillCurrent()) toast.warning('原提交已确认成功，原盒最新详情暂时无法读取，请稍后重试')
        })
      }
      // 只失效含原盒的列表和原盒独立缓存，不刷新 B 的来源/流水。
      void qc.invalidateQueries({ predicate: query => query.queryKey[0] === 'plastic-boxes' && !!(query.state.data as { list?: PlasticBox[] } | undefined)?.list?.some(box => box.id === record.boxId) })
      for (const key of ['plastic-box', 'plastic-box-sources', 'plastic-box-movements']) void qc.invalidateQueries({ queryKey: [key, record.boxId] })
    },
  })
  const recovery = {
    ...recoveryState,
    run: (boxId: number, body: RepackBody) => {
      advanceBoxOperation(boxId)
      return recoveryState.run(boxId, body)
    },
    retry: (record: RepackRecoveryRecord) => {
      advanceBoxOperation(record.boxId)
      return recoveryState.retry(record)
    },
  }
  const openOriginal = async (record: RepackRecoveryRecord) => {
    const auth = useAuthStore.getState()
    if (auth.user?.id !== record.accountId || !isRecoveryEndpointCurrent(record)) { toast.warning('请回到原服务器和账号确认原操作'); return }
    const identityCurrent = () => ownsRecovery(record) && ownsStoredRecovery(record)
    if (!identityCurrent()) return
    const selectionAtRequest = ++detailSelectionGeneration.current
    try {
      const latest = await getPlasticBoxApi(record.boxId, recoveryRequestConfig(record, auth.sessionGeneration))
      const current = useAuthStore.getState()
      if (!identityCurrent() || detailSelectionGeneration.current !== selectionAtRequest || current.user?.id !== record.accountId || current.sessionGeneration !== auth.sessionGeneration || !isRecoveryEndpointCurrent(record) || latest.id !== record.boxId) return
      setDetailTarget(latest)
    } catch {
      const current = useAuthStore.getState()
      if (identityCurrent() && detailSelectionGeneration.current === selectionAtRequest && current.user?.id === record.accountId && current.sessionGeneration === auth.sessionGeneration && isRecoveryEndpointCurrent(record)) toast.error('原盒详情加载失败，请稍后重试；恢复记录已保留')
    }
  }


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
      {recovery.error && <div role="alert" className="mb-3 rounded-md border border-amber-300 p-3 text-sm">{recovery.error}<Button size="sm" variant="outline" onClick={recovery.reload}>重新读取恢复记录</Button></div>}
      {recovery.records.map(record => <RecoveryNoticeView key={record.requestKey} record={record} recovery={recovery} canRepack={canRepack} onOpen={() => { void openOriginal(record) }} />)}
      <BaseCrudPage<PlasticBox>
        title="塑料盒管理"
        description="管理塑料盒（B 条码），每个塑料盒固定存放一个商品，用于零散出货"
        canCreate={can(PERMISSIONS.INVENTORY_CONTAINER_SPLIT)}
      canEdit={can(PERMISSIONS.INVENTORY_CONTAINER_SPLIT)}
      canDelete={can(PERMISSIONS.INVENTORY_CONTAINER_SPLIT)}
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
            onPrimaryClick={() => selectDetail(row)}
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
              ...(canRepack && row.remainingQty === 0 ? [{
                label: '删除',
                destructive: true,
                onClick: () => helpers.openDelete(row),
              }] : []),
            ]}
          />
        )}
        renderForm={(_editing, _open, locked, markDirty) => (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="plastic-box-product">绑定商品 *</Label>
              <PickerField id="plastic-box-product" disabled={locked} value={product?.name ?? ''} placeholder="点击选择商品…" onOpen={() => { if (!locked) setProductFinderOpen(true) }} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="plastic-box-warehouse">所属仓库 *</Label>
              <WarehouseSelect
                id="plastic-box-warehouse"
                disabled={locked}
                value={warehouse?.id ?? null}
                onChange={(id, name) => { if (!locked) { markDirty(); setWarehouse(id ? { id, name } : null) } }}
                placeholder="选择仓库"
              />
            </div>
            <ProductFinder open={productFinderOpen && !locked} onClose={() => setProductFinderOpen(false)} onConfirm={(p) => { if (!locked) { markDirty(); setProduct(p); setProductFinderOpen(false) } }} />
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
        key={detailTarget?.id ?? 'none'}
        recovery={recovery}
        box={detailTarget}
        onClose={() => selectDetail(null)}
      />
    </>
  )
}

function DetailDialog({
  box, onClose, recovery,
}: {
  box: PlasticBox | null
  onClose: () => void
  recovery: ReturnType<typeof useCriticalOperationRecovery>
}) {
  const { can } = usePermission()
  const canRepack = can(PERMISSIONS.INVENTORY_CONTAINER_SPLIT)
  const { data, isLoading, isError, error, refetch } = usePlasticBoxMovements(box?.id ?? null)
  const TYPE_NAMES: Record<number, string> = { 1: '入库', 2: '出库', 3: '调整' }
  const TYPE_TONE: Record<number, 'success' | 'danger' | 'info'> = { 1: 'success', 2: 'danger', 3: 'info' }
  const [repackOpen, setRepackOpen] = useState(false)
  // 来源贡献：**累计贡献口径**（每次放货/复装记一笔来源），不是各批次当前余量
  const sourcesQuery = useQuery({
    queryKey: ['plastic-box-sources', box?.id],
    queryFn: () => getPlasticBoxSourcesApi(box!.id),
    enabled: !!box?.id,
  })
  const record = recovery.records.find(r => r.boxId === box?.id) ?? null
  const notice = record ? recovery.notices[record.requestKey] : null
  const pending = !!notice?.busy
  const locked = box ? recovery.blocked(box.id) : false
  const submitRepack = (body: RepackBody) => {
    if (!box) return
    void recovery.run(box.id, body).then(result => { if (result?.status === 'success' && result.cleared) setRepackOpen(false) }).catch(error => toast.error((error as Error).message))
  }

  return (
    <Dialog open={!!box} onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="max-w-5xl" aria-describedby={undefined}>
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

        {recovery.records.map(original => <RecoveryNoticeView key={original.requestKey} record={original} recovery={recovery} canRepack={canRepack} />)}

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
          pending={pending}
          onClose={() => setRepackOpen(false)}
          onSubmit={submitRepack}
          locked={locked}
          recoveryNotice={recovery.records.map(original => <RecoveryNoticeView key={original.requestKey} record={original} recovery={recovery} canRepack={canRepack} />)}
        />
      )}
    </Dialog>
  )
}

/** 还原整件（批 A · PC 入口）：等量快捷 或 逐箱清单，两种输入 */
function RepackDialog({
  open, box, pending, onClose, onSubmit, locked,
  recoveryNotice,
}: {
  open: boolean
  box: PlasticBox
  pending: boolean
  onClose: () => void
  onSubmit: (body: RepackBody) => void
  locked: boolean
  recoveryNotice: ReactNode
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
      <DialogContent className="max-w-md" aria-describedby={undefined}>
        <DialogHeader><DialogTitle>还原整件 · {box.barcode}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          {recoveryNotice}

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
          {error && <p className="text-xs text-destructive-ink">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>取消</Button>
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

function RecoveryNoticeView({ record, recovery, canRepack, onOpen }: {
  record: RepackRecoveryRecord
  recovery: ReturnType<typeof useCriticalOperationRecovery>
  canRepack: boolean
  onOpen?: () => void
}) {
  const notice = recovery.notices[record.requestKey]
  const wrongEndpoint = !isRecoveryEndpointCurrent(record)
  const invoke = (fn: () => Promise<unknown> | unknown) => { void Promise.resolve().then(fn).catch(error => toast.error((error as Error).message)) }
  return <div role="status" className="mb-3 space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
    <p>盒 #{record.boxId} 的原还原操作{notice?.confirmed ? '结果已确认' : '待确认'}：{'items' in record.body ? `逐箱 ${record.body.items!.join(' / ')}` : `每箱 ${record.body.perBoxQty} × ${record.body.boxCount} 箱`}</p>
    <p>{wrongEndpoint ? '当前服务器已改变，请回到原服务器确认；原操作记录已保留' : notice?.message ?? (canRepack ? '请查询上次结果，或明确按原内容重试。恢复不会自动提交，也不会自动补打。' : '请查询上次结果；当前无还原整件权限。恢复不会自动提交，也不会自动补打。')}</p>
    <div className="flex flex-wrap gap-2">
      {onOpen && <Button size="sm" variant="outline" disabled={wrongEndpoint || notice?.busy} onClick={onOpen}>查看原盒</Button>}
      <Button size="sm" variant="outline" disabled={wrongEndpoint || notice?.busy || !!recovery.error} onClick={() => invoke(() => recovery.query(record))}>{notice?.busy ? '处理中…' : '查询上次结果'}</Button>
      {notice?.cleanupPending ? <Button size="sm" variant="outline" disabled={wrongEndpoint || notice?.busy} onClick={() => invoke(() => recovery.clearConfirmed(record))}>清理已确认记录</Button> : canRepack && !notice?.confirmed ? <Button size="sm" variant="outline" disabled={wrongEndpoint || notice?.busy || !!recovery.error} onClick={() => invoke(() => recovery.retry(record))}>按原内容重试</Button> : null}
    </div>
  </div>
}
