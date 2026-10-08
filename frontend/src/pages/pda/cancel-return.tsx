import PdaProductIdentity from '@/components/pda/PdaProductIdentity'
import PdaOverviewText from '@/components/pda/PdaOverviewText'
/**
 * PDA 拣货退回 — 销售单在拣货中/待分拣被取消后，已拣容器的逆向归还
 * 路由：/pda/cancel-return（任务池列表）、/pda/cancel-return/:id（逐容器扫码归还）
 *
 * 镜像拣货的正向流程：逐容器扫码确认放回，再扫目标库位条码登记新位置，
 * 而不是后台批量解锁——避免货物已经拿出货架、但系统"看起来"还在原位的账实不符。
 */
import { useState } from 'react'
import {PackageX, CircleCheck, Loader2} from 'lucide-react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { SoftStatusLabel } from '@/components/shared/StatusBadge'
import {
  submitCancelReturnScanApi,
  submitCancelReturnBoxScanApi,
  type CancelReturnContainer,
} from '@/api/warehouse-tasks'
import { getLocationByCodeApi } from '@/api/locations'
import PdaHeader, { PdaRefreshButton } from '@/components/pda/PdaHeader'
import PdaCard from '@/components/pda/PdaCard'
import PdaBottomBar from '@/components/pda/PdaBottomBar'
import PdaScanner from '@/components/pda/PdaScanner'
import PdaFlash from '@/components/pda/PdaFlash'
import { PdaEmptyCard, PdaLoading, PdaQueryError } from '@/components/pda/PdaEmptyState'
import { usePdaFeedback } from '@/hooks/usePdaFeedback'
import { useKitOperation } from '@/hooks/useKitOperation'
import { captureKitReadOwner, assertKitReadOwner } from '@/hooks/useKits'
import { usePendingRequests } from '@/hooks/usePendingRequests'
import { useNetworkStatus } from '@/hooks/useNetworkStatus'
import { commercialReadConfig } from '@/api/sale-commercial'
import { Button } from '@/components/ui/button'
import type { KitQueryRecord } from '@/lib/kitOperationRecovery'
import { usePdaPendingCancelReturns, usePdaCancelReturnDetail } from '@/hooks/usePdaCancelReturn'
import { formatPdaErrorMessage } from '@/utils/displayFormatters'
import { parseBarcode } from '@/utils/barcode'

// ── 列表：待处理的拣货退回任务池 ──────────────────────────────────────────────
function CancelReturnListPage() {
  const navigate = useNavigate()
  const { data, isLoading, isError, refetch } = usePdaPendingCancelReturns()
  const tasks = data ?? []

  return (
    <div className="min-h-screen bg-background">
      <PdaHeader title="拣货退回" subtitle="逆向归还已拣库存条码" onBack={() => navigate('/pda')}
        right={<PdaRefreshButton onRefresh={() => refetch()} />} />
      <div className="max-w-md mx-auto px-4 py-5 space-y-4">
        {!isError && <p className="text-xs text-muted-foreground">{tasks.length} 个任务待归还</p>}
        {isLoading && <PdaLoading className="h-32" />}
        {isError && <PdaQueryError onRetry={() => { void refetch() }} />}
        {!isLoading && !isError && tasks.length === 0 && (
          <PdaEmptyCard icon={<PackageX className="h-12 w-12 text-muted-foreground" />} title="暂无待归还任务" description="没有因订单取消而需要归还货物的任务" />
        )}
        {!isError && tasks.map(t => (
          <PdaCard key={t.id} className="w-full" onClick={() => navigate(`/pda/cancel-return/${t.id}`)}>
            <div className="space-y-2">
              <div className="flex items-start justify-between gap-3">
                <p className="font-mono font-semibold text-foreground whitespace-normal [overflow-wrap:anywhere]">{t.taskNo}</p>
                <SoftStatusLabel
                  label={`待归还 ${t.containersRemaining}${t.packagesRemaining > 0 ? ` · 待拆箱 ${t.packagesRemaining}` : ''}`}
                  tone="warning"
                  className="shrink-0"
                />
              </div>
              <PdaOverviewText>{t.customerName ?? '未知客户'}</PdaOverviewText>
              <p className="text-sm text-muted-foreground">{t.warehouseName}</p>
            </div>
          </PdaCard>
        ))}
      </div>
    </div>
  )
}

