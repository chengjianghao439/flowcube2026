/**
 * PDA 扫码执行页 — 商品视角拣货
 * 路由：/pda/task/:id  (独立全屏，不走 AppLayout)
 */
import { useState, useRef, useEffect, useCallback } from 'react'
import { parseBarcode } from '@/utils/barcode'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  getTaskByIdApi, getPickSuggestionsApi,
  readyToShipApi, cancelTaskApi,
} from '@/api/warehouse-tasks'
import type { PickSuggestionItem, PickSuggestionContainer } from '@/api/warehouse-tasks'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import PdaHeader from '@/components/pda/PdaHeader'
import PdaCard from '@/components/pda/PdaCard'
import PdaBottomBar from '@/components/pda/PdaBottomBar'
import PdaFlash from '@/components/pda/PdaFlash'
import { PdaLoading } from '@/components/pda/PdaEmptyState'
import PdaStepHint from '@/components/pda/PdaStepHint'
import PdaFlowPanel from '@/components/pda/PdaFlowPanel'
import client from '@/api/client'
import { useOfflineScan } from '@/hooks/useOfflineScan'
import { usePdaFeedback } from '@/hooks/usePdaFeedback'
import { useCriticalPdaAction } from '@/hooks/useCriticalPdaAction'
import PdaCriticalActionNotice from '@/components/pda/PdaCriticalActionNotice'

