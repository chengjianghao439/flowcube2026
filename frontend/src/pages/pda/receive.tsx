/**
 * PDA 收货 — 支持按产品逐箱录入并批量打印库存条码
 */
import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getInboundTaskByIdApi, receiveInboundApi } from '@/api/inbound-tasks'
import type { InboundTask } from '@/types/inbound-tasks'
import PdaHeader from '@/components/pda/PdaHeader'
import PdaBottomBar from '@/components/pda/PdaBottomBar'
import PdaScanner from '@/components/pda/PdaScanner'
import PdaCard from '@/components/pda/PdaCard'
import PdaFlash from '@/components/pda/PdaFlash'
import { PdaLoading } from '@/components/pda/PdaEmptyState'
import PdaFlowPanel from '@/components/pda/PdaFlowPanel'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { parseBarcode } from '@/utils/barcode'
import { usePdaFeedback } from '@/hooks/usePdaFeedback'
import { useCriticalPdaAction } from '@/hooks/useCriticalPdaAction'
import { getInboundClosureCopy } from '@/lib/inboundClosure'
import PdaCriticalActionNotice from '@/components/pda/PdaCriticalActionNotice'

interface ProductSummary {
  productId: number
  productCode: string | null
  productName: string
  unit: string | null
  orderedQty: number
  receivedQty: number
  remainingQty: number
  purchaseRefs: string[]
}

function groupProducts(task: InboundTask): ProductSummary[] {
  const map = new Map<number, ProductSummary>()
  for (const item of task.items ?? []) {
    const current = map.get(item.productId)
    const purchaseRef = item.purchaseOrderNo ?? '—'
    if (current) {
      current.orderedQty += item.orderedQty
      current.receivedQty += item.receivedQty
      current.remainingQty += Math.max(0, item.orderedQty - item.receivedQty)
      if (!current.purchaseRefs.includes(purchaseRef)) current.purchaseRefs.push(purchaseRef)
      continue
    }
    map.set(item.productId, {
      productId: item.productId,
      productCode: item.productCode,
      productName: item.productName,
      unit: item.unit,
      orderedQty: item.orderedQty,
      receivedQty: item.receivedQty,
      remainingQty: Math.max(0, item.orderedQty - item.receivedQty),
      purchaseRefs: [purchaseRef],
    })
  }
  return [...map.values()]
}

function parseQty(value: string): number {
  return Number(value.trim().replace(/,/g, '.'))
}

