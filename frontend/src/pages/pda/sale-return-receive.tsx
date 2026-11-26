import PdaProductIdentity from '@/components/pda/PdaProductIdentity'
import { useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import PdaHeader from '@/components/pda/PdaHeader'
import PdaCard from '@/components/pda/PdaCard'
import PdaBottomBar from '@/components/pda/PdaBottomBar'
import PdaScanner from '@/components/pda/PdaScanner'
import PdaCriticalActionNotice from '@/components/pda/PdaCriticalActionNotice'
import PdaFlash from '@/components/pda/PdaFlash'
import { PdaLoading, PdaQueryError } from '@/components/pda/PdaEmptyState'
import { usePdaFeedback } from '@/hooks/usePdaFeedback'
import { useCriticalPdaAction } from '@/hooks/useCriticalPdaAction'
import { getReturnTaskByIdApi, receiveReturnApi, checkReturnApi, type ReturnTaskActionResult, type ReturnTaskItem } from '@/api/returns'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { parseBarcode } from '@/utils/barcode'
import { useProductQtyPolicies } from '@/hooks/useProductQtyPolicies'
import { qtyStep, roundQuantity } from '@/lib/qtyStep'

export default function PdaSaleReturnReceivePage() {
  const { id } = useParams<{ id: string }>()
  return <SaleReturnReceive key={id} taskId={Number(id)} />
}

function SaleReturnReceive({ taskId }: { taskId: number }) {
  const nav = useNavigate()
  const { flash, ok, err } = usePdaFeedback()
  const [productId, setProductId] = useState<number | null>(null)
  // 「只能整数」的商品把收货/质检数量框的 step 切成 1（迁移 254）
  const allowDecimalOf = useProductQtyPolicies([productId])
  const [boxes, setBoxes] = useState<number[]>([0])
  const [rejectedQty, setRejectedQty] = useState(0)
  const [draftPhase, setDraftPhase] = useState<'qty' | 'check' | null>(null)
  const [labelReceipt, setLabelReceipt] = useState<Partial<ReturnTaskActionResult> | null>(null)

  const { data: task, isLoading, isError, refetch } = useQuery({
    queryKey: ['pda-return-task', taskId],
    queryFn: () => getReturnTaskByIdApi(taskId),
    enabled: !!taskId,
    refetchInterval: 10_000,
  })

  const groupedItems = (task?.items || []).reduce((acc, item) => {
    const key = item.productId
    if (!acc[key]) acc[key] = { ...item, totalExpected: 0, totalReceived: 0, totalChecked: 0 }
    acc[key].totalExpected = roundQuantity(acc[key].totalExpected + item.expectedQty)
    acc[key].totalReceived = roundQuantity(acc[key].totalReceived + item.receivedQty)
    acc[key].totalChecked = roundQuantity(acc[key].totalChecked + item.checkedQty)
    return acc
  }, {} as Record<number, ReturnTaskItem & { totalExpected: number; totalReceived: number; totalChecked: number }>)

  const productList = Object.values(groupedItems)

  const selectedProduct = productId == null ? undefined : groupedItems[productId]
  const taskPhase = task?.status === 1 || task?.status === 2 ? 'qty' : task?.status === 3 ? 'check' : null
  const step = taskPhase && taskPhase === draftPhase && selectedProduct ? taskPhase : 'select'
  const remaining = selectedProduct ? roundQuantity(selectedProduct.totalExpected - selectedProduct.totalReceived) : 0
  const onConfirmed = useCallback((receipt: Partial<ReturnTaskActionResult>) => {
    setLabelReceipt(receipt)
    void refetch()
    setProductId(null)
    setBoxes([0])
    setRejectedQty(0)
    setDraftPhase(null)
  }, [refetch])
  const receiveAction = useCriticalPdaAction<Partial<ReturnTaskActionResult>>({
    action: `return.receive.${taskId}`,
    requestAction: 'return.receive',
    label: `退货收货 ${task?.taskNo || ''}`,
    onConfirmed,
  })

  const checkAction = useCriticalPdaAction<Partial<ReturnTaskActionResult>>({
    action: `return.check.${taskId}`,
    requestAction: 'return.check',
    label: `退货质检 ${task?.taskNo || ''}`,
    onConfirmed,
  })

  const actions = [receiveAction, checkAction]
  const locked = actions.some(action => action.submitBlocked || action.phase !== 'idle')
  const selectProduct = useCallback((id: number) => {
    if (locked || !taskPhase) return
    setProductId(id)
    setBoxes([0])
    setRejectedQty(0)
    setDraftPhase(taskPhase)
  }, [locked, taskPhase])
  const handleScan = useCallback((raw: string) => {
    const trimmed = raw.trim()
    if (!trimmed || locked || !taskPhase) return
    const parsed = parseBarcode(trimmed)
    // 现场标签上印的通常是商品编码（SKU0001），而 ERP 早已不再维护商品条码
    //（见 docs/pda-receive-remove-scan-2026-09-14.md）。此前这里只接受 P<id>/PRD<id>，
    // 扫商品编码一律被拒，退货收货在真机上根本用不了（2026-09-17 续测发现）。
    // 现在：商品编码、P<id>/PRD<id> 商品条码、纯数字 ID 都尝试匹配当前退货任务明细。
    const product =
      productList.find(p => p.productCode === trimmed)
      || productList.find(p => parsed?.type === 'product' && p.productId === Number(parsed.id))
      || (/^\d+$/.test(trimmed) ? productList.find(p => p.productId === Number(trimmed)) : undefined)
    if (!product) {
      err('这件货不在本退货单，请核对条码或点选商品')
      return
    }
    ok(`${product.productName} ${product.productCode}`)
    selectProduct(product.productId)
  }, [productList, err, ok, locked, selectProduct, taskPhase])

  const notices = actions.map((action, index) => {
    // 非当前阶段也可能有待核对的收货或质检记录。
    const currentPhase = index === 0 ? 'qty' : 'check'
    if (taskPhase !== currentPhase && !action.pendingRecord && !action.lastErrorMessage && action.phase === 'idle') return null
    return <PdaCriticalActionNotice key={index} {...action}
      onConfirm={() => void action.confirmPending()} onClear={action.clearPending} onDismissError={action.clearError} />
  })

  let statusContent
  if (isError) statusContent = <PdaQueryError onRetry={() => { void refetch() }} />
  else if (isLoading) statusContent = <PdaLoading />
  else if (!task) statusContent = <p>任务不存在</p>
  else if (!task.submittedAt) statusContent = <p>请先在 ERP 提交退货单</p>
  else if (!taskPhase) statusContent = <>
    <p>{task.status === 4 ? '质检完成，请贴好对应标签后进入上架' : '退货任务已结束'}</p>
    {task.status === 4 && <Button size="lg" className="px-3 w-full" disabled={actions.some(action => !!action.pendingRecord)} onClick={() => nav(`/pda/sale-return/${taskId}/putaway`)}>前往退货上架</Button>}
  </>
  if (statusContent || !task) return (
    <div className="flex min-h-screen flex-col bg-background">
      <PdaHeader title={task && task.status >= 3 ? '退货质检' : '退货收货'} onBack={() => nav('/pda/sale-return')} />
      <div className="mx-auto w-full max-w-md space-y-3 p-4">
        {notices}
        {statusContent}
        <ReturnLabelReceiptView receipt={labelReceipt} />
      </div>
    </div>
  )

  const totalQty = roundQuantity(boxes.reduce((sum, qty) => sum + qty, 0))

  const canReceive = boxes.every(qty => Number.isFinite(qty) && qty > 0) && totalQty <= remaining
  const canCheck = selectedProduct && boxes[0] >= 0 && rejectedQty >= 0 && boxes[0] + rejectedQty > 0 &&
    roundQuantity(boxes[0] + rejectedQty) <= roundQuantity(selectedProduct.totalReceived - selectedProduct.totalChecked)

  async function doReceive() {
    if (!selectedProduct || step !== 'qty' || locked || !canReceive) return
    const body = { productId: selectedProduct.productId, packages: boxes.map(qty => ({ qty })) }
    try {
      await receiveAction.run(
        (requestKey, config) => receiveReturnApi(taskId, body, requestKey, config),
        { taskId, productName: selectedProduct.productName, requestBody: body },
      )
    } catch (error) { err(error instanceof Error ? error.message : '退货收货失败，请重试') }
  }

  async function doCheck() {
    if (!selectedProduct || step !== 'check' || locked || !canCheck) return
    const body = { productId: selectedProduct.productId, passedQty: boxes[0], rejectedQty }
    try {
      await checkAction.run(
        (requestKey, config) => checkReturnApi(taskId, body, requestKey, config),
        { taskId, productName: selectedProduct.productName, requestBody: body },
      )
    } catch (error) { err(error instanceof Error ? error.message : '退货质检失败，请重试') }
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <PdaHeader title={task.status <= 2 ? '退货收货' : '退货质检'} subtitle={task.taskNo} onBack={() => nav('/pda/sale-return')} />
      <PdaFlash flash={flash} />

      <div className="flex-1 overflow-y-auto px-4 py-4 max-w-md mx-auto w-full space-y-3">
        <ReturnLabelReceiptView receipt={labelReceipt} />
        {notices}
        {/* 产品列表 */}
        {step === 'select' && productList.map(p => (
          <PdaCard key={p.productId} className="w-full" active={p.totalExpected > p.totalReceived} onClick={locked ? undefined : () => selectProduct(p.productId)}>
            <div className="flex justify-between items-center">
              <div className="min-w-0 flex-1 text-left">
                <PdaProductIdentity code={p.productCode} name={p.productName} view="overview" />
              </div>
              <div className="shrink-0 ml-2 text-right text-sm text-muted-foreground">
                应退 {p.totalExpected} / 已收 {p.totalReceived}
              </div>
            </div>
            {p.totalExpected > p.totalReceived && (
              <div className="mt-2 h-1.5 bg-muted rounded-full overflow-hidden">
                <div className="h-full bg-info/100 rounded-full" style={{ width: `${(p.totalReceived / p.totalExpected) * 100}%` }} />
              </div>
            )}
          </PdaCard>
        ))}

        {/* 数量录入 */}
        {step === 'qty' && selectedProduct && (
          <PdaCard>
            <div className="mb-3"><PdaProductIdentity code={selectedProduct.productCode} name={selectedProduct.productName} view="detail" /></div>
            <div className="text-sm text-muted-foreground mb-3">可收数量：{remaining} {selectedProduct.unit}</div>
            {boxes.map((qty, i) => (
              <div key={i} className="flex items-center gap-2 mb-2">
                <span className="text-sm w-10">箱{i + 1}</span>
                <Input aria-label={`箱${i + 1}数量`} data-scanner-manual="true" disabled={locked} quantity type="number" min={0} step={qtyStep(allowDecimalOf(productId))} value={qty || ''} className="min-h-11 text-lg"
                  onChange={e => {
                    const next = [...boxes]
                    next[i] = Number(e.target.value) || 0
                    setBoxes(next)
                  }}
                />
                {i === boxes.length - 1 && (
                  <Button className="px-3" variant="outline" size="lg" disabled={locked} aria-label="添加一箱" onClick={() => setBoxes([...boxes, 0])}>+</Button>
                )}
                {boxes.length > 1 && (
                  <Button className="px-3" variant="outline" size="lg" disabled={locked} aria-label={`删除箱${i + 1}`} onClick={() => setBoxes(boxes.filter((_, j) => j !== i))}>-</Button>
                )}
              </div>
            ))}
            <div className="text-right text-sm font-semibold mt-3">合计：{totalQty} {selectedProduct.unit}</div>
          </PdaCard>
        )}

        {/* 质检确认 */}
        {step === 'check' && selectedProduct && (
          <PdaCard>
            <div className="mb-3"><PdaProductIdentity code={selectedProduct.productCode} name={selectedProduct.productName} view="detail" /></div>
            <div className="text-sm text-muted-foreground mb-3">已收货：{selectedProduct.totalReceived} {selectedProduct.unit}</div>
            <div className="mb-3">
              <span className="text-sm">质检通过数量：</span>
              <Input aria-label="质检通过数量" data-scanner-manual="true" disabled={locked} quantity type="number" min={0} step={qtyStep(allowDecimalOf(productId))} value={boxes[0] || ''} className="min-h-11 text-lg mt-1"
                onChange={e => setBoxes([Number(e.target.value) || 0])}
              />
            </div>
            <div className="mb-1">
              <span className="text-sm text-destructive-ink">不合格数量：</span>
              <Input aria-label="不合格数量" data-scanner-manual="true" disabled={locked} quantity type="number" min={0} step={qtyStep(allowDecimalOf(productId))} value={rejectedQty || ''} className="min-h-11 text-lg mt-1"
                onChange={e => setRejectedQty(Number(e.target.value) || 0)}
              />
            </div>
          </PdaCard>
        )}
      </div>

      <PdaBottomBar>
        {step === 'select' && (
          <PdaScanner onScan={handleScan} disabled={locked} placeholder="扫描商品条码…" />
        )}
        {step === 'qty' && selectedProduct && totalQty > 0 && (
          <Button size="lg" className="px-3 w-full h-12 text-lg" disabled={locked || !canReceive}
            onClick={() => void doReceive()}
          >
            {`确认收货 ${totalQty} ${selectedProduct.unit}`}
          </Button>
        )}
        {step === 'check' && selectedProduct && (Number(boxes[0]) > 0 || rejectedQty > 0) && (
          <Button size="lg" className="px-3 w-full h-12 text-lg" disabled={locked || !canCheck}
            onClick={() => void doCheck()}
          >
            确认质检：合格 {Number(boxes[0]) || 0}{rejectedQty > 0 ? `，不合格 ${rejectedQty}` : ''} {selectedProduct.unit}
          </Button>
        )}
      </PdaBottomBar>

    </div>
  )
}

function ReturnLabelReceiptView({ receipt }: { receipt: Partial<ReturnTaskActionResult> | null }) {
  if (!receipt?.containers?.length) return null
  return (
    <section aria-label="退货条码标签" className="space-y-2 rounded-md border p-3 text-sm">
      <p className="font-medium">本次条码标签</p>
      <p className="text-muted-foreground">请按数量分开放置并贴上对应标签；质检拆分后应更换旧标签。</p>
      {/* 2026-09-14 起没有可用打印机也会留一条打印记录，退货容器同样会出现在「打印记录」页，
          现场先解决打印机，再从那里补打（系统内唯一补打入口）。 */}
      {(receipt.noPrinterCount || 0) > 0 ? (
        <p role="alert" className="text-destructive-ink">{receipt.noPrinterCount} 张标签未找到可用标签打印机，收货已记录并留有打印记录；请先配置标签打印机，再到「打印记录」页补打后再扫码上架。</p>
      ) : <p role="status" className="text-muted-foreground">{receipt.printJobIds?.length || 0} 张标签已加入打印队列，请确认出纸后贴标。</p>}
      <ul className="divide-y">
        {receipt.containers.map(container => (
          <li key={container.containerId} className="flex justify-between gap-3 py-2">
            <div><p className="font-mono">{container.barcode}</p><p className="text-muted-foreground">{container.status === 5 ? '待质检' : container.status === 4 ? '待上架' : '不合格'}</p></div>
            <span>数量 {container.qty}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
