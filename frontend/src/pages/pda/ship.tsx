/**
 * PDA 出库确认  /pda/ship
 * 无感操作：扫箱号 → 自动查询 → 自动出库，无需额外确认按钮
 */
import { useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import { parseBarcode } from '@/utils/barcode'
import PdaScanner from '@/components/pda/PdaScanner'
import PdaHeader from '@/components/pda/PdaHeader'
import PdaCard from '@/components/pda/PdaCard'
import PdaSection from '@/components/pda/PdaSection'
import PdaBottomBar from '@/components/pda/PdaBottomBar'
import PdaFlash from '@/components/pda/PdaFlash'
import { PdaLoading } from '@/components/pda/PdaEmptyState'
import PdaStat, { PdaStatGrid } from '@/components/pda/PdaStat'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { getPackageByBarcodeApi } from '@/api/packages'
import { shipTaskApi } from '@/api/warehouse-tasks'
import { WT_STATUS } from '@/constants/warehouseTaskStatus'
import type { PackageShipInfo } from '@/api/packages'
import { usePdaFeedback } from '@/hooks/usePdaFeedback'

export default function PdaShipPage() {
  const navigate = useNavigate()
  const { flash, ok, err } = usePdaFeedback()
  const [info, setInfo]       = useState<PackageShipInfo | null>(null)
  const [loading, setLoading] = useState(false)
  const [done, setDone]       = useState(false)

  const shipMut = useMutation({
    mutationFn: (taskId: number) => shipTaskApi(taskId),
    onSuccess: () => { ok('出库成功！'); setDone(true) },
    onError: (e: unknown) =>
      err((e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? '出库失败'),
  })

  // 扫码后自动查询并立即出库，无需额外确认按钮
  const handleScan = useCallback(async (raw: string) => {
    const parsed = parseBarcode(raw)
    if (parsed.type !== 'box') { err('必须扫描箱号条码（BOXxxxxxx）'); return }
    setLoading(true)
    try {
      const res  = await getPackageByBarcodeApi(raw)
      const data = res.data.data!
      if (data.taskStatus === WT_STATUS.SHIPPED)   { err('该订单已完成出库'); return }
      if (data.taskStatus === WT_STATUS.CANCELLED) { err('该任务已取消'); return }
      setInfo(data)
      // 自动触发出库，无需用户再次确认
      shipMut.mutate(data.warehouseTaskId)
    } catch (e: unknown) {
      err((e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? '箱号不存在')
    } finally { setLoading(false) }
  }, [err, shipMut])

  if (done && info) return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-6 text-center">
      <div className="text-6xl mb-6">🚚</div>
      <h2 className="text-2xl font-bold text-foreground">出库完成！</h2>
      <p className="text-muted-foreground mt-2 mb-1">订单 <span className="font-mono font-semibold text-foreground">{info.taskNo}</span></p>
      <p className="text-muted-foreground mb-8">{info.customerName} 已完成发货</p>
      <div className="flex gap-3 w-full max-w-xs">
        <Button variant="outline" className="flex-1" onClick={() => { setInfo(null); setDone(false) }}>继续出库</Button>
        <Button className="flex-1" onClick={() => navigate('/pda')}>返回工作台</Button>
      </div>
    </div>
  )

  const mergedItems = (() => {
    if (!info) return []
    const map: Record<string, { productCode: string; productName: string; unit: string; qty: number }> = {}
    info.packages.forEach(pkg => pkg.items.forEach(item => {
      if (map[item.productCode]) map[item.productCode].qty += item.qty
      else map[item.productCode] = { ...item }
    }))
    return Object.values(map)
  })()

  const totalQty   = mergedItems.reduce((s, i) => s + i.qty, 0)
  const totalBoxes = info?.packages.length ?? 0
  // BODY_SPLIT
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <PdaHeader title="出库确认" onBack={() => navigate('/pda')} />

      <PdaFlash flash={flash} />

      <div className="flex-1 overflow-y-auto pb-40">
        <div className="max-w-md mx-auto px-4 py-5 space-y-4">

          {/* 扫码区移至底栏，此处保留加载状态 */}
          {loading && <div className="flex items-center justify-center gap-2 py-1"><PdaLoading size={16} /><span className="text-xs text-muted-foreground">查询中…</span></div>}

          {info && (
            <>
              {/* 订单信息 */}
              <PdaSection title="订单信息">
                <div className="flex items-center justify-between -mt-1 mb-1">
                  <span />
                  <Badge className="bg-orange-100 text-orange-700 border-orange-200 text-xs">待出库</Badge>
                </div>
                <PdaStatGrid cols={2}>
                  <PdaStat label="任务号" value={info.taskNo} />
                  <PdaStat label="客户" value={info.customerName} />
                  <PdaStat label="仓库" value={info.warehouseName} />
                  <PdaStat label="箱数/总件" value={`${totalBoxes}箱/${totalQty.toFixed(0)}件`} accent />
                </PdaStatGrid>
              </PdaSection>

              {/* 商品明细 */}
              <div className="rounded-2xl bg-card border border-border p-4">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">装箱商品（{mergedItems.length} 种）</p>
                {mergedItems.length === 0
                  ? <p className="text-sm text-muted-foreground text-center py-4">暂无商品明细</p>
                  : mergedItems.map(item => (
                      <div key={item.productCode} className="flex items-center justify-between py-2 border-b border-border/50 last:border-0">
                        <div className="min-w-0">
                          <p className="font-medium text-foreground text-sm truncate">{item.productName}</p>
                          <p className="text-xs font-mono text-muted-foreground">{item.productCode}</p>
                        </div>
                        <p className="font-bold text-primary shrink-0 ml-3">{item.qty}<span className="text-xs font-normal text-muted-foreground ml-0.5">{item.unit}</span></p>
                      </div>
                    ))
                }
              </div>

              {/* 箱子列表 */}
              <div className="rounded-2xl bg-card border border-border p-4">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">箱子列表（{totalBoxes} 箱）</p>
                <div className="space-y-1.5">
                  {info.packages.map(pkg => (
                    <div key={pkg.id} className={`flex items-center justify-between rounded-xl px-3 py-2 ${
                      pkg.barcode === info.barcode ? 'bg-primary/10 border border-primary/30' : 'bg-muted/20'
                    }`}>
                      <div className="flex items-center gap-2">
                        <span className="text-sm">{pkg.status === 2 ? '✅' : '📦'}</span>
                        <p className="font-mono text-sm font-semibold text-foreground">{pkg.barcode}</p>
                        {pkg.barcode === info.barcode && <Badge className="text-xs">当前</Badge>}
                      </div>
                      <p className="text-xs text-muted-foreground">{pkg.items.reduce((s, i) => s + i.qty, 0).toFixed(0)} 件</p>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      <PdaBottomBar>
        {info ? (
          <PdaCard className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">{info.taskNo} · {info.customerName}</span>
            <span className="text-sm font-bold text-foreground">{totalBoxes} 箱</span>
          </PdaCard>
        ) : (
          <p className="text-center text-sm text-muted-foreground py-2">扫描箱号后自动完成出库</p>
        )}
        <PdaScanner onScan={handleScan} placeholder="扫描箱号 BOXxxxxxx" disabled={loading || shipMut.isPending} />
        {loading && <div className="flex items-center justify-center gap-2 py-1"><PdaLoading size={16} /><span className="text-xs text-muted-foreground">出库中…</span></div>}
      </PdaBottomBar>
    </div>
  )
}
