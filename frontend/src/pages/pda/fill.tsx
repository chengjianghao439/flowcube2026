/**
 * PDA 放货 /pda/fill（批 A · 塑料盒作业流）
 *
 * 扫整件来源码 → 扫指定塑料盒 → 按来源**全部实存**倒入（不设可选数量，
 * 避免「全量倒入」被误做成部分拆分）。
 *
 * 提交走 `useCriticalPdaAction`：请求键由它在提交时生成并随 pending 记录持久化，
 * 同一 resource action（`plastic_box.fill.<盒id>`）重放能取回原回执；
 * 提交时把「原盒 / 原来源 / 原数量」快照存进 metadata，
 * **未确认期间不允许取消或改目标**，也不按当前显示数量猜本次成功。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import { parseBarcode } from '@/utils/barcode'
import PdaScanner from '@/components/pda/PdaScanner'
import PdaHeader from '@/components/pda/PdaHeader'
import PdaFlash from '@/components/pda/PdaFlash'
import PdaBottomBar from '@/components/pda/PdaBottomBar'
import { Button } from '@/components/ui/button'
import { getContainerByBarcodeApi, fillPlasticBoxApi, type PlasticBoxFillResult } from '@/api/inventory'
import { usePdaFeedback } from '@/hooks/usePdaFeedback'
import { useCriticalPdaAction } from '@/hooks/useCriticalPdaAction'
import { usePendingRequests } from '@/hooks/usePendingRequests'
import { plasticReadContext, usePdaPlasticReadGuard } from '@/hooks/usePdaPlasticReadGuard'
import { formatPdaActionError } from '@/utils/displayFormatters'

interface ScannedSource {
  containerId: number
  barcode: string
  productHint: string
  remainingQty: number
}

export default function PdaFillPage({ active = true, onBack, onWorkStateChange }: {
  active?: boolean; onBack?: () => void; onWorkStateChange?: (state: { hasInput: boolean; pending: boolean }) => void
} = {}) {
  const navigate = useNavigate()
  const { flash, ok, err } = usePdaFeedback()
  const captureRead = usePdaPlasticReadGuard(active)
  const [formContext, setFormContext] = useState<string | null>(null)
  const contextCurrent = formContext === null || formContext === plasticReadContext()
  const [step, setStep] = useState<'source' | 'target' | 'confirm'>('source')
  const [source, setSource] = useState<ScannedSource | null>(null)
  const [box, setBox] = useState<{ containerId: number; barcode: string } | null>(null)

  // resource action 精确绑定目标盒：同盒同键可重放，不同盒天然落在不同幂等记录上
  const fillAction = useCriticalPdaAction<PlasticBoxFillResult>({
    active,
    action: `plastic_box.fill.${box?.containerId ?? 'none'}`,
    label: '塑料盒放货',
    onConfirmed: (data, ctx) => {
      ok(
        ctx.recovered
          ? `已核对：${data.sourceBarcode} 的货已放入 ${data.targetBarcode}（盒内共 ${data.targetQtyAfter}）`
          : `已放入 ${data.sourceBarcode} → ${data.targetBarcode}（盒内共 ${data.targetQtyAfter}）`,
      )
      setStep('source')
      setSource(null)
      setFormContext(null)
      setBox(null)
      // 复位恢复标志：否则合法第二笔或再次重挂会被首笔的标志影响
      setRestored(false)
    },
  })

  // 关页重挂恢复：pending 记录是持久化的，但 action 依赖 box，重挂后 box=null 就看不到它。
  // 因此按**前缀**扫本功能的待确认记录，并用**校验过的 metadata** 恢复原盒/来源，
  // 恢复后 useCriticalPdaAction 的 action 自然等于原 scoped action，才能查到原回执。
  const { records } = usePendingRequests()
  const myPendings = useMemo(
    () => records.filter((r) => !r.unverifiedOwner && r.action.startsWith('plastic_box.fill.')),
    [records],
  )
  const [restored, setRestored] = useState(false)
  useEffect(() => {
    if (restored || box) return
    // 只认「action 里的资源 ID 与 metadata.boxId 一致」**且字段类型/取值合法**的记录，
    // 不信未知归属或残缺快照（否则会用一个来路不明的记录去查别人的回执）
    const rec = myPendings.find((r) => {
      const m = r.metadata as Record<string, unknown> | undefined
      if (!m) return false
      const boxIdN = Number(m.boxId)
      const srcIdN = Number(m.sourceContainerId)
      const qtyN = Number(m.expectedSourceQty)
      if (!Number.isSafeInteger(boxIdN) || boxIdN <= 0) return false
      if (!Number.isSafeInteger(srcIdN) || srcIdN <= 0) return false
      if (!Number.isFinite(qtyN) || qtyN <= 0) return false
      if (m.boxBarcode !== undefined && typeof m.boxBarcode !== 'string') return false
      if (m.sourceBarcode !== undefined && typeof m.sourceBarcode !== 'string') return false
      return r.action === `plastic_box.fill.${boxIdN}`
    })
    if (!rec) return
    const m = rec.metadata as {
      boxId: number; boxBarcode?: string
      sourceContainerId: number; sourceBarcode?: string; expectedSourceQty?: number
    }
    setFormContext(plasticReadContext())
    setBox({ containerId: Number(m.boxId), barcode: m.boxBarcode ?? `#${m.boxId}` })
    setSource({
      containerId: Number(m.sourceContainerId),
      barcode: m.sourceBarcode ?? `#${m.sourceContainerId}`,
      productHint: '（来自原提交数据，未按当前库存猜测）',
      remainingQty: Number(m.expectedSourceQty),
    })
    setStep('confirm')
    setRestored(true)
  }, [myPendings, restored, box])

  const reset = () => {
    // 提交中 / 待确认 / 核对中都不允许清掉界面状态——那会把待确认记录藏起来
    if (fillAction.phase === 'submitting' || fillAction.phase === 'pending' || fillAction.phase === 'confirming' || fillAction.pendingRecord) {
      err('有放货结果待确认，请先点「确认结果」，暂勿取消或改目标')
      return
    }
    setStep('source')
    setSource(null)
    setFormContext(null)
    setBox(null)
    setRestored(false)
    fillAction.clearError()
  }


  /** 扫来源：必须是整件库存条码（塑料盒不能作为放货来源） */
  const sourceMut = useMutation({
    mutationFn: async ({ bc, owner }: { bc: string; owner: ReturnType<typeof captureRead> }) => {
      const res = await getContainerByBarcodeApi(bc, owner.config)
      return res!
    },
    onSuccess: (d, { owner }) => {
      if (!owner.current()) return
      setFormContext(owner.contextKey)
      if (d.containerKind === 'plastic_box') {
        err('塑料盒不能作为放货来源，请扫整件库存条码')
        return
      }
      if (d.containerStatus !== 'stored') {
        err('来源须为「在库」状态的整件库存条码')
        return
      }
      if (d.lockedByTaskId) {
        err('该来源已被拣货任务锁定，不能放货')
        return
      }
      if (!(d.remainingQty > 0)) {
        err('该来源已无余量')
        return
      }
      setSource({
        containerId: d.containerId,
        barcode: d.barcode,
        productHint: `${d.productName}（${d.productCode}）`,
        remainingQty: d.remainingQty,
      })
      setStep('target')
      ok(`来源 ${d.barcode}：${d.remainingQty} 件，请扫目标塑料盒`)
    },
    onError: (e: unknown, { owner }) => { if (owner.current()) err(formatPdaActionError(e, '查询来源失败')) },
  })

  /** 扫目标盒：必须是塑料盒（同商品同仓库由后端把关；设备仓由后端 PDA 分支把关） */
  const boxMut = useMutation({
    mutationFn: async ({ bc, owner }: { bc: string; owner: ReturnType<typeof captureRead> }) => {
      const res = await getContainerByBarcodeApi(bc, owner.config)
      return res!
    },
    onSuccess: (d, { owner }) => {
      if (!owner.current()) return
      setFormContext(owner.contextKey)
      if (d.containerKind !== 'plastic_box') {
        err('目标必须是塑料盒条码（B 开头）')
        return
      }
      if (d.lockedByTaskId) {
        err('该塑料盒已被拣货任务锁定，不能放货')
        return
      }
      setBox({ containerId: d.containerId, barcode: d.barcode })
      setStep('confirm')
      ok(`目标盒 ${d.barcode}`)
    },
    onError: (e: unknown, { owner }) => { if (owner.current()) err(formatPdaActionError(e, '查询塑料盒失败')) },
  })

  const submit = useCallback(async () => {
    if (!active || !contextCurrent || !source || !box) return
    try {
      const res = await fillAction.run(
        (requestKey) =>
          fillPlasticBoxApi(box.containerId, {
            sourceContainerId: source.containerId,
            expectedSourceQty: source.remainingQty,
          }, requestKey, 'pda'),
        // 原提交快照：原盒 / 原来源 / 原数量（不依赖界面当前显示值）
        {
          boxId: box.containerId,
          boxBarcode: box.barcode,
          sourceContainerId: source.containerId,
          sourceBarcode: source.barcode,
          expectedSourceQty: source.remainingQty,
        },
      )
      if (res.kind === 'pending') {
        err('结果未确认，请点「确认结果」核对原提交，暂勿重复提交')
      }
    } catch (e) {
      err(formatPdaActionError(e, '放货未提交成功'))
    }
  }, [active, contextCurrent, fillAction, source, box, err])

  const handleScan = useCallback((raw: string) => {
    if (!active || !contextCurrent) return
    const parsed = parseBarcode(raw)
    if (parsed.type !== 'container' && parsed.type !== 'unknown') {
      err('请扫描库存条码或塑料盒条码')
      return
    }
    if (fillAction.submitBlocked) {
      err(fillAction.blockedReason ?? '当前不可提交')
      return
    }
    if (step === 'source') sourceMut.mutate({ bc: raw.trim(), owner: captureRead() })
    else if (step === 'target') boxMut.mutate({ bc: raw.trim(), owner: captureRead() })
  }, [active, contextCurrent, captureRead, step, err, sourceMut, boxMut, fillAction])

  const busy = fillAction.phase === 'submitting'
  const pending = busy || !!fillAction.pendingRecord
  useEffect(() => { onWorkStateChange?.({ hasInput: !!source || !!box, pending }) }, [source, box, pending, onWorkStateChange])

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <PdaHeader title="塑料盒放货" subtitle="扫整件来源 → 扫目标盒 → 全部放入" onBack={onBack ?? (() => navigate('/pda'))} />
      <PdaFlash flash={contextCurrent ? flash : null} />

      <div className="flex-1 overflow-y-auto px-4 py-4 max-w-md mx-auto w-full space-y-4">
        {!contextCurrent && <div className="space-y-2 rounded border border-warning/30 p-3 text-sm"><p>账号、服务器或权限已变，原来源输入已保留；请先核对原结果或重新扫码。</p><Button className="px-3" size="lg" variant="outline" onClick={reset}>重新扫码</Button></div>}
        <div hidden={!contextCurrent} className="rounded-2xl border border-border bg-card p-4 space-y-2">
          <p className="text-xs text-muted-foreground">
            当前步骤：<span className="font-semibold text-foreground">
              {step === 'source' ? '① 扫整件来源' : step === 'target' ? '② 扫目标塑料盒' : '③ 确认放货'}
            </span>
          </p>
          {source && (
            <p className="text-sm text-foreground">
              来源：<span className="font-mono">{source.barcode}</span> {source.productHint} · <span className="font-semibold">{source.remainingQty}</span> 件
            </p>
          )}
          {box && <p className="text-sm text-foreground">目标盒：<span className="font-mono">{box.barcode}</span></p>}
          {step === 'confirm' && source && (
            <p className="text-xs text-muted-foreground">
              将把来源的全部 {source.remainingQty} 件放入该盒（按来源整件全部，不拆分）。
            </p>
          )}
        </div>

        {/* 未确认/待确认状态：提示 + 手动确认，期间禁改目标。
            重挂后 phase 仍是初始 idle，因此**同时按 pendingRecord 显示**，否则确认按钮不出现。 */}
        {(fillAction.phaseMessage || fillAction.lastErrorMessage || fillAction.pendingRecord) && (
          <div className="rounded-2xl border border-warning/30 bg-warning/10 p-3 text-xs text-warning-ink">
            {fillAction.phaseMessage || fillAction.lastErrorMessage
              || `${fillAction.pendingRecord?.label ?? '放货'}结果待确认，请核对原提交后再继续。`}
            {fillAction.pendingRecord && (
              <div className="mt-2">
                <Button className="px-3" size="lg" variant="outline" onClick={() => { void fillAction.confirmPending() }} disabled={fillAction.confirming}>
                  {fillAction.confirming ? '核对中…' : '确认结果'}
                </Button>
              </div>
            )}
          </div>
        )}

        {contextCurrent && step === 'confirm' && (
          <div className="flex gap-2">
            <Button size="lg" variant="outline" className="px-3 flex-1" onClick={reset} disabled={busy}>取消</Button>
            <Button size="lg" className="px-3 flex-1" onClick={() => { void submit() }} disabled={busy || fillAction.submitBlocked || sourceMut.isPending || boxMut.isPending}>
              {busy ? '提交中…' : '确认放货'}
            </Button>
          </div>
        )}
      </div>

      <PdaBottomBar>
        {contextCurrent && step !== 'confirm' && (
          <PdaScanner
            onScan={handleScan}
            placeholder={step === 'source' ? '扫描整件库存条码' : '扫描目标塑料盒条码'}
            disabled={!active || sourceMut.isPending || boxMut.isPending || fillAction.submitBlocked}
            busy={sourceMut.isPending || boxMut.isPending}
          />
        )}
      </PdaBottomBar>
    </div>
  )
}