// ── 详情：逐容器扫码归还 ──────────────────────────────────────────────────────
type Step = 'scan-container' | 'scan-location'

function CancelReturnDetailPage({ taskId }: { taskId: number }) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [step, setStep] = useState<Step>('scan-container')
  const [target, setTarget] = useState<CancelReturnContainer | null>(null)
  const [scanning, setScanning] = useState(false)
  const { flash, ok, err, warn } = usePdaFeedback()

  const [owner] = useState(captureKitReadOwner)
  const { data: detail, isLoading, isError, refetch } = usePdaCancelReturnDetail(taskId, owner)
  const network = useNetworkStatus()
  const legacy = usePendingRequests().records.find(r => r.action === `warehouse.cancel-return.${taskId}` || r.action === `warehouse.cancel-return-box.${taskId}`)
  type RowBody = { taskId: number; containerId: number; barcode: string; locationId: number }
  type BoxBody = { taskId: number; packageId: number; barcode: string }
  type RowResult = { id: number; remaining: number; packagesRemaining: number; finalized: boolean }
  type BoxResult = { id: number; containersRemaining: number; packagesRemaining: number; finalized: boolean }
  const returnAction = useKitOperation<RowBody, RowResult>(owner, `pda-cancel-return:${taskId}`, {
    execute: (body, query, originalOwner) => submitCancelReturnScanApi(body.taskId, body.containerId, body.barcode, body.locationId, query.requestKey, commercialReadConfig(originalOwner)),
    validate: data => !!data && Number.isSafeInteger(data.id) && data.id > 0 && Number.isInteger(data.remaining) && data.remaining >= 0 && Number.isInteger(data.packagesRemaining) && data.packagesRemaining >= 0 && typeof data.finalized === 'boolean'
  })
  const boxAction = useKitOperation<BoxBody, BoxResult>(owner, `pda-cancel-return-box:${taskId}`, {
    execute: (body, query, originalOwner) => submitCancelReturnBoxScanApi(body.taskId, body.packageId, body.barcode, query.requestKey, commercialReadConfig(originalOwner)),
    validate: data => !!data && Number.isSafeInteger(data.id) && data.id > 0 && Number.isInteger(data.packagesRemaining) && data.packagesRemaining >= 0 && Number.isInteger(data.containersRemaining) && data.containersRemaining >= 0 && typeof data.finalized === 'boolean'
  })
  let ownerCurrent = true
  try { assertKitReadOwner(owner) } catch { ownerCurrent = false }
  const blocked = returnAction.blocked || boxAction.blocked || !!legacy || !ownerCurrent || network !== 'online' || isLoading || isError || !detail
  async function reloadOriginal() {
    assertKitReadOwner(owner)
    await qc.invalidateQueries({ queryKey: ['pda-cancel-return-detail', taskId] })
    await qc.invalidateQueries({ queryKey: ['pda-cancel-returns-pending'] })
  }
  function recoveredContext(query: KitQueryRecord) {
    const c = query.context
    return `原任务 #${c?.taskId ?? query.resourceId} · ${c?.containerId ? `原库存条码 #${c.containerId} · 原库位 #${c.locationId}` : `原箱 #${c?.packageId}`}`
  }
  async function recoverRow(retry: boolean) {
    const answer = await (retry ? returnAction.retry() : returnAction.queryOriginal())
    if (!answer) return
    // A copied/restored record only reports its original operation. It cannot
    // navigate, clear the new scan target, or update another draft.
    if (answer.queryOnly) { ok('原归还结果已核实，当前扫码保持；请自行刷新原任务'); return }
    if (returnAction.canApply(answer)) { await reloadOriginal(); ok('原归还结果已核实'); }
  }
  async function recoverBox(retry: boolean) {
    const answer = await (retry ? boxAction.retry() : boxAction.queryOriginal())
    if (!answer) return
    if (answer.queryOnly) { ok('原拆箱结果已核实，当前扫码保持；请自行刷新原任务'); return }
    if (boxAction.canApply(answer)) { await reloadOriginal(); ok('原拆箱结果已核实'); }
  }

  async function handleBoxScan(raw: string) {
    const code = raw.trim()
    if (!code || !detail) return
    const found = detail.packages.find(p => p.barcode.toUpperCase() === code.toUpperCase())
    if (!found) { err('该箱子不属于本任务的待拆箱清单，请确认条码'); return }
    if (blocked) { err('原操作待核对或当前来源不可提交'); return }
    setScanning(true)
    try {
      const submitted = await boxAction.submit(
        { taskId, packageId: found.packageId, barcode: found.barcode },
        { action: `scan-log.cancel-return-box.${taskId}`, kind: 'cancel-return-box', resourceType: 'warehouse_task', resourceId: taskId, context: { taskId, packageId: found.packageId } },
      )
      if (!submitted) {
        warn('拆箱提交未确认，请查看原操作提示，暂勿重复扫码。')
        return
      }
      if (!boxAction.canApply(submitted)) return
      const result = submitted.data
      if (result.finalized) {
        ok(`✓ 已确认拆箱 ${found.barcode}，任务全部处理完成，已取消`)
        await qc.invalidateQueries({ queryKey: ['pda-cancel-returns-pending'] })
        navigate('/pda/cancel-return')
        return
      }
      ok(`✓ 已确认拆箱 ${found.barcode}，剩余 ${result.containersRemaining} 个库存条码 / ${result.packagesRemaining} 个箱子待处理`)
      await refetch()
    } catch (error: unknown) {
      err(formatPdaErrorMessage((error as { message?: string })?.message, '拆箱确认失败，请重试'))
    } finally {
      setScanning(false)
    }
  }

  function handleContainerScan(raw: string) {
    const code = raw.trim()
    if (!code || !detail || blocked) return
    const found = detail.containers.find(c => c.barcode.toUpperCase() === code.toUpperCase())
    if (!found) { err('该条码不属于本任务的待归还清单'); return }
    setTarget(found)
    setStep('scan-location')
  }

  async function handleLocationScan(raw: string) {
    const code = raw.trim()
    if (!code || !target) return
    if (blocked) { err('原操作待核对或当前来源不可提交'); return }
    setScanning(true)
    try {
      const originalTarget = target
      assertKitReadOwner(owner)
      const loc = await getLocationByCodeApi(code, commercialReadConfig(owner))
      assertKitReadOwner(owner)
      if (!loc) { err('库位不对，请重扫'); return }
      const submitted = await returnAction.submit(
        { taskId, containerId: originalTarget.containerId, barcode: originalTarget.barcode, locationId: loc.id },
        { action: `scan-log.cancel-return.${taskId}`, kind: 'cancel-return-row', resourceType: 'warehouse_task', resourceId: taskId, context: { taskId, containerId: originalTarget.containerId, locationId: loc.id } },
      )
      if (!submitted) {
        warn('归还提交未确认，请查看原操作提示，暂勿重复扫码。')
        return
      }
      if (!returnAction.canApply(submitted)) return
      const result = submitted.data
      if (result.finalized) {
        ok(`✓ 已归还到 ${loc.code}，任务全部归还完成，已取消`)
        await qc.invalidateQueries({ queryKey: ['pda-cancel-returns-pending'] })
        navigate('/pda/cancel-return')
        return
      }
      ok(`✓ 已归还到 ${loc.code}，剩余 ${result.remaining} 个库存条码待归还`)
      await refetch()
    } catch (error: unknown) {
      err(formatPdaErrorMessage((error as { message?: string })?.message, '归还失败，请重试'))
    } finally {
      setScanning(false)
      setStep('scan-container')
      setTarget(null)
    }
  }

  function handleScan(code: string) {
    if (step === 'scan-location') { void handleLocationScan(code); return }
    // 待归还容器和待拆箱箱子共用同一个扫码入口，按条码类型自动分流。
    if (parseBarcode(code).type === 'box') { void handleBoxScan(code); return }
    handleContainerScan(code)
  }

  // Receipt ownership is independent of detail VIEW permission and loading.
  const recoveryUI = <>
        <PdaFlash flash={flash} />
        {legacy && <PdaCard><p className="text-sm text-destructive-ink">历史归还记录缺少原服务器与登录身份，不能认作当前操作；请人工核对原任务，暂勿重复扫码。</p><p className="text-xs">原记录号 {legacy.requestKey}</p></PdaCard>}
        {(!ownerCurrent || network !== 'online') && <p role="alert" className="text-sm text-destructive-ink">当前登录、服务器或网络不可提交，请完成正常登录 / 设备绑定后核对原记录。</p>}
        {returnAction.error && <p role="alert" className="text-sm text-destructive-ink">{returnAction.error}</p>}
        {returnAction.pending && <PdaCard><p className="font-medium">归还结果待确认</p><p className="text-xs">{recoveredContext(returnAction.pending)}。按原键查询；刷新只恢复查询身份，不保存条码表单，不自动提交。</p><div className="mt-2 flex gap-2"><Button className="px-3" size="lg" disabled={returnAction.busy} onClick={() => void recoverRow(false)}>查询原归还结果</Button><Button className="px-3" size="lg" variant="outline" disabled={returnAction.busy || !returnAction.canRetry} onClick={() => void recoverRow(true)}>按原归还请求重试</Button></div></PdaCard>}
        {boxAction.error && <p role="alert" className="text-sm text-destructive-ink">{boxAction.error}</p>}
        {boxAction.pending && <PdaCard><p className="font-medium">拆箱结果待确认</p><p className="text-xs">{recoveredContext(boxAction.pending)}。刷新只允许查询原结果。</p><div className="mt-2 flex gap-2"><Button className="px-3" size="lg" disabled={boxAction.busy} onClick={() => void recoverBox(false)}>查询原拆箱结果</Button><Button className="px-3" size="lg" variant="outline" disabled={boxAction.busy || !boxAction.canRetry} onClick={() => void recoverBox(true)}>按原拆箱请求重试</Button></div></PdaCard>}
  </>

  if (isError || (!isLoading && !detail)) {
    return <div className="min-h-screen bg-background">
      <PdaHeader title="拣货退回确认" onBack={() => navigate('/pda/cancel-return')} />
      <div className="max-w-md mx-auto px-4 pt-6 space-y-4">{recoveryUI}<PdaQueryError onRetry={() => { void refetch() }} /></div>
    </div>
  }

  if (isLoading || !detail) {
    return (
      <div className="min-h-screen bg-background">
        <PdaHeader title="拣货退回确认" onBack={() => navigate('/pda/cancel-return')} />
        <div className="max-w-md mx-auto px-4 pt-6 space-y-4">{recoveryUI}<PdaLoading className="h-40 mt-8" /></div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <PdaHeader title="拣货退回确认" subtitle={detail.taskNo}
        backLabel="← 拣货退回" onBack={() => navigate('/pda/cancel-return')}
        right={<PdaRefreshButton onRefresh={() => refetch()} />} />

      <div className="max-w-md mx-auto flex-1 px-4 pb-8 space-y-4 py-4 w-full">
        {recoveryUI}

        <div className={`rounded-2xl border-2 px-4 py-3 text-center transition-all motion-reduce:transition-none ${
          scanning ? 'border-warning/30 bg-warning/10' :
          step === 'scan-container' ? 'border-primary/30 bg-primary/5' : 'border-success/30 bg-success/10'
        }`}>
          <p className="text-sm font-semibold text-foreground">
            {scanning ? <span className="inline-flex items-center gap-1"><Loader2 className="h-3.5 w-3.5 motion-safe:animate-spin" />处理中…</span> :
             step === 'scan-container' ? '扫描待归还库存条码，或待拆箱箱子条码' :
             `扫描原库位条码确认放回：${target?.suggestedLocationCode ?? ''}`}
          </p>
        </div>

        {target && step === 'scan-location' && (
          <PdaCard>
            <div className="space-y-2 text-sm">
              <p className="text-xs text-muted-foreground">必须放回原库位，系统仅接受下方指定库位的条码</p>
              <div className="rounded-xl bg-primary/5 border border-primary/20 p-4 text-center">
                <p className="text-3xl font-black text-primary tracking-widest">{target.suggestedLocationCode ?? '—'}</p>
                <p className="text-xs text-muted-foreground mt-1">请放回此库位</p>
              </div>
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground">商品</p>
                  <PdaProductIdentity code={target.barcode} name={target.productName} view="detail" />
                </div>
                <div className="shrink-0 text-right">
                  {target.quantitySource === 'active_pick' ? <><p className="font-bold text-primary">本任务应归还 {target.taskReturnQty}</p><p className="text-xs text-muted-foreground">条码账面 {target.remainingQty}</p></> : <><p className="text-xs text-muted-foreground">数量</p><p className="font-bold text-primary">{target.qty}</p></>}
                </div>
              </div>
              <button className="min-h-11 rounded-md px-2 text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => { setStep('scan-container'); setTarget(null) }}
              >← 取消，重新扫条码</button>
            </div>
          </PdaCard>
        )}

        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">待归还库存条码（{detail.containers.length}）</p>
          {detail.containers.length === 0 && detail.packages.length === 0 && (
            <PdaEmptyCard icon={<CircleCheck className="h-12 w-12 text-success-ink" />} title="已全部归还" description="任务即将自动取消" />
          )}
          <div className="space-y-2">
            {detail.containers.map(c => (
              <div key={c.containerId} className="rounded-xl border border-border bg-card p-3 flex items-center justify-between">
                <div className="min-w-0">
                  <PdaProductIdentity code={c.barcode} name={c.productName} view="detail" />
                </div>
                <div className="shrink-0 ml-2 text-right">{c.quantitySource === 'active_pick' ? <><p className="text-sm font-bold text-primary">本任务应归还 {c.taskReturnQty}</p><p className="text-xs text-muted-foreground">条码账面 {c.remainingQty}</p></> : <p className="text-sm font-bold text-primary">{c.qty}</p>}</div>
              </div>
            ))}
          </div>
        </div>

        {detail.packages.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">待拆箱箱子（{detail.packages.length}）</p>
            <p className="text-xs text-muted-foreground mb-2">这些箱子已经完成打包并打印过箱贴，需要人工拆箱后扫描箱子条码确认处理</p>
            <div className="space-y-2">
              {detail.packages.map(p => (
                <div key={p.packageId} className="rounded-xl border border-border bg-card p-3">
                  <div className="flex items-center justify-between">
                    <p className="font-mono text-xs font-semibold text-foreground">{p.barcode}</p>
                    <span className="text-xs text-muted-foreground">{p.items.length} 种商品</span>
                  </div>
                  <p className="text-xs text-muted-foreground min-w-0 whitespace-normal [overflow-wrap:anywhere] mt-1">
                    {p.items.map(i => `${i.productName ?? '—'} × ${i.qty}${i.unit ? ` ${i.unit}` : ''}`).join('、') || '（箱内无商品记录）'}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      <PdaBottomBar>
        <PdaScanner
          onScan={handleScan}
          placeholder={step === 'scan-location' ? `扫描原库位条码确认放回：${target?.suggestedLocationCode ?? ''}` : '扫描待归还库存条码或待拆箱箱子条码'}
          disabled={scanning || blocked}
          onDuplicate={() => err('重复扫码，请稍候')}
        />
      </PdaBottomBar>
    </div>
  )
}

export default function PdaCancelReturnPage() {
  const { id } = useParams<{ id?: string }>()
  const taskId = id ? Number(id) : 0
  if (!taskId) return <CancelReturnListPage />
  return <CancelReturnDetailPage key={taskId} taskId={taskId} />
}
