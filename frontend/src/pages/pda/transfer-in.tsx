/**
 * PDA 调拨 · 调入仓扫码入库 — 路由 /pda/transfer-in/:id
 * 两步：扫在途容器条码 → 扫目标库位 → POST /transfer/:id/scan-in（容器落库位、翻在库）。
 */
import { useCallback, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { payloadClient } from '@/api/client'
import { parseBarcode } from '@/utils/barcode'
import { getTransferDetailApi, scanInTransferApi, type TransferScanResult } from '@/api/transfer'
import { getContainerByBarcodeApi } from '@/api/inventory'
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

export default function PdaTransferInPage() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { id } = useParams<{ id?: string }>()
  const transferId = id ? Number(id) : 0
  const { flash, ok, err, warn } = usePdaFeedback()

  // 两步扫码：先扫容器，再扫库位
  const [pendingContainer, setPendingContainer] = useState<string | null>(null)

  const { data: order, isLoading } = useQuery({
    queryKey: ['pda-transfer', transferId],
    queryFn: () => getTransferDetailApi(transferId),
    enabled: transferId > 0,
  })

  const scanAction = useCriticalPdaAction<TransferScanResult>({
    action: `transfer.scanIn.${transferId}`,
    requestAction: 'transfer.scanIn',
    label: `调拨单 ${transferId} 入库`,
    onConfirmed: async () => {
      await qc.invalidateQueries({ queryKey: ['pda-transfer', transferId] })
      await qc.invalidateQueries({ queryKey: ['pda-transfers'] })
    },
    // 断网重连的第二道兜底：回执查不到时，按扫过的容器条码回查它是否已入库上架
    // （scanIn 成功后容器翻在库 stored 并落库位）。保守判定，查不到/异常保持待确认。
    resolveServerState: async ({ record }) => {
      const barcode = String(record.metadata?.barcode ?? '')
      if (!barcode) return { effective: false as const }
      try {
        const c = await getContainerByBarcodeApi(barcode)
        if (c && c.containerStatus === 'stored' && c.locationId != null) {
          return { effective: true as const, message: `容器 ${barcode} 已入库上架，入库已成功。` }
        }
      } catch { /* 查不到或异常：保持待确认 */ }
      return { effective: false as const }
    },
  })

  const submitMut = useMutation({
    mutationFn: async ({ containerBarcode, locationId }: { containerBarcode: string; locationId: number }) => {
      return scanAction.run((requestKey) => scanInTransferApi(transferId, containerBarcode, locationId, requestKey).then(r => r!), { barcode: containerBarcode })
    },
    onSuccess: (result) => {
      setPendingContainer(null)
      if (result.kind === 'pending') { warn('网络中断，入库结果待确认。请先确认结果，避免重复扫码。'); return }
      if (result.data.completed) ok('✅ 调拨完成，全部入库')
      else ok(`✓ 已入库 ${result.data.productName ?? ''} ×${result.data.qty}`)
    },
    onError: (e: unknown) => err((e as { message?: string })?.message ?? '入库失败'),
  })

  const handleScan = useCallback(async (raw: string) => {
    const b = raw.trim()
    if (!b) return
    if (!order) { err('调拨单加载中，请稍后扫码'); return }
    if (order.status !== 3) { err(`当前状态「${order.statusName}」不能扫码入库`); return }
    const parsed = parseBarcode(b)
    if (!pendingContainer) {
      // 第一步：扫容器
      if (parsed.type !== 'container') { err('请先扫描在途容器条码'); return }
      setPendingContainer(b)
      ok('已扫容器，请扫目标库位')
      return
    }
    // 第二步：扫库位
    if (parsed.type !== 'location') { err('请扫描目标库位条码'); return }
    try {
      const loc = await payloadClient.get<{ id: number }>(`/locations/code/${encodeURIComponent(b)}`)
      if (!loc?.id) { err('库位不存在'); return }
      submitMut.mutate({ containerBarcode: pendingContainer, locationId: loc.id })
    } catch (e) {
      err((e as { message?: string })?.message ?? '库位查询失败')
    }
  }, [order, pendingContainer, submitMut, err, ok])

  if (!transferId) {
    return (
      <div className="min-h-screen bg-background">
        <PdaHeader title="调入仓扫码入库" onBack={() => navigate('/pda/transfer')} />
        <PdaEmptyState icon="📥" title="请选择调拨单" description="请从调拨执行列表进入待入库调拨。" actionText="返回调拨执行" onAction={() => navigate('/pda/transfer')} />
      </div>
    )
  }
  if (isLoading || !order) {
    return (
      <div className="min-h-screen bg-background">
        <PdaHeader title="调入仓扫码入库" onBack={() => navigate('/pda/transfer')} />
        <PdaLoading className="h-40 mt-8" />
      </div>
    )
  }
  if (order.status !== 3) {
    return (
      <div className="min-h-screen bg-background">
        <PdaHeader title="调入仓扫码入库" onBack={() => navigate('/pda/transfer')} />
        <PdaEmptyState icon={order.status >= 4 ? '✅' : '⏳'} title={order.statusName}
          description={order.status < 3 ? '尚未出库，请先由调出仓扫码出库。' : '该调拨单不在待入库状态。'}
          actionText="返回调拨执行" onAction={() => navigate('/pda/transfer')} />
      </div>
    )
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <PdaHeader
        title="调入仓扫码入库"
        subtitle={`${order.orderNo} · ${order.fromWarehouseName} → ${order.toWarehouseName}`}
        onBack={() => navigate('/pda/transfer')}
        right={<SoftStatusLabel label={`调入仓：${order.toWarehouseName}`} tone="info" />}
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
                if (status.status === 'not_found') warn(status.message || '未找到上次入库记录；请刷新后再决定是否重扫')
                if (status.status === 'failed') err(status.message || '上次入库未成功，请检查后重试')
              })
            }}
            onClear={() => scanAction.clearPending()}
            onDismissError={() => scanAction.clearError()}
          />

          <div className={`rounded-xl border px-3 py-2 text-sm ${pendingContainer ? 'border-primary/40 bg-primary/5 text-primary' : 'border-border bg-card text-muted-foreground'}`}>
            {pendingContainer ? `已扫容器 ${pendingContainer}，请扫目标库位` : '第一步：扫描在途容器条码'}
            {pendingContainer && (
              <button type="button" className="ml-2 underline" onClick={() => setPendingContainer(null)}>重扫</button>
            )}
          </div>

          {(order.items ?? []).map(item => (
            <PdaCard key={item.id}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium text-foreground truncate">{item.productName}</p>
                  <p className="text-xs font-mono text-muted-foreground">{item.productCode}</p>
                </div>
                <div className="text-right shrink-0 text-xs">
                  <p className="text-muted-foreground">已出库 {item.deductedQty ?? 0}</p>
                  <p className="font-semibold text-emerald-600">已入库 {item.receivedQty ?? 0}</p>
                </div>
              </div>
            </PdaCard>
          ))}
        </div>
      </div>

      <PdaBottomBar>
        <PdaScanner
          onScan={handleScan}
          placeholder={pendingContainer ? '扫描目标库位条码' : '扫描在途容器条码'}
          disabled={submitMut.isPending || scanAction.submitBlocked}
          allowManualEntry={false}
        />
      </PdaBottomBar>
    </div>
  )
}