function ProductCard({
  product,
  active,
  onClick,
}: {
  product: ProductSummary
  active: boolean
  onClick: () => void
}) {
  return (
    <PdaCard active={active} onClick={onClick} className="text-left">
      <div className="space-y-2">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-semibold text-foreground truncate">{product.productName}</p>
            <p className="font-mono text-xs text-muted-foreground">{product.productCode ?? '—'}</p>
          </div>
          <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${product.remainingQty > 0 ? 'bg-primary/10 text-primary' : 'bg-emerald-500/10 text-emerald-600'}`}>
            剩余 {product.remainingQty}
          </span>
        </div>
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>应到 {product.orderedQty}</span>
          <span>已收 {product.receivedQty}</span>
        </div>
      </div>
    </PdaCard>
  )
}

function ReceiveEditor({
  product,
  boxes,
  submitting,
  onChangeBox,
  onAddBox,
  onRemoveBox,
  onReset,
  onSubmit,
}: {
  product: ProductSummary
  boxes: string[]
  submitting: boolean
  onChangeBox: (index: number, value: string) => void
  onAddBox: () => void
  onRemoveBox: (index: number) => void
  onReset: () => void
  onSubmit: () => void
}) {
  const parsedBoxes = boxes.map(parseQty).filter(qty => Number.isFinite(qty) && qty > 0)
  const totalQty = parsedBoxes.reduce((sum, qty) => sum + qty, 0)
  const remainingAfter = product.remainingQty - totalQty

  return (
    <PdaCard active className="space-y-4">
      <div>
        <p className="text-lg font-semibold text-foreground">{product.productName}</p>
        <p className="font-mono text-xs text-muted-foreground mt-1">{product.productCode ?? '—'}</p>
        <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
          <span>应到 {product.orderedQty}</span>
          <span>已收 {product.receivedQty}</span>
          <span>剩余 {product.remainingQty}</span>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">来源采购单：{product.purchaseRefs.join('、')}</p>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-foreground">逐箱数量</p>
          <Button type="button" size="sm" variant="outline" onClick={onAddBox}>+ 增加一箱</Button>
        </div>

        <div className="space-y-2">
          {boxes.map((value, index) => (
            <div key={index} className="flex items-center gap-2">
              <div className="w-14 shrink-0 text-xs text-muted-foreground">箱 {index + 1}</div>
              <Input
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                value={value}
                onChange={e => onChangeBox(index, e.target.value)}
                placeholder="输入本箱数量"
                className="font-mono"
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onRemoveBox(index)}
                disabled={boxes.length === 1}
              >
                删除
              </Button>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-border bg-muted/20 px-3 py-3 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">本次打印箱数</span>
          <span className="font-semibold text-foreground">{parsedBoxes.length}</span>
        </div>
        <div className="mt-1 flex items-center justify-between">
          <span className="text-muted-foreground">本次收货数量</span>
          <span className="font-semibold text-foreground">{totalQty}</span>
        </div>
        <div className="mt-1 flex items-center justify-between">
          <span className="text-muted-foreground">提交后剩余</span>
          <span className={`font-semibold ${remainingAfter < 0 ? 'text-destructive' : 'text-foreground'}`}>{remainingAfter}</span>
        </div>
      </div>

      <div className="flex gap-2">
        <Button type="button" variant="outline" className="flex-1" onClick={onReset} disabled={submitting}>
          清空箱数
        </Button>
        <Button type="button" className="flex-1" onClick={onSubmit} disabled={submitting}>
          {submitting ? '提交中...' : '打印并登记'}
        </Button>
      </div>
    </PdaCard>
  )
}

function ReceiveRunner({ task }: { task: InboundTask }) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { flash, ok, err, warn } = usePdaFeedback()
  const products = useMemo(() => groupProducts(task), [task])
  const selectableProducts = useMemo(() => products.filter(product => product.remainingQty > 0), [products])
  const [selectedProductId, setSelectedProductId] = useState<number | null>(selectableProducts[0]?.productId ?? null)
  const [boxes, setBoxes] = useState<string[]>([''])
  const [submitting, setSubmitting] = useState(false)
  const receiveAction = useCriticalPdaAction<{
    containers?: Array<{ containerId: number }>
    printJobIds?: number[]
  }>({
    action: `inbound.receive.${task.id}`,
    label: `收货单 ${task.taskNo}`,
    onConfirmed: async (data) => {
      await qc.invalidateQueries({ queryKey: ['pda-inbound-task', task.id] })
      await qc.invalidateQueries({ queryKey: ['pda-inbound-tasks'] })
      const count = data.containers?.length ?? 0
      const printCount = data.printJobIds?.length ?? 0
      ok(`已生成 ${count} 个库存条码${printCount > 0 ? `，已提交 ${printCount} 条打印任务` : ''}`)
    },
  })

  const activeProduct = selectableProducts.find(product => product.productId === selectedProductId) ?? null
  const closureCopy = getInboundClosureCopy(task)

  function resetBoxes(defaultCount = 1) {
    setBoxes(Array.from({ length: defaultCount }, () => ''))
  }

  function selectProduct(productId: number) {
    setSelectedProductId(productId)
    resetBoxes(1)
  }

  function handleScan(raw: string) {
    const parsed = parseBarcode(raw)
    if (parsed.type !== 'product' && parsed.type !== 'unknown') {
      err('扫描产品条码')
      return
    }

    const normalized = raw.trim().toUpperCase()
    const match = selectableProducts.find(product =>
      normalized === String(product.productCode ?? '').toUpperCase()
      || parsed.id === product.productId,
    )
    if (!match) {
      err(`商品不在本收货单：${raw}`)
      return
    }

    selectProduct(match.productId)
    ok(`已选中 ${match.productName}`)
  }

  function submitReceive() {
    if (!activeProduct) {
      err('请先扫描或选择商品')
      return
    }

    const normalizedBoxes = boxes
      .map((value, index) => ({ index, qty: parseQty(value) }))
      .filter(box => Number.isFinite(box.qty) && box.qty > 0)

    if (normalizedBoxes.length === 0) {
      err('请至少填写一箱数量')
      return
    }

    const invalidBox = normalizedBoxes.find(box => !Number.isFinite(box.qty) || box.qty <= 0)
    if (invalidBox) {
      err(`箱 ${invalidBox.index + 1} 数量无效`)
      return
    }

    const totalQty = normalizedBoxes.reduce((sum, box) => sum + box.qty, 0)
    if (totalQty > activeProduct.remainingQty) {
      err(`超出待收数量，当前最多还能收 ${activeProduct.remainingQty}`)
      return
    }
    if (totalQty < activeProduct.remainingQty) {
      warn(`当前只登记 ${totalQty}，提交后该商品还剩 ${activeProduct.remainingQty - totalQty}`)
    }

    setSubmitting(true)
    void receiveAction.run((requestKey) =>
      receiveInboundApi(task.id, {
        productId: activeProduct.productId,
        packages: normalizedBoxes.map(box => ({ qty: box.qty })),
      }, requestKey).then((res) => res.data.data!),
    ).then((result) => {
      if (result.kind === 'success') {
        if ((activeProduct.remainingQty - totalQty) > 0) {
          resetBoxes(1)
        } else {
          setSelectedProductId(null)
          resetBoxes(1)
        }
      } else {
        warn('网络中断，收货结果待确认。请先确认刚才那次是否成功，再决定是否重试。')
      }
    }).catch((error: unknown) => {
      const message = (error as { message?: string })?.message ?? '收货失败'
      err(message)
    }).finally(() => {
      setSubmitting(false)
    })
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <PdaHeader
        title={task.taskNo}
        subtitle={task.supplierName ?? undefined}
        backLabel="← 收货订单"
        onBack={() => navigate('/pda/inbound')}
        right={<span className="text-xs text-muted-foreground">收货</span>}
      />
      <PdaFlash flash={flash} />

      <div className="flex-1 overflow-y-auto px-4 py-4 max-w-md mx-auto w-full space-y-4">
        <PdaFlowPanel
          badge="收货执行中"
          title={`当前阶段：${closureCopy.stageLabel}`}
          description={closureCopy.description}
          nextAction={closureCopy.nextAction}
          stepText="先按商品逐箱登记并打印库存条码，再确认待上架数量是否正确；如果打印异常或数量不一致，先回打印查询或异常工作台，不要跳过上架直接收口。"
          actions={[
            { label: '返回收货列表', onClick: () => navigate('/pda/inbound') },
            { label: '打开入库补打', onClick: () => navigate(`/settings/barcode-print-query?category=inbound&inboundTaskId=${task.id}&status=failed`) },
            { label: '打开异常工作台', onClick: () => navigate('/reports/exception-workbench') },
          ]}
        />
        <PdaCriticalActionNotice
          blockedReason={receiveAction.blockedReason}
          pendingRecord={receiveAction.pendingRecord}
          confirming={receiveAction.confirming}
          phase={receiveAction.phase}
          phaseMessage={receiveAction.phaseMessage}
          lastErrorMessage={receiveAction.lastErrorMessage}
          onConfirm={() => {
            void receiveAction.confirmPending().then((status) => {
              if (!status) return
              if (status.status === 'pending') warn('服务端仍未确认结果，请稍后再查或刷新页面校验')
              if (status.status === 'not_found') warn('服务端未找到该次收货记录，请检查明细后再手动重试')
              if (status.status === 'failed') err(status.message || '上次收货未成功，请检查后重试')
            })
          }}
          onClear={() => receiveAction.clearPending()}
          onDismissError={() => receiveAction.clearError()}
        />
        <PdaCard>
          <div className="space-y-2 text-sm">
            <p className="text-muted-foreground">仓库：{task.warehouseName ?? '—'}</p>
            <p className="text-muted-foreground">关联采购：{task.purchaseOrderNo ?? '混合采购单'}</p>
            <p className="text-muted-foreground">收货状态：{task.receiptStatus?.label ?? task.statusName}</p>
            <p className="text-muted-foreground">打印 {task.printStatus?.label ?? '—'} · 上架 {task.putawayStatus?.label ?? '—'}</p>
            <p className="text-muted-foreground">当前阶段：{closureCopy.stageLabel}</p>
            <p className="text-muted-foreground">{closureCopy.nextAction}</p>
          </div>
        </PdaCard>

        <PdaCard>
          <div className="grid grid-cols-3 gap-3 text-center">
            <div>
              <p className="text-xs text-muted-foreground">已打印</p>
              <p className="mt-1 text-lg font-semibold text-foreground">{task.printSummary?.success ?? 0}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">待上架</p>
              <p className="mt-1 text-lg font-semibold text-foreground">{task.putawaySummary?.waitingContainers ?? 0}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">已上架</p>
              <p className="mt-1 text-lg font-semibold text-foreground">{task.putawaySummary?.storedContainers ?? 0}</p>
            </div>
          </div>
        </PdaCard>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-foreground">待收商品</p>
            <span className="text-xs text-muted-foreground">{selectableProducts.length} 个待收 SKU</span>
          </div>
          <div className="space-y-2">
            {products.map(product => (
              <ProductCard
                key={product.productId}
                product={product}
                active={product.productId === selectedProductId}
                onClick={() => {
                  if (product.remainingQty <= 0) {
                    warn(`${product.productName} 已收货完成`)
                    return
                  }
                  selectProduct(product.productId)
                }}
              />
            ))}
          </div>
        </div>

        {activeProduct ? (
          <ReceiveEditor
            product={activeProduct}
            boxes={boxes}
            submitting={submitting || receiveAction.submitBlocked}
            onChangeBox={(index, value) => {
              setBoxes(prev => prev.map((item, idx) => idx === index ? value : item))
            }}
            onAddBox={() => setBoxes(prev => [...prev, ''])}
            onRemoveBox={(index) => {
              setBoxes(prev => prev.filter((_, idx) => idx !== index))
            }}
            onReset={() => resetBoxes(1)}
            onSubmit={submitReceive}
          />
        ) : (
          <PdaCard>
            <p className="text-sm text-muted-foreground">扫描产品条码</p>
          </PdaCard>
        )}
      </div>

      <PdaBottomBar>
        <PdaScanner
          onScan={handleScan}
          placeholder="扫描产品条码"
          disabled={submitting || receiveAction.submitBlocked}
        />
      </PdaBottomBar>
    </div>
  )
}

export default function PdaReceivePage() {
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()
  const taskId = Number(id) || 0

  const { data: task, isLoading } = useQuery({
    queryKey: ['pda-inbound-task', taskId],
    queryFn: () => getInboundTaskByIdApi(taskId).then(r => r.data.data!),
    enabled: taskId > 0,
  })

  if (!taskId) {
    return (
      <div className="min-h-screen bg-background p-6 text-center text-muted-foreground">
        无效任务
        <button type="button" className="mt-4 block mx-auto text-primary" onClick={() => navigate('/pda/inbound')}>返回</button>
      </div>
    )
  }

  if (isLoading || !task) {
    return (
      <div className="min-h-screen bg-background">
        <PdaHeader title="收货" onBack={() => navigate('/pda/inbound')} />
        <PdaLoading className="h-40 mt-8" />
      </div>
    )
  }

  if (!task.submittedAt) {
    const copy = getInboundClosureCopy(task)
    return (
      <div className="min-h-screen bg-background p-6 text-center space-y-3">
        <p className="text-muted-foreground">{copy.description}</p>
        <p className="text-muted-foreground">{copy.nextAction}</p>
        <button type="button" className="text-primary font-medium" onClick={() => navigate('/pda/inbound')}>返回列表</button>
      </div>
    )
  }

  if (task.putawayStatus?.key === 'waiting' || task.putawayStatus?.key === 'putting_away' || task.status >= 3) {
    const copy = getInboundClosureCopy(task)
    return (
      <div className="min-h-screen bg-background p-6 text-center space-y-3">
        <p className="text-muted-foreground">{copy.description}</p>
        <p className="text-muted-foreground">{copy.nextAction}</p>
        <button type="button" className="text-primary font-medium" onClick={() => navigate('/pda/inbound')}>返回列表</button>
      </div>
    )
  }

  return <ReceiveRunner task={task} />
}
