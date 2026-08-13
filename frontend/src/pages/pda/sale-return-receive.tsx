import { useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import PdaHeader from '@/components/pda/PdaHeader'
import PdaCard from '@/components/pda/PdaCard'
import PdaBottomBar from '@/components/pda/PdaBottomBar'
import PdaScanner from '@/components/pda/PdaScanner'
import PdaFlash from '@/components/pda/PdaFlash'
import { PdaLoading } from '@/components/pda/PdaEmptyState'
import { usePdaFeedback } from '@/hooks/usePdaFeedback'
import { useCriticalPdaAction } from '@/hooks/useCriticalPdaAction'
import { getReturnTaskByIdApi, receiveReturnApi, checkReturnApi } from '@/api/returns'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { parseBarcode } from '@/utils/barcode'

export default function PdaSaleReturnReceivePage() {
  const { id } = useParams<{ id: string }>()
  const taskId = Number(id)
  const nav = useNavigate()
  const { flash, ok, err } = usePdaFeedback()
  const [selectedProduct, setSelectedProduct] = useState<{ id: number; code: string; name: string; unit: string; remaining: number } | null>(null)
  const [boxes, setBoxes] = useState<number[]>([0])
  const [rejectedQty, setRejectedQty] = useState(0)
  const [step, setStep] = useState<'select' | 'qty' | 'check'>('select')

  const { data: task, isLoading } = useQuery({
    queryKey: ['pda-return-task', taskId],
    queryFn: () => getReturnTaskByIdApi(taskId),
    enabled: !!taskId,
    refetchInterval: 10_000,
  })

  const groupedItems = (task?.items || []).reduce((acc, item) => {
    const key = item.productId
    if (!acc[key]) acc[key] = { ...item, totalExpected: 0, totalReceived: 0, totalChecked: 0 }
    acc[key].totalExpected += item.expectedQty
    acc[key].totalReceived += item.receivedQty
    acc[key].totalChecked += item.checkedQty
    return acc
  }, {} as Record<number, ReturnTaskItem & { totalExpected: number; totalReceived: number; totalChecked: number }>)

  const productList = Object.values(groupedItems)

  /**
   * 断网兜底：提交发出去了但没收到响应时，回来查这个商品的实收/质检量有没有涨到
   * 「提交前 + 本次」的水平，据此判断上一次到底成没成，而不是让员工凭感觉决定要不要重扫。
   *
   * 判定刻意保守：只有**明确达到**期望值才算成功，差一点都返回 effective:false 保持待确认。
   * 宁可让人多确认一次，也不能把「其实没成」说成成功——退货收货没有天然幂等，
   * 重复提交会真的再生成一批容器、把货重复收进库存。
   */
  const resolveByQty = (field: 'totalReceived' | 'totalChecked', label: string) =>
    async ({ record }: { record: { metadata?: Record<string, unknown> } }) => {
      const productId = Number(record.metadata?.productId ?? 0)
      const expected = Number(record.metadata?.expectedQty ?? NaN)
      if (!productId || !Number.isFinite(expected)) return { effective: false as const }
      const latest = await getReturnTaskByIdApi(taskId)
      const rows = (latest?.items || []).filter(item => item.productId === productId)
      if (!rows.length) return { effective: false as const }
      const actual = rows.reduce((sum, item) => sum + Number(field === 'totalReceived' ? item.receivedQty : item.checkedQty), 0)
      if (actual < expected) return { effective: false as const }
      return {
        effective: true as const,
        data: {},
        message: `${label}已成功，该商品累计 ${actual}。`,
      }
    }

  const receiveAction = useCriticalPdaAction({
    action: `return.receive.${taskId}`,
    label: `退货收货 ${task?.taskNo || ''}`,
    onConfirmed: () => {
      setSelectedProduct(null)
      setBoxes([0])
      setStep('select')
    },
    resolveServerState: resolveByQty('totalReceived', '退货收货'),
  })

  const checkAction = useCriticalPdaAction({
    action: `return.check.${taskId}`,
    label: `退货质检 ${task?.taskNo || ''}`,
    onConfirmed: () => {
      setSelectedProduct(null)
      setRejectedQty(0)
      setStep('select')
    },
    resolveServerState: resolveByQty('totalChecked', '退货质检'),
  })

  const handleScan = useCallback((raw: string) => {
    const parsed = parseBarcode(raw.trim())
    if (parsed?.type !== 'product') {
      err('请扫描商品条码')
      return
    }
    const product = productList.find(p => p.productCode === parsed.code || p.productId === Number(parsed.code))
    if (!product) {
      err('该产品不在当前退货任务中')
      return
    }
    ok(`${product.productName} ${product.productCode}`)
    setSelectedProduct({
      id: product.productId,
      code: product.productCode,
      name: product.productName,
      unit: product.unit,
      remaining: product.totalExpected - product.totalReceived,
    })
    setBoxes([0])
    setRejectedQty(0)
    setStep(task?.status === 3 ? 'check' : 'qty')
  }, [productList, err, ok, task?.status])

  // Guard states
  if (isLoading) return <div className="flex min-h-screen flex-col bg-background"><PdaHeader title="退货收货" onBack={() => nav('/pda/sale-return')} /><PdaLoading /></div>
  if (!task) return <div className="flex min-h-screen flex-col bg-background"><PdaHeader title="退货收货" onBack={() => nav('/pda/sale-return')} /><div className="p-4 text-center text-muted-foreground">任务不存在</div></div>
  if (!task.submittedAt) return <div className="flex min-h-screen flex-col bg-background"><PdaHeader title="退货收货" onBack={() => nav('/pda/sale-return')} /><div className="p-4 text-center text-muted-foreground">请先在 ERP 端提交到 PDA</div></div>
  if (task.status >= 4) {
    return <div className="flex min-h-screen flex-col bg-background"><PdaHeader title="退货收货" onBack={() => nav(`/pda/sale-return/${taskId}/putaway`)} /><div className="p-4 text-center text-muted-foreground">已进入上架阶段</div></div>
  }

  const totalQty = boxes.reduce((s, v) => s + (Number(v) || 0), 0)

  // 提交退货收货
  function doReceive() {
    if (!selectedProduct) return
    receiveAction.run(
      requestKey =>
        receiveReturnApi(taskId, { productId: selectedProduct.id, packages: [{ qty: totalQty }] }, requestKey).then(r => r!),
      {
        productId: selectedProduct.id,
        expectedQty: (productList.find(p => p.productId === selectedProduct.id)?.totalReceived ?? 0) + totalQty,
      },
    )
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <PdaHeader title={task.status <= 2 ? '退货收货' : '退货质检'} subtitle={task.taskNo} onBack={() => nav('/pda/sale-return')} />
      <PdaFlash flash={flash} />

      <div className="flex-1 overflow-y-auto px-4 py-4 max-w-md mx-auto w-full space-y-3">
        {/* 产品列表 */}
        {step === 'select' && productList.map(p => (
          <PdaCard key={p.productId} className="w-full" active={p.totalExpected > p.totalReceived} onClick={() => {
            setSelectedProduct({ id: p.productId, code: p.productCode, name: p.productName, unit: p.unit, remaining: p.totalExpected - p.totalReceived })
            setBoxes([0])
            setRejectedQty(0)
            setStep(task.status === 3 ? 'check' : 'qty')
          }}>
            <div className="flex justify-between items-center">
              <div>
                <div className="font-semibold">{p.productName}</div>
                <div className="text-sm text-muted-foreground font-mono">{p.productCode}</div>
              </div>
              <div className="text-right text-sm text-muted-foreground">
                应退 {p.totalExpected} / 已收 {p.totalReceived}
              </div>
            </div>
            {p.totalExpected > p.totalReceived && (
              <div className="mt-2 h-1.5 bg-muted rounded-full overflow-hidden">
                <div className="h-full bg-blue-500 rounded-full" style={{ width: `${(p.totalReceived / p.totalExpected) * 100}%` }} />
              </div>
            )}
          </PdaCard>
        ))}

        {/* 数量录入 */}
        {step === 'qty' && selectedProduct && (
          <PdaCard>
            <div className="font-semibold mb-3">{selectedProduct.name} ({selectedProduct.code})</div>
            <div className="text-sm text-muted-foreground mb-3">可收数量：{selectedProduct.remaining} {selectedProduct.unit}</div>
            {boxes.map((qty, i) => (
              <div key={i} className="flex items-center gap-2 mb-2">
                <span className="text-sm w-10">箱{i + 1}</span>
                <Input type="number" min={0} step={0.01} value={qty || ''} className="h-10 text-lg"
                  onChange={e => {
                    const next = [...boxes]
                    next[i] = Number(e.target.value) || 0
                    setBoxes(next)
                  }}
                />
                {i === boxes.length - 1 ? (
                  <Button variant="outline" size="sm" onClick={() => setBoxes([...boxes, 0])}>+</Button>
                ) : (
                  <Button variant="outline" size="sm" onClick={() => setBoxes(boxes.filter((_, j) => j !== i))}>-</Button>
                )}
              </div>
            ))}
            <div className="text-right text-sm font-semibold mt-3">合计：{totalQty} {selectedProduct.unit}</div>
          </PdaCard>
        )}

        {/* 质检确认 */}
        {step === 'check' && selectedProduct && (
          <PdaCard>
            <div className="font-semibold mb-3">{selectedProduct.name} ({selectedProduct.code})</div>
            <div className="text-sm text-muted-foreground mb-3">已收货：{selectedProduct.remaining + (task?.items?.reduce((s, i) => i.productId === selectedProduct.id ? s + i.receivedQty : s, 0) || 0)} {selectedProduct.unit}</div>
            <div className="mb-3">
              <span className="text-sm">质检通过数量：</span>
              <Input type="number" min={0} step={0.01} value={boxes[0] || ''} className="h-10 text-lg mt-1"
                onChange={e => setBoxes([Number(e.target.value) || 0])}
              />
            </div>
            <div className="mb-1">
              <span className="text-sm text-destructive">不合格数量：</span>
              <Input type="number" min={0} step={0.01} value={rejectedQty || ''} className="h-10 text-lg mt-1"
                onChange={e => setRejectedQty(Number(e.target.value) || 0)}
              />
            </div>
          </PdaCard>
        )}
      </div>

      <PdaBottomBar>
        {step === 'select' && (
          <PdaScanner onScan={handleScan} placeholder="扫描商品条码…" />
        )}
        {step === 'qty' && selectedProduct && totalQty > 0 && (
          <Button className="w-full h-12 text-lg" disabled={receiveAction.phase !== 'idle'}
            onClick={() => doReceive()}
          >
            {`确认收货 ${totalQty} ${selectedProduct.unit}`}
          </Button>
        )}
        {step === 'check' && selectedProduct && (Number(boxes[0]) > 0 || rejectedQty > 0) && (
          <Button className="w-full h-12 text-lg" disabled={checkAction.phase !== 'idle'}
            onClick={() => checkAction.run(
              requestKey =>
                checkReturnApi(taskId, { productId: selectedProduct.id, passedQty: Number(boxes[0]) || 0, rejectedQty }, requestKey).then(r => r!),
              {
                productId: selectedProduct.id,
                expectedQty: (productList.find(p => p.productId === selectedProduct.id)?.totalChecked ?? 0)
                  + (Number(boxes[0]) || 0) + rejectedQty,
              },
            )}
          >
            确认质检：合格 {Number(boxes[0]) || 0}{rejectedQty > 0 ? `，不合格 ${rejectedQty}` : ''} {selectedProduct.unit}
          </Button>
        )}
      </PdaBottomBar>

    </div>
  )
}

// Helper type
interface ReturnTaskItem {
  id: number; productId: number; productCode: string; productName: string; unit: string
  expectedQty: number; receivedQty: number; checkedQty: number; rejectedQty: number; putawayQty: number
}
