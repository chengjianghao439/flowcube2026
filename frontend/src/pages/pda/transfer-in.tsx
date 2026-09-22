import PdaProductIdentity from '@/components/pda/PdaProductIdentity'
/**
 * PDA 调拨 · 调入仓扫码入库 — 路由 /pda/transfer-in/:id
 * 两步：扫在途库存条码 → 扫目标库位 → POST /transfer/:id/scan-in（容器落库位、翻在库）。
 */
import { useCallback, useState } from 'react'
import { ArrowDownToLine, CircleCheck, Hourglass } from 'lucide-react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { parseBarcode } from '@/utils/barcode'
import { scanInTransferApi, type TransferScanResult } from '@/api/transfer'
import { getLocationByCodeApi } from '@/api/locations'
import PdaHeader from '@/components/pda/PdaHeader'
import PdaBottomBar from '@/components/pda/PdaBottomBar'
import PdaScanner from '@/components/pda/PdaScanner'
import PdaCard from '@/components/pda/PdaCard'
import PdaFlash from '@/components/pda/PdaFlash'
import PdaEmptyState, { PdaLoading } from '@/components/pda/PdaEmptyState'
import { SoftStatusLabel } from '@/components/shared/StatusBadge'
import { usePdaFeedback } from '@/hooks/usePdaFeedback'
import { useCriticalPdaAction } from '@/hooks/useCriticalPdaAction'
import { usePdaTransferInDetail } from '@/hooks/usePdaTransferIn'
import PdaCriticalActionNotice from '@/components/pda/PdaCriticalActionNotice'

export default function PdaTransferInPage() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { id } = useParams<{ id?: string }>()
  const transferId = id ? Number(id) : 0
  const { flash, ok, err, warn } = usePdaFeedback()

  // 两步扫码：先扫容器，再扫库位
  const [pendingContainer, setPendingContainer] = useState<string | null>(null)

  const { data: order, isLoading } = usePdaTransferInDetail(transferId)

  const scanAction = useCriticalPdaAction<TransferScanResult>({
    action: `transfer.scanIn.${transferId}`,
    requestAction: `transfer.scanIn.${transferId}`,
    label: `调拨单 ${transferId} 入库`,
    onConfirmed: async () => {
      await qc.invalidateQueries({ queryKey: ['pda-transfer', transferId] })
      await qc.invalidateQueries({ queryKey: ['pda-transfers'] })
    },
    // 调拨结果必须由绑定单据的回执确认；容器当前所在仓/库位不能证明本次操作成功。
  })

  const submitMut = useMutation({
    mutationFn: async ({ containerBarcode, locationId }: { containerBarcode: string; locationId: number }) => {
      return scanAction.run((requestKey) => scanInTransferApi(transferId, containerBarcode, locationId, requestKey).then(r => r!), { barcode: containerBarcode })
    },
    onSuccess: (result) => {
      setPendingContainer(null)
      if (result.kind === 'pending') { warn('网络中断，入库结果待确认。请先确认结果，避免重复扫码。'); return }
      if (result.data.completed) ok('调拨完成，全部入库')
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
      if (parsed.type !== 'container') { err('请先扫描在途库存条码'); return }
      setPendingContainer(b)
      ok('已扫条码，请扫目标库位')
      return
    }
    // 第二步：扫库位
    // 库位交给后端按「编码或条码」解析：现场标签可能是 R000123 条码，也可能是
    // 库位编码（如 SH-A01）。前端再用 R/LOC 前缀卡格式会把历史库位挡死
    //（2026-09-17 验收 ISSUE-018）；归属仓与状态仍由服务端校验。
    try {
      const loc = await getLocationByCodeApi(b)
      if (!loc?.id) { err(`库位不对：${b}，请重扫`); return }
      submitMut.mutate({ containerBarcode: pendingContainer, locationId: loc.id })
    } catch (e) {
      err((e as { message?: string })?.message ?? '库位查询失败')
    }
  }, [order, pendingContainer, submitMut, err, ok])

  if (!transferId) {
    return (
      <div className="min-h-screen bg-background">
        <PdaHeader title="调入仓扫码入库" onBack={() => navigate('/pda/transfer')} />
        <PdaEmptyState icon={<ArrowDownToLine className="h-12 w-12 text-muted-foreground" />} title="请选择调拨单" description="请从调拨执行列表进入待入库调拨。" actionText="返回调拨执行" onAction={() => navigate('/pda/transfer')} />
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
        <PdaEmptyState icon={order.status >= 4 ? <CircleCheck className="h-12 w-12 text-green-600" /> : <Hourglass className="h-12 w-12 text-muted-foreground" />} title={order.statusName}
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
                if (status.status === 'pending') warn(status.message || '系统还未确认结果，请稍后再查')
                if (status.status === 'not_found') warn(status.message || '未找到上次入库记录；请刷新后再决定是否重扫')
                if (status.status === 'failed') err(status.message || '上次入库未成功，请检查后重试')
              })
            }}
            onClear={() => scanAction.clearPending()}
            onDismissError={() => scanAction.clearError()}
          />

          <div className={`rounded-xl border px-3 py-2 text-sm ${pendingContainer ? 'border-primary/40 bg-primary/5 text-primary' : 'border-border bg-card text-muted-foreground'}`}>
            {pendingContainer ? `已扫条码 ${pendingContainer}，请扫目标库位` : '第一步：扫描在途库存条码'}
            {pendingContainer && (
              <button type="button" className="ml-2 underline" onClick={() => setPendingContainer(null)}>重扫</button>
            )}
          </div>

          {(order.items ?? []).map(item => (
            <PdaCard key={item.id}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <PdaProductIdentity code={item.productCode} name={item.productName} view="detail" />
                </div>
                <div className="text-right shrink-0 text-xs">
                  <p className="text-muted-foreground">计划 {item.quantity}</p>
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
          placeholder={pendingContainer ? '扫描目标库位条码' : '扫描在途库存条码'}
          disabled={submitMut.isPending || scanAction.submitBlocked}
          allowManualEntry={false}
        />
      </PdaBottomBar>
    </div>
  )
}
