/**
 * PDA 塑料盒作业 /pda/split
 *
 * 批 A 语义纠正：**扫塑料盒 B → 人工逐箱 qty → 生成整件库存码 I**（还原整件），
 * 余量留在盒内。旧方向「从整件 I 拆出散件塑料盒 B」保留为另一分支（扫到 I 时走原
 * splitContainerApi），后端能力不变——本页不再只有一个反方向入口。
 *
 * 还原整件沿原盒资源回执；I→B 普通拆分按来源ID绑定稳定键，并冻结原账号、
 * 服务器和完整载荷。未决结果只能主动核对或经新鲜未找到结果按原键原内容重试。
 */
import { useId, useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import { parseBarcode } from '@/utils/barcode'
import PdaScanner from '@/components/pda/PdaScanner'
import PdaHeader from '@/components/pda/PdaHeader'
import PdaFlash from '@/components/pda/PdaFlash'
import PdaBottomBar from '@/components/pda/PdaBottomBar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { getContainerByBarcodeApi, repackPlasticBoxApi, type PlasticBoxRepackResult } from '@/api/inventory'
import { usePdaFeedback } from '@/hooks/usePdaFeedback'
import { useCriticalPdaAction } from '@/hooks/useCriticalPdaAction'
import { usePendingRequests } from '@/hooks/usePendingRequests'
import PdaSplitRecoveryPanel from '@/components/pda/PdaSplitRecoveryPanel'
import { splitEndpoint } from '@/lib/pdaSplitRecovery'
import { usePdaRole } from '@/hooks/usePdaRole'
import { PERMISSIONS } from '@/lib/permission-codes'
import { plasticReadContext, usePdaPlasticReadGuard } from '@/hooks/usePdaPlasticReadGuard'
import { usePdaSplitRecovery } from '@/hooks/usePdaSplitRecovery'
import { formatPdaActionError } from '@/utils/displayFormatters'

type Mode = 'repack' | 'split'
const LEGACY_PAGE_TITLE = '塑料盒作业'

export default function PdaSplitPage({ fixedMode, active = true, onBack, onWorkStateChange }: {
  fixedMode?: Mode; active?: boolean; onBack?: () => void; onWorkStateChange?: (state: { hasInput: boolean; pending: boolean }) => void
} = {}) {
  const fieldId = useId()
  const navigate = useNavigate()
  const { flash, ok, err } = usePdaFeedback()
  const { can } = usePdaRole()
  const canExecute = can(PERMISSIONS.INVENTORY_CONTAINER_SPLIT)
  const captureRead = usePdaPlasticReadGuard(active)
  const [formContext, setFormContext] = useState<string | null>(null)
  const contextCurrent = formContext === null || formContext === plasticReadContext()
  const [step, setStep] = useState<'scan' | 'form'>('scan')
  const [mode, setMode] = useState<Mode>(fixedMode ?? 'repack')
  const [boxId, setBoxId] = useState<number | null>(null)
  const [barcode, setBarcode] = useState<string | null>(null)
  const [productHint, setProductHint] = useState('')
  const [remaining, setRemaining] = useState(0)
  const [qtyStr, setQtyStr] = useState('1')
  const [perBoxQty, setPerBoxQty] = useState('1')
  const [boxCount, setBoxCount] = useState('1')
  // 逐箱清单：人工按每箱不同数量填（空格/逗号分隔），与「等量快捷」二选一
  const [repackMode, setRepackMode] = useState<'quick' | 'list'>('quick')
  const [itemsStr, setItemsStr] = useState('')
  const [printLabel, setPrintLabel] = useState(false)
  const [dimension, setDimension] = useState<{ productId: number; warehouseId: number } | null>(null)
  const splitAction = usePdaSplitRecovery({ active, onConfirmed: (res, recovered) => {
    ok(`${recovered ? '已核对：' : ''}拆分成功：新塑料盒条码 ${res.newBarcode}；原码余量 ${res.sourceRemainingAfter}`)
    if (Number(res.noPrinterCount) + Number(res.renderFailedCount) > 0) err('标签未打印，请在打印记录中核对并补打')
    finishReset()
  } })

  // 还原整件走 useCriticalPdaAction：请求键随 pending 记录持久化，resource action 精确绑定盒，
  // 未确认期间不允许取消/改目标，也不按当前显示数量猜本次成功。
  const repackAction = useCriticalPdaAction<PlasticBoxRepackResult>({
    active,
    action: `plastic_box.repack.${boxId ?? 'none'}`,
    label: '还原整件',
    onConfirmed: (res, ctx) => {
      const codes = res.created.map((c) => `${c.barcode}(${c.qty})`).join('、')
      ok(`${ctx.recovered ? '已核对：' : ''}已生成 ${res.created.length} 个整件码：${codes}；盒内余 ${res.boxRemainingAfter}`)
      const failed = Number(res.noPrinterCount || 0) + Number(res.renderFailedCount || 0)
      if (failed > 0) {
        const parts = []
        if (Number(res.noPrinterCount || 0) > 0) parts.push(`${res.noPrinterCount} 个无可用打印机`)
        if (Number(res.renderFailedCount || 0) > 0) parts.push(`${res.renderFailedCount} 个标签渲染失败`)
        err(`${failed} 个标签未打印（${parts.join('，')}），可在打印记录页补打`)
      }
      // 已确定成功：用内部复位（不经防取消闸），保证正常成功与查回执成功都能回到扫码态
      finishReset()
    },
  })

  const loadMut = useMutation({
    mutationFn: async ({ bc, owner }: { bc: string; owner: ReturnType<typeof captureRead> }) => {
      const res = await getContainerByBarcodeApi(bc, owner.config)
      return res!
    },
    onSuccess: (d, { owner }) => {
      if (!owner.current()) return
      setFormContext(owner.contextKey)
      if (d.containerStatus === 'waiting_putaway') {
        err('待上架库存条码不能操作')
        return
      }
      if (d.lockedByTaskId) {
        err(`该条码已被拣货任务 ${d.lockedByTaskNo ?? `#${d.lockedByTaskId}`} 锁定，不能操作`)
        return
      }
      const isBox = d.containerKind === 'plastic_box'
      if (fixedMode && (fixedMode === 'repack') !== isBox) { err(fixedMode === 'repack' ? '本动作须扫塑料盒B码，不能扫整件库存码' : '本动作须扫整件库存I码，不能扫塑料盒'); return }
      setDimension({ productId: d.productId, warehouseId: d.warehouseId })
      setMode(isBox ? 'repack' : 'split')
      setBoxId(d.containerId)
      setBarcode(d.barcode)
      setProductHint(`${d.productName}（${d.productCode}）`)
      setRemaining(d.remainingQty)
      setQtyStr('1')
      setPerBoxQty('1')
      setBoxCount('1')
      setItemsStr('')
      setStep('form')
      ok(`已识别 ${d.barcode}：${isBox ? '还原整件' : '拆出散件盒'}`)
    },
    onError: (e: unknown, { owner }) => { if (owner.current()) err(formatPdaActionError(e, '查询失败')) },
  })

  /** 还原整件：B → 逐箱 qty → 生成 I（useCriticalPdaAction 提交，pending 时挂回查原回执） */
  // 关页重挂恢复：pending 记录持久化，但 action 依赖 boxId；重挂后按前缀扫本功能记录，
  // 校验「action 里的资源 ID == metadata.boxId」后再恢复原盒与表单快照。
  const { records } = usePendingRequests()
  const myPendings = useMemo(
    () => records.filter((r) => !r.unverifiedOwner && r.action.startsWith('plastic_box.repack.')),
    [records],
  )
  const [restored, setRestored] = useState(false)
  // 是否为「从待确认快照恢复」的界面（用于把余量标注成历史快照，避免被当成当前库存）
  const [restoredSnapshot, setRestoredSnapshot] = useState(false)
  useEffect(() => {
    if (restored || boxId || fixedMode === 'split' || splitAction.records.length) return
    const rec = myPendings.find((r) => {
      const m = r.metadata as { boxId?: number } | undefined
      return m?.boxId != null && Number(m.boxId) > 0 && r.action === `plastic_box.repack.${Number(m.boxId)}`
    })
    if (!rec) return
    const m = rec.metadata as {
      boxId: number; barcode?: string; mode?: 'quick' | 'list'
      items?: number[]; perBoxQty?: number; boxCount?: number; remaining?: number
    }
    setFormContext(plasticReadContext())
    setBoxId(Number(m.boxId))
    setBarcode(m.barcode ?? `#${m.boxId}`)
    // 用**原提交时的余量快照**（不是当前库存，也不用默认 0），并标为历史快照
    if (Number.isFinite(Number(m.remaining))) setRemaining(Number(m.remaining))
    setRestoredSnapshot(true)
    setMode('repack')
    if (m.mode === 'list' && Array.isArray(m.items)) {
      setRepackMode('list')
      setItemsStr(m.items.join(' '))
    } else {
      setRepackMode('quick')
      setPerBoxQty(String(m.perBoxQty ?? 1))
      setBoxCount(String(m.boxCount ?? 1))
    }
    setStep('form')
    setRestored(true)
  }, [myPendings, restored, boxId, fixedMode, splitAction.records.length])

  const submitRepack = useCallback(async () => {
    if (!active || !contextCurrent || !canExecute || !boxId) return
    let body: { perBoxQty?: number; boxCount?: number; items?: number[] }
    if (repackMode === 'list') {
      const list = itemsStr.split(/[\s,，]+/).filter(Boolean).map(Number)
      if (!list.length) { err('请填写逐箱数量'); return }
      if (list.some((v) => !Number.isFinite(v) || v <= 0)) { err('逐箱数量必须是大于 0 的数字'); return }
      const sum = list.reduce((a, b) => a + b, 0)
      if (sum > remaining) { err(`合计 ${sum} 超过盒内余量 ${remaining}`); return }
      body = { items: list }
    } else {
      const per = Number(perBoxQty)
      const cnt = Number(boxCount)
      if (!Number.isFinite(per) || per <= 0) { err('每箱数量无效'); return }
      if (!Number.isInteger(cnt) || cnt <= 0) { err('箱数无效'); return }
      if (per * cnt > remaining) { err(`合计 ${per * cnt} 超过盒内余量 ${remaining}`); return }
      body = { perBoxQty: per, boxCount: cnt }
    }
    try {
      const res = await repackAction.run(
        (requestKey) => repackPlasticBoxApi(boxId, body, requestKey, 'pda'),
        // 原提交快照：原盒 + 原箱数/清单（不依赖界面当前值）
        // remaining 也冻结进快照：重挂后若只剩默认 0，会把原提交清单算成「盒内 0 / 负留量」
        { boxId, barcode, mode: repackMode, remaining, ...body },
      )
      if (res.kind === 'pending') {
        err('结果未确认，请点「确认结果」核对原提交，暂勿重复提交')
      }
    } catch (e) {
      err(formatPdaActionError(e, '还原整件未提交成功'))
    }
  }, [active, contextCurrent, canExecute, boxId, barcode, repackMode, itemsStr, perBoxQty, boxCount, remaining, repackAction, err])

  // 原拆分快照恢复不取当前库存、不自动POST。残缺快照只提供查询入口。
  useEffect(() => {
    const rec = splitAction.records.find(r => r.endpoint === splitEndpoint())
    if (!rec || boxId || fixedMode === 'repack') return
    setFormContext(plasticReadContext())
    setMode('split'); setBoxId(rec.sourceContainerId); setBarcode(rec.sourceBarcode ?? `#${rec.sourceContainerId}`)
    setProductHint('原提交数据，请先核对结果'); setRemaining(rec.remaining ?? 0)
    setQtyStr(rec.body ? String(rec.body.qty) : ''); setPrintLabel(rec.body?.printLabel ?? false)
    setRestoredSnapshot(true); setStep('form')
  }, [splitAction.records, boxId, fixedMode])
  const submitSplit = async () => {
    if (!active || !contextCurrent || !canExecute || !boxId || !barcode || !dimension) return
    const qty = Number(qtyStr)
    if (!Number.isFinite(qty) || qty <= 0 || qty >= remaining) { err('拆分数量须大于0且小于剩余数量'); return }
    try { await splitAction.run({ sourceContainerId: boxId, sourceBarcode: barcode, ...dimension, remaining }, { qty, printLabel }) }
    catch (error) { err(formatPdaActionError(error, '拆分未提交')) }
  }

  /**
   * 内部复位（**已确定成功**后调用）：不经防取消闸。
   *
   * 成功那一刻回调闭包里的 phase 可能仍是 submitting（正常成功）或 pending/confirming
   * （查回执成功），若走带 guard 的 resetToScan 会被自己拦住、界面永远回不到扫码态。
   */
  const finishReset = () => {
    setStep('scan')
    setBoxId(null)
    setBarcode(null)
    setProductHint('')
    setRemaining(0)
    setQtyStr('1')
    setDimension(null)
    setFormContext(null)
    setPerBoxQty('1')
    setBoxCount('1')
    setItemsStr('')
    setRestored(false)
    setRestoredSnapshot(false)
  }

  /** 用户主动取消/重新扫码：仍带 guard（待确认时不能把记录藏起来） */
  const resetToScan = () => {
    if (splitAction.blocked || repackAction.phase === 'submitting' || repackAction.phase === 'pending'
        || repackAction.phase === 'confirming' || repackAction.pendingRecord) {
      err('有原作业结果待确认，请先核对，暂勿重新扫码或切换目标')
      return
    }
    finishReset()
  }

  const handleScan = useCallback((raw: string) => {
    if (!active || !canExecute || splitAction.blocked || repackAction.submitBlocked) return
    const parsed = parseBarcode(raw)
    if (parsed.type !== 'container' && parsed.type !== 'unknown') {
      err('扫描库存条码或塑料盒条码')
      return
    }
    loadMut.mutate({ bc: raw.trim(), owner: captureRead() })
  }, [err, loadMut, active, canExecute, captureRead, splitAction.blocked, repackAction.submitBlocked])

  // 未确认期间锁住输入与模式：不能一边等回执一边改目标/改数量（防止「按当前输入猜成功」）
  const repackLocked = repackAction.phase === 'submitting'
    || repackAction.phase === 'pending'
    || repackAction.phase === 'confirming'
    || Boolean(repackAction.pendingRecord)

  useEffect(() => { onWorkStateChange?.({ hasInput: step !== 'scan', pending: splitAction.blocked || repackLocked }) }, [step, splitAction.blocked, repackLocked, onWorkStateChange])
  const perNum = Number(perBoxQty)
  const cntNum = Number(boxCount)
  const estTotal = Number.isFinite(perNum) && Number.isInteger(cntNum) && perNum > 0 && cntNum > 0 ? perNum * cntNum : 0
  const listQtys = itemsStr.split(/[\s,，]+/).filter(Boolean).map(Number).filter((v) => Number.isFinite(v) && v > 0)
  const listCount = listQtys.length
  const listSum = listQtys.reduce((a, b) => a + b, 0)

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <PdaHeader
        title={fixedMode === 'split' ? '拆出散件盒' : fixedMode === 'repack' ? '盒还原整件' : LEGACY_PAGE_TITLE}
        subtitle={mode === 'repack' ? '扫盒 → 各箱数量 → 生成整件码' : '扫整件 → 拆出散件盒'}
        onBack={onBack ?? (() => navigate('/pda'))}
      />
      <PdaFlash flash={contextCurrent ? flash : null} />
      {!canExecute && <p className="px-4 py-2 text-sm text-warning-ink">当前无拆分执行权限，仍可核对本人原拆分结果。</p>}
      <PdaSplitRecoveryPanel recovery={splitAction} onError={err} />

      <div className="flex-1 overflow-y-auto px-4 py-4 max-w-md mx-auto w-full space-y-4">
        {step === 'scan' && (
          <div className="rounded-2xl border border-border bg-card p-4 space-y-2">
            <p className="text-sm text-muted-foreground">{fixedMode === 'repack' ? '扫描塑料盒B码，填写各整件数量' : fixedMode === 'split' ? '扫描整件库存I码，填写拆出散件数量' : '扫描塑料盒条码（还原整件）或库存条码（拆出散件盒）'}</p>
          </div>
        )}

        {!contextCurrent && <div className="space-y-2 rounded border border-warning/30 p-3 text-sm"><p>账号、服务器或权限已变，原输入已保留但不能用于当前作业；请核对原结果或重新扫码。</p><Button className="px-3" size="lg" variant="outline" onClick={resetToScan}>重新扫码</Button></div>}
        {step === 'form' && boxId && contextCurrent && (
          <div className="rounded-2xl border border-primary/30 bg-primary/5 p-4 space-y-3">
            <p className="font-mono text-lg font-bold text-foreground">{barcode}</p>
            <p className="text-sm text-foreground">{productHint}</p>
            <p className="text-xs text-muted-foreground">
              作业方向：<span className="font-semibold text-foreground">{mode === 'repack' ? '还原整件（盒 → 整件码）' : '拆出散件盒（整件 → 盒）'}</span>
            </p>
            <p className="text-xs text-muted-foreground">
              {restoredSnapshot ? '盒内余量（原提交时数据）' : '当前余量'}：<span className="font-semibold text-foreground">{remaining}</span>
            </p>

            {mode === 'repack' ? (
              <>
                <div className="flex gap-2">
                  <button type="button" disabled={repackLocked} aria-pressed={repackMode === 'quick'}
                    className={`min-h-11 flex-1 rounded-md border px-3 py-2 text-xs ${repackMode === 'quick' ? 'border-primary bg-primary/10 font-semibold' : 'border-border'} disabled:opacity-50`}
                    onClick={() => setRepackMode('quick')}>等量快捷</button>
                  <button type="button" disabled={repackLocked} aria-pressed={repackMode === 'list'}
                    className={`min-h-11 flex-1 rounded-md border px-3 py-2 text-xs ${repackMode === 'list' ? 'border-primary bg-primary/10 font-semibold' : 'border-border'} disabled:opacity-50`}
                    onClick={() => setRepackMode('list')}>逐箱清单</button>
                </div>

                {repackMode === 'quick' ? (
                  <>
                    <div className="flex gap-2">
                      <div className="flex-1 space-y-1">
                        <label htmlFor={`${fieldId}-per-box`} className="text-xs text-muted-foreground">每箱数量</label>
                        <Input id={`${fieldId}-per-box`} data-scanner-manual="true" quantity type="number" inputMode="decimal" min={1} value={perBoxQty} disabled={repackLocked}
                          onChange={e => setPerBoxQty(e.target.value)} className="min-h-11 font-mono text-lg" />
                      </div>
                      <div className="flex-1 space-y-1">
                        <label htmlFor={`${fieldId}-box-count`} className="text-xs text-muted-foreground">箱数</label>
                        <Input id={`${fieldId}-box-count`} data-scanner-manual="true" quantity type="number" inputMode="numeric" min={1} max={100} value={boxCount} disabled={repackLocked}
                          onChange={e => setBoxCount(e.target.value)} className="min-h-11 font-mono text-lg" />
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      将生成 <span className="font-semibold text-foreground">{estTotal > 0 ? Math.floor(cntNum) : 0}</span> 个整件码，合计
                      <span className="font-semibold text-foreground"> {estTotal}</span>，盒内留
                      <span className="font-semibold text-foreground"> {Math.max(0, remaining - estTotal)}</span>
                    </p>
                  </>
                ) : (
                  <>
                    <div className="space-y-1">
                      <label htmlFor={`${fieldId}-box-list`} className="text-xs text-muted-foreground">逐箱数量（空格或逗号分隔，每箱可不同）</label>
                      <Input id={`${fieldId}-box-list`} data-scanner-manual="true" type="text" inputMode="text" value={itemsStr} disabled={repackLocked}
                        onChange={e => setItemsStr(e.target.value)} placeholder="如 30 25 25" className="min-h-11 font-mono text-lg" />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      共 <span className="font-semibold text-foreground">{listCount}</span> 箱，合计
                      <span className="font-semibold text-foreground"> {listSum}</span>，盒内留
                      <span className="font-semibold text-foreground"> {Math.max(0, remaining - listSum)}</span>
                    </p>
                  </>
                )}
              </>
            ) : (
              <>
                <div className="space-y-1">
                  <label htmlFor={`${fieldId}-split-qty`} className="text-xs text-muted-foreground">拆分数量</label>
                  <Input id={`${fieldId}-split-qty`} data-scanner-manual="true" quantity type="number" inputMode="decimal" min={1} max={Math.max(0, remaining - 1)}
                    value={qtyStr} disabled={splitAction.blocked} onChange={e => setQtyStr(e.target.value)} className="min-h-11 font-mono text-lg" />
                </div>
                <label className="flex min-h-11 items-center gap-2 text-sm">
                  <input type="checkbox" checked={printLabel} disabled={splitAction.blocked} onChange={e => setPrintLabel(e.target.checked)}
                    className="h-4 w-4 rounded border-border" />
                  打印新塑料盒条码
                </label>
              </>
            )}

            {(repackAction.phaseMessage || repackAction.lastErrorMessage || repackAction.pendingRecord) && (
              <div className="rounded-md border border-warning/30 bg-warning/10 p-2 text-xs text-warning-ink">
                {repackAction.phaseMessage || repackAction.lastErrorMessage
                  || `${repackAction.pendingRecord?.label ?? '还原整件'}结果待确认，请核对原提交后再继续。`}
                {repackAction.pendingRecord && (
                  <div className="mt-2">
                    <Button className="px-3" size="lg" variant="outline" disabled={repackAction.confirming}
                      onClick={() => { void repackAction.confirmPending() }}>
                      {repackAction.confirming ? '核对中…' : '确认结果'}
                    </Button>
                  </div>
                )}
              </div>
            )}

            <div className="flex gap-2 pt-2">
              <Button size="lg" variant="outline" className="px-3 flex-1"
                onClick={() => { if (repackAction.phase === 'submitting') { err('提交中，暂勿取消'); return } resetToScan() }}
                disabled={repackAction.phase === 'submitting'}>
                重新扫码
              </Button>
              <Button size="lg"
                className="px-3 flex-1"
                onClick={() => { if (mode === 'repack') void submitRepack(); else void submitSplit() }}
                disabled={!active || !canExecute || (mode === 'repack' ? repackAction.phase === 'submitting' || repackAction.submitBlocked : splitAction.blocked)}
              >
                {mode === 'repack'
                  ? (repackAction.phase === 'submitting' ? '提交中…' : '确认还原')
                  : '确认拆分'}
              </Button>
            </div>
          </div>
        )}
      </div>

      <PdaBottomBar>
        {step === 'scan' && (
          <PdaScanner onScan={handleScan} placeholder="扫描塑料盒或库存条码" disabled={!active || !canExecute || loadMut.isPending || splitAction.blocked || repackAction.submitBlocked} />
        )}
      </PdaBottomBar>
    </div>
  )
}
