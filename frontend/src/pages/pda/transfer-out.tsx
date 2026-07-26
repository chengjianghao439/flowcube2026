/**
 * PDA 调拨 · 调出仓扫码出库 — 路由 /pda/transfer-out/:id
 * 扫调出仓容器条码 → POST /transfer/:id/scan-out（整容器移到调入仓，标记在途）。
 */
import { useCallback } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getTransferDetailApi, scanOutTransferApi, type TransferScanResult } from '@/api/transfer'
import PdaHeader from '@/components/pda/PdaHeader'
import PdaBottomBar from '@/components/pda/PdaBottomBar'
import PdaScanner from '@/components/pda/PdaScanner'
import PdaCard from '@/components/pda/PdaCard'
import PdaFlash from '@/components/pda/PdaFlash'
import PdaEmptyState, { PdaLoading } from '@/components/pda/PdaEmptyState'
import { SoftStatusLabel } from '@/components/shared/StatusBadge'
import { usePdaFeedback } from '@/hooks/usePdaFeedback'
import { useCriticalPdaAction } from '@/hooks/useCriticalPdaAction'
import PdaCriticalActionNotice from '@/components/pda/PdaCriticalActionNotice'

export default function PdaTransferOutPage() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { id } = useParams<{ id?: string }>()
  const transferId = id ? Number(id) : 0
  const { flash, ok, err, warn } = usePdaFeedback()

  const { data: order, isLoading } = useQuery({
    queryKey: ['pda-transfer', transferId],
    queryFn: () => getTransferDetailApi(transferId),
    enabled: transferId > 0,
  })

  const scanAction = useCriticalPdaAction<TransferScanResult>({
    action: `transfer.scanOut.${transferId}`,
    requestAction: 'transfer.scanOut',
    label: `调拨单 ${transferId} 出库`,
    onConfirmed: async () => {
      await qc.invalidateQueries({ queryKey: ['pda-transfer', transferId] })
      await qc.invalidateQueries({ queryKey: ['pda-transfers'] })
    },
  })

  const scanMut = useMutation({
    mutationFn: async (barcode: string) => {
      const result = await scanAction.run((requestKey) => scanOutTransferApi(transferId, barcode, requestKey).then(r => r!))
      return result
    },
    onSuccess: (result) => {
      if (result.kind === 'pending') { warn('网络中断，出库结果待确认。请先确认结果，避免重复扫码。'); return }
      ok(`✓ 已出库 ${result.data.productName ?? ''} ×${result.data.qty}`)
    },
    onError: (e: unknown) => err((e as { message?: string })?.message ?? '出库失败'),
  })

  const handleScan = useCallback((raw: string) => {
    const b = raw.trim()
    if (!b) return
    if (!order) { err('调拨单加载中，请稍后扫码'); return }
    if (order.status !== 2 && order.status !== 3) { err(`当前状态「${order.statusName}」不能扫码出库`); return }
    scanMut.mutate(b)
  }, [order, scanMut, err])

  if (!transferId) {
    return (
      <div className="min-h-screen bg-background">
        <PdaHeader title="调出仓扫码出库" onBack={() => navigate('/pda/transfer')} />
        <PdaEmptyState icon="📤" title="请选择调拨单" description="请从调拨执行列表进入待出库调拨。" actionText="返回调拨执行" onAction={() => navigate('/pda/transfer')} />
      </div>
    )
  }
  if (isLoading || !order) {
    return (
      <div className="min-h-screen bg-background">
        <PdaHeader title="调出仓扫码出库" onBack={() => navigate('/pda/transfer')} />
        <PdaLoading className="h-40 mt-8" />
      </div>
    )
  }
  if (order.status !== 2 && order.status !== 3) {
    return (
      <div className="min-h-screen bg-background">
        <PdaHeader title="调出仓扫码出库" onBack={() => navigate('/pda/transfer')} />
        <PdaEmptyState icon={order.status >= 4 ? '✅' : '⏳'} title={order.statusName}
          description={order.status === 1 ? '调拨单尚未派发，请先在 ERP 确认派发。' : '该调拨单不在待出库状态。'}
          actionText="返回调拨执行" onAction={() => navigate('/pda/transfer')} />
      </div>
    )
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <PdaHeader
        title="调出仓扫码出库"
        subtitle={`${order.orderNo} · ${order.fromWarehouseName} → ${order.toWarehouseName}`}
        onBack={() => navigate('/pda/transfer')}
        right={<SoftStatusLabel label={`调出仓：${order.fromWarehouseName}`} tone="info" />}
      />
      <PdaFlash flash={flash} />

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-md mx-auto px-4 py-4 space-y-3">
          <PdaCriticalActionNotice
            blockedReason={scanAction.blockedReason}
            pendingRecord={scanAction.pendingRecord}
            confirming={scanAction.confirming}
            phase={scanAction.phase}
            phaseMessage={scanAction.phaseMessage}
            lastErrorMessage={scanAction.lastErrorMessage}
            onConfirm={() => {
              void scanAction.confirmPending().then((status) => {
                if (!status) return
                if (status.status === 'pending') warn(status.message || '服务端仍未确认结果，请稍后再查')
                if (status.status === 'not_found') warn(status.message || '未找到上次出库记录；请刷新后再决定是否重扫')
                if (status.status === 'failed') err(status.message || '上次出库未成功，请检查后重试')
              })
            }}
            onClear={() => scanAction.clearPending()}
            onDismissError={() => scanAction.clearError()}
          />

          <p className="text-xs text-muted-foreground">扫描调出仓容器条码，整容器调拨出库</p>
          {(order.items ?? []).map(item => (
            <PdaCard key={item.id}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium text-foreground truncate">{item.productName}</p>
                  <p className="text-xs font-mono text-muted-foreground">{item.productCode}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-xs text-muted-foreground">计划 {item.quantity}</p>
                  <p className="text-sm font-semibold text-amber-600">已出库 {item.deductedQty ?? 0}</p>
                </div>
              </div>
            </PdaCard>
          ))}
        </div>
      </div>

      <PdaBottomBar>
        <PdaScanner onScan={handleScan} placeholder="扫描调出仓容器条码" disabled={scanMut.isPending || scanAction.submitBlocked} allowManualEntry={false} />
      </PdaBottomBar>
    </div>
  )
}
