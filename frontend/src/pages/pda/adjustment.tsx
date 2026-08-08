/**
 * PDA 改单确认 — 销售单执行期改单，减量命中已拣/已打包实物时需要仓库物理确认
 * 路由：/pda/adjustments（任务池列表）、/pda/adjustments/:id（逐项扫码确认，:id 为改单记录ID）
 *
 * 镜像"取消清理"（cancel-return.tsx）的逐容器扫码归还 + 逐箱扫码拆箱确认结构：
 * 箱子在改单发起时已由系统作废（决策已在ERP侧做完），这里只是procedural确认物理已拆箱；
 * 容器归还需要额外扫目标库位条码，确认放回后才真正解锁容器、降低已拣数量。
 */
import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  getPendingAdjustmentsApi, getAdjustmentDetailApi,
  confirmAdjustmentPackageVoidApi, confirmAdjustmentContainerReturnApi,
  type AdjustmentPackageVoid, type AdjustmentContainerReturn,
} from '@/api/warehouse-tasks'
import { payloadClient as apiClient } from '@/api/client'
import PdaHeader, { PdaRefreshButton } from '@/components/pda/PdaHeader'
import PdaCard from '@/components/pda/PdaCard'
import PdaFlash from '@/components/pda/PdaFlash'
import { PdaEmptyCard, PdaLoading } from '@/components/pda/PdaEmptyState'
import { usePdaScanner } from '@/hooks/usePdaScanner'
import { usePdaFeedback } from '@/hooks/usePdaFeedback'
import { useCriticalPdaAction } from '@/hooks/useCriticalPdaAction'
import PdaCriticalActionNotice from '@/components/pda/PdaCriticalActionNotice'
import { formatPdaErrorMessage } from '@/utils/displayFormatters'
import { parseBarcode } from '@/utils/barcode'

interface LocationInfo { id: number; code: string }

// ── 列表：待处理的改单确认任务池 ──────────────────────────────────────────────
function AdjustmentListPage() {
  const navigate = useNavigate()
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['pda-adjustments-pending'],
    queryFn: () => getPendingAdjustmentsApi().then(r => r ?? []),
    refetchInterval: 15_000,
  })
  const tasks = data ?? []

  return (
    <div className="min-h-screen bg-background">
      <PdaHeader title="改单确认" subtitle="拆箱 / 归还库位确认" onBack={() => navigate('/pda')}
        right={<PdaRefreshButton onRefresh={() => refetch()} />} />
      <div className="max-w-md mx-auto px-4 py-5 space-y-4">
        <p className="text-xs text-muted-foreground">{tasks.length} 个任务待处理</p>
        {isLoading && <PdaLoading className="h-32" />}
        {!isLoading && tasks.length === 0 && (
          <PdaEmptyCard icon="✏️" title="暂无待确认改单" description="没有因订单修改而需要归还/拆箱的任务" />
        )}
        {tasks.map(t => (
          <PdaCard key={t.adjustmentId} onClick={() => navigate(`/pda/adjustments/${t.adjustmentId}`)}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-mono text-xs text-muted-foreground">{t.taskNo}</p>
                <p className="font-semibold text-foreground truncate">{t.customerName ?? '未知客户'}</p>
                <p className="text-sm text-muted-foreground mt-0.5">{t.warehouseName}</p>
              </div>
              <span className="shrink-0 rounded-full bg-orange-100 text-orange-700 text-xs font-bold px-2.5 py-1">
                待归还 {t.containerReturnsRemaining}{t.packageVoidsRemaining > 0 ? ` · 待拆箱 ${t.packageVoidsRemaining}` : ''}
              </span>
            </div>
          </PdaCard>
        ))}
      </div>
    </div>
  )
}

// ── 详情：逐箱拆箱确认 + 逐容器扫码归还 ────────────────────────────────────────
type Step = 'scan' | 'scan-location'

