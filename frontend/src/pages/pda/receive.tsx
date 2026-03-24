/**
 * PDA 收货扫描页
 * 路由：/pda/receive/:id
 */
import { useState, useRef, useEffect, useCallback } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getInboundTaskByIdApi, receiveInboundApi } from '@/api/inbound-tasks'
import type { InboundTaskItem } from '@/types/inbound-tasks'
import PdaHeader from '@/components/pda/PdaHeader'
import PdaCard from '@/components/pda/PdaCard'
import PdaBottomBar from '@/components/pda/PdaBottomBar'
import PdaScanner from '@/components/pda/PdaScanner'
import { PdaLoading } from '@/components/pda/PdaEmptyState'
import { parseBarcode } from '@/utils/barcode'

export default function PdaReceivePage() {
  const navigate = useNavigate()
  const { id } = useParams<{id:string}>()
  const taskId = Number(id) || 0
  const qc = useQueryClient()
  const inputRef  = useRef<HTMLInputElement>(null)
  const itemRefs  = useRef<Record<number, HTMLInputElement | null>>({})
  const [qtys, setQtys] = useState<Record<number,number>>({})
  const [activeItemId, setActiveItemId] = useState<number | null>(null)
  const [flash, setFlash] = useState<'ok'|'err'|null>(null)
  const [flashMsg, setFlashMsg] = useState('')
  const [submitted, setSubmitted] = useState(false)

  // ── 扫码识别商品，自动聚焦对应数量输入框 ────────────────────────────────
  const handleScan = useCallback((raw: string) => {
    const parsed = parseBarcode(raw)
    // 支持 PRD 商品码或直接 SKU 编码
    if (parsed.type !== 'product' && parsed.type !== 'unknown') {
      setFlashMsg('请扫描商品条码')
      setFlash('err')
      setTimeout(() => setFlash(null), 2000)
      return
    }
    const item = items.find(i =>
      i.productCode === raw ||
      i.productCode === raw.toUpperCase() ||
      `PRD${i.productCode}` === raw.toUpperCase()
    )
    if (!item) {
      setFlashMsg(`商品 ${raw} 不在此收货单中`)
      setFlash('err')
      setTimeout(() => setFlash(null), 2000)
      return
    }
    setActiveItemId(item.id)
    // 自动填入应收数量（若未填过）
    setQtys(prev => ({
      ...prev,
      [item.id]: prev[item.id] ?? item.orderedQty,
    }))
    setFlashMsg(`✓ 已定位：${item.productName}`)
    setFlash('ok')
    setTimeout(() => setFlash(null), 1500)
    // 聚焦该商品数量输入框
    setTimeout(() => itemRefs.current[item.id]?.focus(), 80)
  }, [items])

  const { data: task, isLoading } = useQuery({
    queryKey: ['pda-inbound-task', taskId],
    queryFn: () => getInboundTaskByIdApi(taskId).then(r => r.data.data!),
    enabled: taskId > 0,
  })

  const receiveMut = useMutation({
    mutationFn: () => receiveInboundApi(taskId, {
      items: (task?.items ?? []).map(i => ({ itemId: i.id, qty: qtys[i.id] ?? 0 }))
    }),
    onSuccess: () => {
      setFlashMsg('收货完成！'); setFlash('ok'); setSubmitted(true)
      qc.invalidateQueries({ queryKey: ['pda-inbound-tasks'] })
      setTimeout(() => navigate('/pda/inbound'), 1500)
    },
    onError: (e:unknown) => {
      setFlashMsg((e as {response?:{data?:{message?:string}}})?.response?.data?.message ?? '操作失败')
      setFlash('err')
    },
  })

  useEffect(() => { inputRef.current?.focus() }, [task])

  const items: InboundTaskItem[] = task?.items ?? []
  const canSubmit = items.length > 0 && items.some(i => (qtys[i.id] ?? 0) > 0)

  if (submitted) return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background text-center px-6">
      <div className="text-6xl mb-6">✅</div>
      <h2 className="text-2xl font-bold text-foreground">收货完成</h2>
      <p className="text-muted-foreground mt-2">正在返回收货列表…</p>
    </div>
  )

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <PdaHeader
        title={task?.taskNo ?? '…'}
        subtitle={task?.supplierName}
        backLabel="← 收货列表"
        onBack={() => navigate('/pda/inbound')}
        right={<span className="text-xs text-muted-foreground">收货</span>}
      />

      {flash && <div className={`mx-4 mt-3 rounded-xl py-2.5 text-center text-sm font-semibold ${flash==='ok'?'bg-green-100 text-green-800 border border-green-200':'bg-red-100 text-red-800 border border-red-200'}`}>{flashMsg}</div>}

      <div className="flex-1 px-4 py-4 space-y-3 pb-40">
        {isLoading && <PdaLoading className="h-32" />}
        {items.map(item => (
          <PdaCard key={item.id} done={(qtys[item.id] ?? 0) >= item.orderedQty}
            className={activeItemId === item.id ? 'ring-2 ring-primary' : ''}>
            <div className="flex justify-between items-start mb-3">
              <div><p className="font-semibold text-foreground">{item.productName}</p><p className="text-xs text-muted-foreground font-mono">{item.productCode}</p></div>
              <span className="text-xs text-muted-foreground">需收 {item.orderedQty} {item.unit}</span>
            </div>
            <div className="flex items-center gap-3">
              <label className="text-sm text-muted-foreground shrink-0">实收数量</label>
              <input
                ref={el => { itemRefs.current[item.id] = el }}
                type="number" min={0} max={item.orderedQty} step="0.01"
                value={qtys[item.id] ?? ''}
                onChange={e => setQtys(p => ({ ...p, [item.id]: Number(e.target.value) }))}
                onFocus={() => setActiveItemId(item.id)}
                className={`flex-1 rounded-xl border px-3 py-2 text-right text-foreground text-base outline-none transition-colors ${
                  activeItemId === item.id
                    ? 'border-primary bg-background focus:ring-1 focus:ring-primary'
                    : 'border-input bg-background'
                }`}
                placeholder={String(item.orderedQty)}
              />
              <span className="text-sm text-muted-foreground shrink-0">{item.unit}</span>
            </div>
          </PdaCard>
        ))}
      </div>

      <PdaBottomBar>
        <PdaScanner onScan={handleScan} placeholder="扫描商品条码定位" disabled={receiveMut.isPending || submitted} />
        <button onClick={() => receiveMut.mutate()} disabled={!canSubmit || receiveMut.isPending}
          className="w-full rounded-2xl py-4 text-base font-bold bg-primary hover:bg-primary/90 text-primary-foreground disabled:opacity-40 active:scale-95 transition-all"
        >{receiveMut.isPending ? '提交中…' : '确认收货'}</button>
      </PdaBottomBar>
    </div>
  )
}