// ─── 子组件：商品拣货卡片 ──────────────────────────────────────────────────────
function SuggestionRow({ c, onTap, disabled }: {
  c: PickSuggestionContainer; onTap: () => void; disabled: boolean
}) {
  const kindLabel = c.containerKind === 'plastic_box' ? '塑料盒' : '库存'
  return (
    <button onClick={onTap} disabled={disabled||c.locked}
      className={`mt-1.5 flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-sm transition-all active:scale-95
        ${c.locked ? 'border-border bg-muted opacity-50' : 'border-primary/20 bg-primary/5 hover:bg-primary/10'}`}
    >
      <div>
        <p className="font-medium text-foreground"><span className="mr-1 text-muted-foreground">📍</span>{c.locationCode||'无库位'}</p>
        <div className="mt-0.5 flex items-center gap-2">
          <p className="font-mono text-xs text-muted-foreground">{c.barcode}</p>
          <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${c.containerKind === 'plastic_box' ? 'bg-orange-100 text-orange-700' : 'bg-slate-100 text-slate-700'}`}>{kindLabel}</span>
        </div>
      </div>
      <div className="text-right">
        <p className="text-sm font-bold text-primary">{c.remainingQty}</p>
        {c.locked && <p className="text-xs text-yellow-600">锁定</p>}
      </div>
    </button>
  )
}

function ProductCard({ item, onScan, scanning }: {
  item: PickSuggestionItem
  onScan: (barcode: string, container: PickSuggestionContainer) => void
  scanning: boolean
}) {
  const done = item.remaining <= 0
  const pct  = item.requiredQty > 0 ? Math.min(100, Math.round(item.pickedQty / item.requiredQty * 100)) : 0
  const [open, setOpen] = useState(!done)

  return (
    <PdaCard done={done}>
      <div className="space-y-2">
        <div className="flex items-start justify-between">
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-foreground truncate">{item.productName}</p>
            <p className="text-xs font-mono text-muted-foreground">{item.productCode}</p>
          </div>
          {done
            ? <Badge className="bg-green-100 text-green-700 border-green-200 shrink-0 ml-2">✓ 完成</Badge>
            : <Badge variant="default" className="shrink-0 ml-2">剩余 {item.remaining} {item.unit}</Badge>}
        </div>
        <div>
          <div className="flex justify-between text-xs text-muted-foreground mb-1">
            <span>已拣 {item.pickedQty.toFixed(0)}</span><span>共需 {item.requiredQty.toFixed(0)}</span>
          </div>
          <div className="h-1.5 rounded-full bg-muted">
            <div className="h-1.5 rounded-full transition-all"
              style={{width:`${pct}%`,background:done?'hsl(var(--success))':'hsl(var(--primary))'}} />
          </div>
        </div>
        {!done && <button onClick={()=>setOpen(o=>!o)} className="text-xs text-muted-foreground hover:text-foreground">{open?'▲ 收起推荐':'▼ 查看推荐库位'}</button>}
        {open && !done && (
          item.suggestions.length===0
            ? <p className="text-xs text-muted-foreground">暂无推荐库存单元，请直接扫码</p>
            : item.suggestions.map(c => (
                <SuggestionRow key={c.containerId} c={c} disabled={scanning} onTap={()=>onScan(c.barcode,c)} />
              ))
        )}
      </div>
    </PdaCard>
  )
}

// ─── 主组件 ──────────────────────────────────────────────────────────────────
export default function PdaTaskPage() {
  const navigate  = useNavigate()
  const { id }    = useParams<{ id: string }>()
  const taskId    = Number(id) || 0
  const qc        = useQueryClient()
  const { submitScan, logError } = useOfflineScan()

  const inputRef  = useRef<HTMLInputElement>(null)
  const [inputVal, setInputVal]   = useState('')
  const { flash, ok, err }        = usePdaFeedback()
  const [scanning, setScanning]   = useState(false)
  const [finished, setFinished] = useState<'completed'|null>(null)
  const pickAction = useCriticalPdaAction<void>({
    action: `warehouse.pick-scan.${taskId}`,
    label: `拣货任务 ${taskId}`,
    onConfirmed: async () => {
      await qc.invalidateQueries({ queryKey: ['pda-task', taskId] })
    },
  })
  const readyAction = useCriticalPdaAction<{ taskId: number }>({
    action: `warehouse.ready.${taskId}`,
    label: `拣货任务 ${taskId} 收口`,
    onConfirmed: async () => {
      setFinished('completed')
      await qc.invalidateQueries({ queryKey: ['pda-task', taskId] })
      await qc.invalidateQueries({ queryKey: ['pda-suggestions', taskId] })
    },
  })
  const taskNoticeAction =
    pickAction.pendingRecord ? pickAction
      : readyAction.pendingRecord ? readyAction
        : pickAction.phase !== 'idle' || pickAction.lastErrorMessage ? pickAction
          : readyAction.phase !== 'idle' || readyAction.lastErrorMessage ? readyAction
            : null

  // ── Queries ───────────────────────────────────────────────────────────
  const { data: task, isLoading } = useQuery({
    queryKey: ['pda-task', taskId],
    queryFn:  () => getTaskByIdApi(taskId),
    enabled:  taskId > 0, refetchOnWindowFocus: false,
  })

  const { data: sugData, refetch: refetchSug } = useQuery({
    queryKey: ['pda-suggestions', taskId],
    queryFn:  () => getPickSuggestionsApi(taskId),
    enabled:  taskId > 0 && task?.status === 2,
    refetchOnWindowFocus: false,
  })

  // ── Mutations ─────────────────────────────────────────────────────────
  // ── Focus ─────────────────────────────────────────────────────────────
  const focusInput = useCallback(() => {
    if (!finished) inputRef.current?.focus()
  }, [finished])
  useEffect(() => { focusInput() }, [focusInput, sugData])

  // ── Flash helpers ─────────────────────────────────────────────────────
  // (由 usePdaFeedback 提供，下方旧定义已移除)

  // ── 防重复扫码：同一条码 1 秒内不重复处理 ─────────────────────────────────
  const lastScanRef = useRef<{ barcode: string; time: number } | null>(null)

  // ── Scan handler ─────────────────────────────────────────────────────
  async function handleScan(barcode: string, hint?: { containerId: number; locationCode: string|null; remainingQty: number }) {
    const b = barcode.trim()
    if (!b || !task?.items?.length) return
    if (parseBarcode(b).type !== 'container') {
      err(`条码格式无效：${b}`)
      logError({ taskId, barcode: b, reason: `条码格式无效：${b}` })
      setInputVal('')
      return
    }

    // ── 防重复扫码：同一条码 1 秒内不重复 ──────────────────────────────────
    const now = Date.now()
    if (lastScanRef.current?.barcode === b && now - lastScanRef.current.time < 1000) {
      err('重复扫码，请稍候'); return
    }
    lastScanRef.current = { barcode: b, time: now }

    setScanning(true)
    try {
      // 从推荐数据里找 item
      const items = sugData?.items ?? []
      const match = items.find(i => i.suggestions.some(s => s.barcode === b))
      const container = match?.suggestions.find(s => s.barcode === b)
      if (!match || !container) {
        // 容器不在推荐里，尝试直接查
        const res = await client.get<{data:{containerId:number;productId:number;productCode:string;productName:string;remainingQty:number;locationCode:string|null;unit:string}}>(`/inventory/containers/barcode/${b}`)
        const c = res
        const item = task.items.find(i => i.productId === c.productId)
        if (!item) { err('该商品不属于当前任务'); return }
        if (item.pickedQty >= item.requiredQty) { err('该商品已全部拣完'); return }
        const addQty = Math.min(c.remainingQty || 1, item.requiredQty - item.pickedQty)
        const scanResult = await pickAction.run((requestKey) =>
          submitScan({ taskId, itemId: item.id, containerId: c.containerId, barcode: b, productId: c.productId, qty: addQty, scanMode: addQty > 1 ? '整件' : '散件', locationCode: c.locationCode ?? undefined }, requestKey),
        )
        if (scanResult.kind === 'pending') {
          warn('网络中断，拣货扫码结果待确认。请先确认结果，避免重复扫描。')
          return
        }
        await qc.invalidateQueries({ queryKey: ['pda-task', taskId] })
      } else {
        if (match.remaining <= 0) { err('该商品已全部拣完'); return }
        const addQty = Math.min(container.remainingQty || 1, match.remaining)
        const scanResult = await pickAction.run((requestKey) =>
          submitScan({ taskId, itemId: match.id, containerId: container.containerId, barcode: b, productId: match.productId, qty: addQty, scanMode: addQty > 1 ? '整件' : '散件', locationCode: container.locationCode ?? undefined }, requestKey),
        )
        if (scanResult.kind === 'pending') {
          warn('网络中断，拣货扫码结果待确认。请先确认结果，避免重复扫描。')
          return
        }
        await qc.invalidateQueries({ queryKey: ['pda-task', taskId] })
      }
      ok('✓ 扫描成功')
      // 用 refetch 返回的最新数据判断是否全部完成
      const refetchResult = await refetchSug()
      if (refetchResult.status === 'success') {
        const fresh = refetchResult.data?.items ?? []
        if (fresh.length > 0 && fresh.every(i => i.remaining <= 0)) {
          const readyResult = await readyAction.run((requestKey) =>
            readyToShipApi(taskId, requestKey).then(() => ({ taskId })),
          )
          if (readyResult.kind === 'pending') {
            warn('网络中断，任务收口结果待确认。请先确认是否已进入待分拣。')
            return
          }
        }
      }
    } catch (e: unknown) {
      const msg = (e as {response?:{data?:{message?:string}}})?.response?.data?.message ?? '扫码失败，请重试'
      err(msg)
      logError({ taskId, barcode: b, reason: msg })
    } finally { setScanning(false); setInputVal(''); setTimeout(focusInput, 80) }
  }

  const items: PickSuggestionItem[] = sugData?.items ?? []
  const totalReq  = items.reduce((s,i) => s + i.requiredQty, 0)
  const totalPick = items.reduce((s,i) => s + i.pickedQty,   0)
  const pct       = totalReq > 0 ? Math.min(100, Math.round(totalPick / totalReq * 100)) : 0

  if (finished) return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-6 text-center">
      <div className="text-6xl mb-6">✅</div>
      <h2 className="text-2xl font-semibold text-foreground mb-2">拣货完成！</h2>
      <p className="text-muted-foreground mb-8">任务已进入「待分拣」</p>
      <Button size="lg" onClick={() => navigate('/pda/picking')}>返回任务列表</Button>
    </div>
  )

  return (
    <div className="flex min-h-screen flex-col bg-background" onClick={focusInput}>
      <PdaHeader
        title={task?.taskNo ?? '…'}
        subtitle={task?.customerName}
        backLabel="← 拣货列表"
        onBack={() => navigate('/pda/picking')}
        progress={{ current: totalPick, total: totalReq, label: '拣货进度' }}
      />

      {/* Flash */}
      <PdaFlash flash={flash} />

      {/* Product list */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-md mx-auto px-4 py-4 space-y-3">
          <PdaCriticalActionNotice
            blockedReason={taskNoticeAction?.blockedReason ?? null}
            pendingRecord={taskNoticeAction?.pendingRecord}
            confirming={taskNoticeAction?.confirming}
            phase={taskNoticeAction?.phase}
            phaseMessage={taskNoticeAction?.phaseMessage}
            lastErrorMessage={taskNoticeAction?.lastErrorMessage}
            onConfirm={() => {
              const handler = pickAction.pendingRecord ? pickAction : readyAction.pendingRecord ? readyAction : taskNoticeAction
              if (!handler) return
              void handler.confirmPending().then((status) => {
                if (!status) return
                if (status.status === 'pending') err('服务端仍未确认结果，请稍后再查')
                if (status.status === 'not_found') warn('未找到上次提交记录，请先刷新任务后再重试')
                if (status.status === 'failed') err(status.message || '上次操作未成功，请检查后重试')
              })
            }}
            onClear={() => {
              if (pickAction.pendingRecord) pickAction.clearPending()
              if (readyAction.pendingRecord) readyAction.clearPending()
            }}
            onDismissError={() => {
              pickAction.clearError()
              readyAction.clearError()
            }}
          />
          <PdaFlowPanel
            badge="拣货执行中"
            title={task ? `当前任务：${task.taskNo}` : '当前任务拣货执行'}
            description="这里优先把每个商品的已拣数量追平需求数量。推荐库位扫完后，再确认是否全部完成并推进到待分拣。"
            nextAction={finished ? '返回拣货列表' : '继续扫描库存条码'}
            stepText="先扫推荐库存条码完成拣货；若推荐库位不足或条码不匹配，先核对库存与异常，再继续执行。"
            actions={[
              { label: '打开拣货列表', onClick: () => navigate('/pda/picking') },
              { label: '打开仓库任务', onClick: () => navigate('/warehouse-tasks') },
              { label: '打开异常工作台', onClick: () => navigate('/reports/exception-workbench') },
            ]}
          />
          {isLoading && <PdaLoading className="h-32" />}
          {items.map(item => (
            <ProductCard key={item.id} item={item} scanning={scanning}
              onScan={(b,c) => handleScan(b,{containerId:c.containerId,locationCode:c.locationCode,remainingQty:c.remainingQty})} />
          ))}
          {!isLoading && items.length===0 && task?.status!==2 && (
            <div className="py-10 text-center"><p className="text-muted-foreground text-sm">任务状态：{task?.statusName??'…'}</p></div>
          )}
        </div>
      </div>

      {/* 步骤提示 */}
      <div className="max-w-md mx-auto px-4 pt-3">
        <PdaStepHint
          step="扫描库存条码"
          nextStep="扫描库存条码"
          errorHint="扫描库存条码"
          hasError={false}
        />
      </div>

      <PdaBottomBar contentClassName="flex-row items-center gap-3">
        <Input ref={inputRef} value={inputVal}
          onChange={e => setInputVal(e.target.value)}
          onKeyDown={e => { if(e.key==='Enter') handleScan(inputVal) }}
          placeholder={scanning?'处理中…':'扫描库存条码'}
          disabled={scanning||!!finished || pickAction.submitBlocked || readyAction.submitBlocked}
          className="flex-1 h-12 text-base"
          autoComplete="off" autoCorrect="off" spellCheck={false}
        />
        <Button size="lg" onClick={() => handleScan(inputVal)} disabled={!inputVal||scanning||!!finished || pickAction.submitBlocked || readyAction.submitBlocked}>确认</Button>
      </PdaBottomBar>


    </div>
  )
}