function AdjustmentDetailPage({ adjustmentId }: { adjustmentId: number }) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [step, setStep] = useState<Step>('scan')
  const [target, setTarget] = useState<AdjustmentContainerReturn | null>(null)
  const [voidTarget, setVoidTarget] = useState<AdjustmentPackageVoid | null>(null)
  const [scanning, setScanning] = useState(false)
  const { flash, ok, err, warn } = usePdaFeedback()

  const { data: detail, isLoading, refetch } = useQuery({
    queryKey: ['pda-adjustment-detail', adjustmentId],
    queryFn: () => getAdjustmentDetailApi(adjustmentId),
    enabled: adjustmentId > 0,
  })

  const pendingReturns = (detail?.items ?? []).flatMap(i => i.containerReturns.filter(r => r.status === 1))
  const pendingVoids = (detail?.items ?? []).flatMap(i => i.packageVoids.filter(v => v.status === 1))

  const returnAction = useCriticalPdaAction<{ finalized: boolean }>({
    action: `warehouse.adjustment-return.${adjustmentId}`,
    label: '改单归还扫码',
    onConfirmed: async () => {
      await qc.invalidateQueries({ queryKey: ['pda-adjustment-detail', adjustmentId] })
      await qc.invalidateQueries({ queryKey: ['pda-adjustments-pending'] })
    },
    resolveServerState: async () => {
      const latest = await getAdjustmentDetailApi(adjustmentId).catch(() => null)
      if (!latest) return { effective: false }
      const stillPending = latest.items.some(i => i.containerReturns.some(r => r.id === target?.id && r.status === 1))
      if (!stillPending) {
        return { effective: true, data: { finalized: !latest.items.some(i => i.containerReturns.some(r => r.status === 1) || i.packageVoids.some(v => v.status === 1)) }, message: '归还已生效，容器已不在待归还清单中。' }
      }
      return { effective: false }
    },
  })

  const voidAction = useCriticalPdaAction<{ finalized: boolean }>({
    action: `warehouse.adjustment-void.${adjustmentId}`,
    label: '改单拆箱确认',
    onConfirmed: async () => {
      await qc.invalidateQueries({ queryKey: ['pda-adjustment-detail', adjustmentId] })
      await qc.invalidateQueries({ queryKey: ['pda-adjustments-pending'] })
    },
    resolveServerState: async () => {
      const latest = await getAdjustmentDetailApi(adjustmentId).catch(() => null)
      if (!latest) return { effective: false }
      const stillPending = latest.items.some(i => i.packageVoids.some(v => v.id === voidTarget?.id && v.status === 1))
      if (!stillPending) {
        return { effective: true, data: { finalized: !latest.items.some(i => i.containerReturns.some(r => r.status === 1) || i.packageVoids.some(v => v.status === 1)) }, message: '拆箱确认已生效，箱子已不在待处理清单中。' }
      }
      return { effective: false }
    },
  })

  async function handleVoidScan(found: AdjustmentPackageVoid) {
    if (voidAction.submitBlocked) { err(voidAction.blockedReason || '当前不可提交'); return }
    setVoidTarget(found)
    setScanning(true)
    try {
      const submitted = await voidAction.run(
        (requestKey) => confirmAdjustmentPackageVoidApi(found.id, requestKey),
        { voidId: found.id },
      )
      if (submitted.kind === 'pending') {
        warn('网络中断，拆箱确认结果待确认。请先确认结果，再决定是否重扫。')
        return
      }
      if (submitted.data.finalized) {
        ok(`✓ 已确认拆箱 ${found.barcode}，该笔改单已全部处理完成`)
        await qc.invalidateQueries({ queryKey: ['pda-adjustments-pending'] })
        navigate('/pda/adjustments')
        return
      }
      ok(`✓ 已确认拆箱 ${found.barcode}`)
      await refetch()
    } catch (error: unknown) {
      err(formatPdaErrorMessage((error as { message?: string })?.message, '拆箱确认失败，请重试'))
    } finally {
      setScanning(false)
      setVoidTarget(null)
    }
  }

  function handleScan(raw: string) {
    const code = raw.trim()
    if (!code || !detail) return
    if (parseBarcode(code).type === 'box') {
      const found = pendingVoids.find(v => v.barcode.toUpperCase() === code.toUpperCase())
      if (!found) { err('该箱子不属于本次改单的待拆箱清单，请确认条码'); return }
      void handleVoidScan(found)
      return
    }
    const found = pendingReturns.find(r => r.barcode.toUpperCase() === code.toUpperCase())
    if (!found) { err('该容器不属于本次改单的待归还清单，请确认条码'); return }
    setTarget(found)
    setStep('scan-location')
  }

  async function handleLocationScan(raw: string) {
    const code = raw.trim()
    if (!code || !target) return
    if (returnAction.submitBlocked) { err(returnAction.blockedReason || '当前不可提交'); return }
    setScanning(true)
    try {
      const loc = await apiClient.get<LocationInfo>(`/locations/code/${encodeURIComponent(code)}`)
      const submitted = await returnAction.run(
        (requestKey) => confirmAdjustmentContainerReturnApi(target.id, loc.id, requestKey),
        { returnId: target.id },
      )
      if (submitted.kind === 'pending') {
        warn('网络中断，归还结果待确认。请先确认结果，再决定是否重扫。')
        return
      }
      if (submitted.data.finalized) {
        ok(`✓ 已归还到 ${loc.code}，该笔改单已全部处理完成`)
        await qc.invalidateQueries({ queryKey: ['pda-adjustments-pending'] })
        navigate('/pda/adjustments')
        return
      }
      ok(`✓ 已归还到 ${loc.code}`)
      await refetch()
    } catch (error: unknown) {
      err(formatPdaErrorMessage((error as { message?: string })?.message, '归还失败，请重试'))
    } finally {
      setScanning(false)
      setStep('scan')
      setTarget(null)
    }
  }

  usePdaScanner({
    onScan: (code) => {
      if (scanning) return
      if (step === 'scan-location') { void handleLocationScan(code); return }
      handleScan(code)
    },
    enabled: !scanning && !returnAction.submitBlocked && !voidAction.submitBlocked && !isLoading,
    onDuplicate: () => err('重复扫码，请稍候'),
  })

  if (isLoading || !detail) {
    return (
      <div className="min-h-screen bg-background">
        <PdaHeader title="改单确认" onBack={() => navigate('/pda/adjustments')} />
        <PdaLoading className="h-40 mt-8" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      <PdaHeader title="改单确认" subtitle={detail.taskNo}
        backLabel="← 改单确认" onBack={() => navigate('/pda/adjustments')}
        right={<PdaRefreshButton onRefresh={() => refetch()} />} />

      <div className="max-w-md mx-auto px-4 pb-32 space-y-4 py-4">
        <PdaFlash flash={flash} />
        <PdaCriticalActionNotice
          blockedReason={returnAction.blockedReason}
          pendingRecord={returnAction.pendingRecord}
          confirming={returnAction.confirming}
          phase={returnAction.phase}
          phaseMessage={returnAction.phaseMessage}
          lastErrorMessage={returnAction.lastErrorMessage}
          onConfirm={() => {
            void returnAction.confirmPending().then((status) => {
              if (!status) return
              if (status.status === 'pending') warn(formatPdaErrorMessage(status.message, '服务端仍未确认结果，请稍后再查'))
              if (status.status === 'state_unconfirmed') warn(formatPdaErrorMessage(status.message, '归还状态还未确认，请稍后再查'))
              if (status.status === 'not_found') warn(formatPdaErrorMessage(status.message, '未找到上次归还记录；请先刷新确认是否已落账，再决定是否重扫'))
              if (status.status === 'failed') err(formatPdaErrorMessage(status.message, '归还失败，请刷新后重试'))
            })
          }}
          onClear={() => returnAction.clearPending()}
          onDismissError={() => returnAction.clearError()}
        />
        <PdaCriticalActionNotice
          blockedReason={voidAction.blockedReason}
          pendingRecord={voidAction.pendingRecord}
          confirming={voidAction.confirming}
          phase={voidAction.phase}
          phaseMessage={voidAction.phaseMessage}
          lastErrorMessage={voidAction.lastErrorMessage}
          onConfirm={() => {
            void voidAction.confirmPending().then((status) => {
              if (!status) return
              if (status.status === 'pending') warn(formatPdaErrorMessage(status.message, '服务端仍未确认结果，请稍后再查'))
              if (status.status === 'state_unconfirmed') warn(formatPdaErrorMessage(status.message, '拆箱确认状态还未确认，请稍后再查'))
              if (status.status === 'not_found') warn(formatPdaErrorMessage(status.message, '未找到上次拆箱确认记录；请先刷新确认是否已落账，再决定是否重扫'))
              if (status.status === 'failed') err(formatPdaErrorMessage(status.message, '拆箱确认失败，请刷新后重试'))
            })
          }}
          onClear={() => voidAction.clearPending()}
          onDismissError={() => voidAction.clearError()}
        />

        <div className={`rounded-2xl border-2 px-4 py-3 text-center transition-all ${
          scanning ? 'border-yellow-400 bg-yellow-50' :
          step === 'scan' ? 'border-primary/30 bg-primary/5' : 'border-green-400/30 bg-green-50'
        }`}>
          <p className="text-sm font-semibold text-foreground">
            {scanning ? '⏳ 处理中…' :
             step === 'scan' ? '扫描待拆箱的箱子条码，或待归还的容器条码' :
             `扫描原库位条码确认放回：${target?.suggestedLocationCode ?? ''}`}
          </p>
        </div>

        {target && step === 'scan-location' && (
          <PdaCard>
            <div className="space-y-2 text-sm">
              <p className="text-xs text-muted-foreground">必须放回原库位，系统只接受扫描下方指定的库位条码</p>
              <div className="rounded-xl bg-primary/5 border border-primary/20 p-4 text-center">
                <p className="text-3xl font-black text-primary tracking-widest">{target.suggestedLocationCode ?? '—'}</p>
                <p className="text-xs text-muted-foreground mt-1">请放回此库位</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><p className="text-xs text-muted-foreground">容器</p><p className="font-semibold truncate">{target.barcode}</p></div>
                <div><p className="text-xs text-muted-foreground">数量</p><p className="font-bold text-primary">{target.qty}</p></div>
              </div>
              <button className="text-xs text-muted-foreground hover:text-foreground"
                onClick={() => { setStep('scan'); setTarget(null) }}
              >← 取消，重新扫描</button>
            </div>
          </PdaCard>
        )}

        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">待归还容器（{pendingReturns.length}）</p>
          {pendingReturns.length === 0 && pendingVoids.length === 0 && (
            <PdaEmptyCard icon="✅" title="已全部处理完成" description="改单即将自动生效" />
          )}
          <div className="space-y-2">
            {pendingReturns.map(r => (
              <div key={r.id} className="rounded-xl border border-border bg-card p-3 flex items-center justify-between">
                <p className="font-mono text-xs text-muted-foreground truncate">{r.barcode}</p>
                <p className="text-sm font-bold text-primary shrink-0 ml-2">{r.qty}</p>
              </div>
            ))}
          </div>
        </div>

        {pendingVoids.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">待拆箱箱子（{pendingVoids.length}）</p>
            <p className="text-xs text-muted-foreground mb-2">这些箱子因改单被作废，需要人工拆箱后扫描箱子条码确认处理</p>
            <div className="space-y-2">
              {pendingVoids.map(v => (
                <div key={v.id} className="rounded-xl border border-border bg-card p-3">
                  <div className="flex items-center justify-between">
                    <p className="font-mono text-xs font-semibold text-foreground">{v.barcode}</p>
                    <span className="text-xs text-muted-foreground">{v.otherProductsSnapshot.length > 0 ? `另有 ${v.otherProductsSnapshot.length} 种商品需重新装箱` : ''}</span>
                  </div>
                  {v.otherProductsSnapshot.length > 0 && (
                    <p className="text-xs text-muted-foreground truncate mt-1">
                      {v.otherProductsSnapshot.map(i => `${i.productName}×${i.qty}`).join('、')}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default function PdaAdjustmentPage() {
  const { id } = useParams<{ id?: string }>()
  const adjustmentId = id ? Number(id) : 0
  if (!adjustmentId) return <AdjustmentListPage />
  return <AdjustmentDetailPage adjustmentId={adjustmentId} />
}
