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
  getCancelReturnDetailApi,
  submitCancelReturnScanApi,
  submitCancelReturnBoxScanApi,
  type CancelReturnContainer, type CancelReturnPackage,
} from '@/api/warehouse-tasks'
import { getLocationByCodeApi } from '@/api/locations'
import PdaHeader, { PdaRefreshButton } from '@/components/pda/PdaHeader'
import PdaCard from '@/components/pda/PdaCard'
import PdaFlash from '@/components/pda/PdaFlash'
import { PdaEmptyCard, PdaLoading } from '@/components/pda/PdaEmptyState'
import { usePdaScanner } from '@/hooks/usePdaScanner'
import { usePdaFeedback } from '@/hooks/usePdaFeedback'
import { useCriticalPdaAction } from '@/hooks/useCriticalPdaAction'
import { usePdaPendingCancelReturns, usePdaCancelReturnDetail } from '@/hooks/usePdaCancelReturn'
import PdaCriticalActionNotice from '@/components/pda/PdaCriticalActionNotice'
import { formatPdaErrorMessage } from '@/utils/displayFormatters'
import { parseBarcode } from '@/utils/barcode'

// ── 列表：待处理的拣货退回任务池 ──────────────────────────────────────────────
function CancelReturnListPage() {
  const navigate = useNavigate()
  const { data, isLoading, refetch } = usePdaPendingCancelReturns()
  const tasks = data ?? []

  return (
    <div className="min-h-screen bg-background">
      <PdaHeader title="拣货退回" subtitle="逆向归还已拣容器" onBack={() => navigate('/pda')}
        right={<PdaRefreshButton onRefresh={() => refetch()} />} />
      <div className="max-w-md mx-auto px-4 py-5 space-y-4">
        <p className="text-xs text-muted-foreground">{tasks.length} 个任务待归还</p>
        {isLoading && <PdaLoading className="h-32" />}
        {!isLoading && tasks.length === 0 && (
          <PdaEmptyCard icon={<PackageX className="h-12 w-12 text-muted-foreground" />} title="暂无待归还任务" description="没有因订单取消而需要归还货物的任务" />
        )}
        {tasks.map(t => (
          <PdaCard key={t.id} className="w-full" onClick={() => navigate(`/pda/cancel-return/${t.id}`)}>
            <div className="space-y-2">
              <div className="flex items-start justify-between gap-3">
                <p className="font-mono text-xs text-muted-foreground min-w-0 truncate">{t.taskNo}</p>
                <SoftStatusLabel
                  label={`待归还 ${t.containersRemaining}${t.packagesRemaining > 0 ? ` · 待拆箱 ${t.packagesRemaining}` : ''}`}
                  tone="warning"
                  className="shrink-0"
                />
              </div>
              <p className="font-semibold text-foreground truncate">{t.customerName ?? '未知客户'}</p>
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
  const [boxTarget, setBoxTarget] = useState<CancelReturnPackage | null>(null)
  const [scanning, setScanning] = useState(false)
  const { flash, ok, err, warn } = usePdaFeedback()

  const { data: detail, isLoading, refetch } = usePdaCancelReturnDetail(taskId)

  const returnAction = useCriticalPdaAction<{ id: number; remaining: number; finalized: boolean }>({
    action: `warehouse.cancel-return.${taskId}`,
    label: '拣货退回扫码',
    onConfirmed: async () => {
      await qc.invalidateQueries({ queryKey: ['pda-cancel-return-detail', taskId] })
      await qc.invalidateQueries({ queryKey: ['pda-cancel-returns-pending'] })
    },
    resolveServerState: async () => {
      // 归还是否生效，看该容器是否还在待归还清单里即可核实，不需要额外查询接口。
      const latest = await getCancelReturnDetailApi(taskId).catch(() => null)
      if (!latest) return { effective: false }
      const stillPending = latest.containers.some(c => c.containerId === target?.containerId)
      if (!stillPending) {
        return {
          effective: true,
          data: { id: 0, remaining: latest.containers.length, finalized: latest.containers.length === 0 },
          message: '归还已生效，容器已不在待归还清单中。',
        }
      }
      return { effective: false }
    },
  })

  const boxAction = useCriticalPdaAction<{ id: number; containersRemaining: number; packagesRemaining: number; finalized: boolean }>({
    action: `warehouse.cancel-return-box.${taskId}`,
    label: '拣货退回拆箱确认',
    onConfirmed: async () => {
      await qc.invalidateQueries({ queryKey: ['pda-cancel-return-detail', taskId] })
      await qc.invalidateQueries({ queryKey: ['pda-cancel-returns-pending'] })
    },
    resolveServerState: async () => {
      // 拆箱确认是否生效，看该箱子是否还在待处理清单里即可核实，不需要额外查询接口。
      const latest = await getCancelReturnDetailApi(taskId).catch(() => null)
      if (!latest) return { effective: false }
      const stillPending = latest.packages.some(p => p.packageId === boxTarget?.packageId)
      if (!stillPending) {
        return {
          effective: true,
          data: {
            id: 0,
            containersRemaining: latest.containers.length,
            packagesRemaining: latest.packages.length,
            finalized: latest.containers.length === 0 && latest.packages.length === 0,
          },
          message: '拆箱确认已生效，箱子已不在待处理清单中。',
        }
      }
      return { effective: false }
    },
  })

  async function handleBoxScan(raw: string) {
    const code = raw.trim()
    if (!code || !detail) return
    const found = detail.packages.find(p => p.barcode.toUpperCase() === code.toUpperCase())
    if (!found) { err('该箱子不属于本任务的待拆箱清单，请确认条码'); return }
    if (boxAction.submitBlocked) { err(boxAction.blockedReason || '当前不可提交'); return }
    setBoxTarget(found)
    setScanning(true)
    try {
      const submitted = await boxAction.run(
        (requestKey) => submitCancelReturnBoxScanApi(taskId, found.packageId, found.barcode, requestKey),
        { packageId: found.packageId },
      )
      if (submitted.kind === 'pending') {
        warn('网络中断，拆箱确认结果待确认。请先确认结果，再决定是否重扫。')
        return
      }
      const result = submitted.data
      if (result.finalized) {
        ok(`✓ 已确认拆箱 ${found.barcode}，任务全部处理完成，已取消`)
        await qc.invalidateQueries({ queryKey: ['pda-cancel-returns-pending'] })
        navigate('/pda/cancel-return')
        return
      }
      ok(`✓ 已确认拆箱 ${found.barcode}，剩余 ${result.containersRemaining} 个容器 / ${result.packagesRemaining} 个箱子待处理`)
      await refetch()
    } catch (error: unknown) {
      err(formatPdaErrorMessage((error as { message?: string })?.message, '拆箱确认失败，请重试'))
    } finally {
      setScanning(false)
      setBoxTarget(null)
    }
  }

  function handleContainerScan(raw: string) {
    const code = raw.trim()
    if (!code || !detail) return
    const found = detail.containers.find(c => c.barcode.toUpperCase() === code.toUpperCase())
    if (!found) { err('该容器不属于本任务的待归还清单，请确认条码'); return }
    setTarget(found)
    setStep('scan-location')
  }

  async function handleLocationScan(raw: string) {
    const code = raw.trim()
    if (!code || !target) return
    if (returnAction.submitBlocked) { err(returnAction.blockedReason || '当前不可提交'); return }
    setScanning(true)
    try {
      const loc = await getLocationByCodeApi(code)
      if (!loc) { err('库位不存在'); return }
      const submitted = await returnAction.run(
        (requestKey) => submitCancelReturnScanApi(taskId, target.containerId, target.barcode, loc.id, requestKey),
        { containerId: target.containerId },
      )
      if (submitted.kind === 'pending') {
        warn('网络中断，归还结果待确认。请先确认结果，再决定是否重扫。')
        return
      }
      const result = submitted.data
      if (result.finalized) {
        ok(`✓ 已归还到 ${loc.code}，任务全部归还完成，已取消`)
        await qc.invalidateQueries({ queryKey: ['pda-cancel-returns-pending'] })
        navigate('/pda/cancel-return')
        return
      }
      ok(`✓ 已归还到 ${loc.code}，剩余 ${result.remaining} 个容器待归还`)
      await refetch()
    } catch (error: unknown) {
      err(formatPdaErrorMessage((error as { message?: string })?.message, '归还失败，请重试'))
    } finally {
      setScanning(false)
      setStep('scan-container')
      setTarget(null)
    }
  }

  usePdaScanner({
    onScan: (code) => {
      if (scanning) return
      if (step === 'scan-location') { void handleLocationScan(code); return }
      // 待归还容器和待拆箱箱子共用同一个扫码入口，按条码类型自动分流：
      // 箱子条码（L/BOX 前缀）直接确认拆箱，其它一律当容器条码处理。
      if (parseBarcode(code).type === 'box') { void handleBoxScan(code); return }
      handleContainerScan(code)
    },
    enabled: !scanning && !returnAction.submitBlocked && !boxAction.submitBlocked && !isLoading,
    onDuplicate: () => err('重复扫码，请稍候'),
  })

  if (isLoading || !detail) {
    return (
      <div className="min-h-screen bg-background">
        <PdaHeader title="拣货退回确认" onBack={() => navigate('/pda/cancel-return')} />
        <PdaLoading className="h-40 mt-8" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      <PdaHeader title="拣货退回确认" subtitle={detail.taskNo}
        backLabel="← 拣货退回" onBack={() => navigate('/pda/cancel-return')}
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
          blockedReason={boxAction.blockedReason}
          pendingRecord={boxAction.pendingRecord}
          confirming={boxAction.confirming}
          phase={boxAction.phase}
          phaseMessage={boxAction.phaseMessage}
          lastErrorMessage={boxAction.lastErrorMessage}
          onConfirm={() => {
            void boxAction.confirmPending().then((status) => {
              if (!status) return
              if (status.status === 'pending') warn(formatPdaErrorMessage(status.message, '服务端仍未确认结果，请稍后再查'))
              if (status.status === 'state_unconfirmed') warn(formatPdaErrorMessage(status.message, '拆箱确认状态还未确认，请稍后再查'))
              if (status.status === 'not_found') warn(formatPdaErrorMessage(status.message, '未找到上次拆箱确认记录；请先刷新确认是否已落账，再决定是否重扫'))
              if (status.status === 'failed') err(formatPdaErrorMessage(status.message, '拆箱确认失败，请刷新后重试'))
            })
          }}
          onClear={() => boxAction.clearPending()}
          onDismissError={() => boxAction.clearError()}
        />

        <div className={`rounded-2xl border-2 px-4 py-3 text-center transition-all ${
          scanning ? 'border-yellow-400 bg-yellow-50' :
          step === 'scan-container' ? 'border-primary/30 bg-primary/5' : 'border-green-400/30 bg-green-50'
        }`}>
          <p className="text-sm font-semibold text-foreground">
            {scanning ? <span className="inline-flex items-center gap-1"><Loader2 className="h-3.5 w-3.5 animate-spin" />处理中…</span> :
             step === 'scan-container' ? '扫描待归还容器条码，或待拆箱箱子条码' :
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
                  <p className="font-semibold truncate">{target.productName ?? '—'}</p>
                  <p className="font-mono text-xs text-muted-foreground truncate mt-0.5">{target.barcode}</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-xs text-muted-foreground">数量</p>
                  <p className="font-bold text-primary">{target.qty}</p>
                </div>
              </div>
              <button className="text-xs text-muted-foreground hover:text-foreground"
                onClick={() => { setStep('scan-container'); setTarget(null) }}
              >← 取消，重新扫容器</button>
            </div>
          </PdaCard>
        )}

        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">待归还容器（{detail.containers.length}）</p>
          {detail.containers.length === 0 && detail.packages.length === 0 && (
            <PdaEmptyCard icon={<CircleCheck className="h-12 w-12 text-green-600" />} title="已全部归还" description="任务即将自动取消" />
          )}
          <div className="space-y-2">
            {detail.containers.map(c => (
              <div key={c.containerId} className="rounded-xl border border-border bg-card p-3 flex items-center justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{c.productName ?? '—'}</p>
                  <p className="font-mono text-xs text-muted-foreground truncate">{c.barcode}</p>
                </div>
                <p className="text-sm font-bold text-primary shrink-0 ml-2">{c.qty}</p>
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
                  <p className="text-xs text-muted-foreground truncate mt-1">
                    {p.items.map(i => `${i.productName ?? '—'} × ${i.qty}${i.unit ? ` ${i.unit}` : ''}`).join('、') || '（箱内无商品记录）'}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default function PdaCancelReturnPage() {
  const { id } = useParams<{ id?: string }>()
  const taskId = id ? Number(id) : 0
  if (!taskId) return <CancelReturnListPage />
  return <CancelReturnDetailPage taskId={taskId} />
}
