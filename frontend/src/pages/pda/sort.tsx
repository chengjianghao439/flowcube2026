/**
 * PDA 分拣作业 — Put Wall
 * 路由：/pda/sort
 *
 * 无感操作：
 *  1. 扫商品码 → 自动显示目标分拣格
 *  2. 扫分拣格码 → 自动确认，无需点击按钮
 */
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { getSortingBinsApi, scanProductForSortApi } from '@/api/sorting-bins'
import type { SortingBin } from '@/api/sorting-bins'
import { sortDoneApi } from '@/api/warehouse-tasks'
import { Button } from '@/components/ui/button'
import PdaHeader, { PdaRefreshButton } from '@/components/pda/PdaHeader'
import PdaCard from '@/components/pda/PdaCard'
import PdaBottomBar from '@/components/pda/PdaBottomBar'
import PdaFlash from '@/components/pda/PdaFlash'
import { PdaEmptyCard, PdaLoading } from '@/components/pda/PdaEmptyState'
import { usePdaScanner } from '@/hooks/usePdaScanner'
import { usePdaFeedback } from '@/hooks/usePdaFeedback'

type Step = 'scan-product' | 'confirm-bin'

interface BinHint {
  binCode: string
  productName: string
  qty: number
  unit: string
  taskNo: string
  customerName: string
  taskId: number
  itemId: number
}

export default function PdaSortPage() {
  const nav = useNavigate()
  const [step, setStep]     = useState<Step>('scan-product')
  const [hint, setHint]     = useState<BinHint | null>(null)
  const [scanning, setScanning] = useState(false)
  const { flash, ok, err }  = usePdaFeedback()

  const { data: bins, isLoading, refetch } = useQuery({
    queryKey: ['sorting-bins-occupied'],
    queryFn: () => getSortingBinsApi().then(r => r.data.data ?? []),
    refetchInterval: 15_000,
  })

  async function handleProductScan(raw: string) {
    const code = raw.trim()
    if (!code) return
    setScanning(true)
    try {
      const res = await scanProductForSortApi(code)
      const result = res.data.data
      if (!result) { err('未找到备货中的商品，请确认条码正确'); return }
      if (!result.sortingBinCode) { err(`任务 ${result.taskNo} 未分配分拣格`); return }
      setHint({
        binCode: result.sortingBinCode, productName: result.productName,
        qty: result.pickedQty, unit: result.unit, taskNo: result.taskNo,
        customerName: result.customerName, taskId: result.taskId, itemId: result.itemId,
      })
      setStep('confirm-bin')
    } catch { err('查询失败，请重试') }
    finally { setScanning(false) }
  }

  async function handleBinScan(raw: string) {
    const code = raw.trim()
    if (!code || !hint) return
    if (code.toUpperCase() !== hint.binCode.toUpperCase()) {
      err(`错误！请放入 ${hint.binCode}，当前是 ${code}`)
      return
    }
    setScanning(true)
    try {
      const res = await sortDoneApi(hint.taskId, [{ itemId: hint.itemId, sortedQty: hint.qty }])
      const result = res.data.data
      if (result?.allSorted) ok(`✓ 任务 ${hint.taskNo} 分拣全部完成！`)
      else ok(`✓ 已放入 ${hint.binCode}（${result?.progress ?? '?'}）`)
    } catch { err('上报分拣失败，请重试') }
    finally { setScanning(false) }
    setStep('scan-product')
    setHint(null)
  }

  // 全局扫码枪监听，无需点击输入框
  usePdaScanner({
    onScan: (code) => {
      if (scanning) return
      if (step === 'scan-product') handleProductScan(code)
      else handleBinScan(code)
    },
    enabled: !scanning,
  })

  const occupiedBins = (bins ?? []).filter(b => b.status === 2)
  const freeBins     = (bins ?? []).filter(b => b.status === 1)
  const phaseCopy = hint
    ? {
        stage: '分拣确认',
        description: '系统已经定位到目标格口，当前优先扫描分拣格条码完成落格，再回波次或异常入口查看整体推进。',
        nextAction: `扫描分拣格 ${hint.binCode} 完成落格`,
      }
    : {
        stage: '分拣准备',
        description: '当前优先扫描产品条码，系统会自动定位目标分拣格。若格口未分配、占用异常或波次卡点，请回 ERP 的分拣格管理和异常工作台继续处理。',
        nextAction: '扫描产品条码获取目标分拣格',
      }

  return (
    <div className="min-h-screen bg-background">
      <PdaHeader title="分拣作业" subtitle="Put Wall"
        onBack={() => nav('/pda')}
        right={<PdaRefreshButton onRefresh={() => refetch()} />}
      />

      <div className="max-w-md mx-auto px-4 pb-32 space-y-4 py-4">
        <PdaFlash flash={flash} />

        <PdaCard>
          <div className="space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">分拣闭环提示</p>
                <p className="mt-1 text-base font-semibold text-foreground">{phaseCopy.stage}</p>
                <p className="mt-1 text-sm text-muted-foreground">{phaseCopy.description}</p>
              </div>
              <div className="rounded-xl border border-border bg-muted/40 px-3 py-2 text-right">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">下一步</p>
                <p className="mt-1 text-sm font-semibold text-foreground">{phaseCopy.nextAction}</p>
              </div>
            </div>
            <div className="rounded-xl border border-border bg-background px-3 py-3">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">推荐顺序</p>
              <p className="mt-1 text-sm text-foreground">先扫商品找格口，再扫分拣格确认，最后回波次详情或异常工作台看整体推进。</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => nav('/sorting-bins')}>打开分拣格管理</Button>
              <Button size="sm" variant="outline" onClick={() => nav('/picking-waves?waveId=1&focus=print-closure')}>打开波次详情</Button>
              <Button size="sm" variant="outline" onClick={() => nav('/reports/exception-workbench')}>打开异常工作台</Button>
            </div>
          </div>
        </PdaCard>

        {/* 步骤进度 */}
        <div className="flex items-center gap-3">
          <div className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${
            step==='scan-product' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
          }`}>1</div>
          <p className={`text-sm ${step==='scan-product' ? 'font-semibold text-foreground' : 'text-muted-foreground'}`}>扫产品条码</p>
          <div className="flex-1 h-px bg-border" />
          <div className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${
            step==='confirm-bin' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
          }`}>2</div>
          <p className={`text-sm ${step==='confirm-bin' ? 'font-semibold text-foreground' : 'text-muted-foreground'}`}>扫分拣格确认</p>
        </div>

        {/* 当前操作提示 */}
        <div className={`rounded-2xl border-2 px-4 py-3 text-center transition-all ${
          scanning ? 'border-yellow-400 bg-yellow-50' :
          step === 'scan-product' ? 'border-primary/30 bg-primary/5' : 'border-green-400/30 bg-green-50'
        }`}>
          <p className="text-sm font-semibold text-foreground">
            {scanning ? '⏳ 处理中…' :
             step === 'scan-product' ? '扫描产品条码' : '扫描分拣格条码'}
          </p>
        </div>

        {/* 分拣提示卡 */}
        {hint && step==='confirm-bin' && (
          <PdaCard>
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">请将以下商品放入指定分拣格</p>
              <div className="rounded-xl bg-primary/5 border border-primary/20 p-4 text-center">
                <p className="text-4xl font-black text-primary tracking-widest">{hint.binCode}</p>
                <p className="text-xs text-muted-foreground mt-1">分拣格编号</p>
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><p className="text-xs text-muted-foreground">商品</p><p className="font-semibold truncate">{hint.productName}</p></div>
                <div><p className="text-xs text-muted-foreground">数量</p><p className="font-bold text-primary">{hint.qty} {hint.unit}</p></div>
                <div><p className="text-xs text-muted-foreground">任务号</p><p className="font-mono text-xs truncate">{hint.taskNo}</p></div>
                <div><p className="text-xs text-muted-foreground">客户</p><p className="text-xs truncate">{hint.customerName}</p></div>
              </div>
              <button className="text-xs text-muted-foreground hover:text-foreground"
                onClick={() => { setStep('scan-product'); setHint(null) }}
              >← 取消，重新扫商品</button>
            </div>
          </PdaCard>
        )}

        {/* 分拣格状态总览 */}
        {isLoading && <PdaLoading className="h-24" />}
        {!isLoading && (
          <>
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">分拣格状态</p>
              <div className="flex gap-3 text-xs">
                <span className="text-green-600">空闲 {freeBins.length}</span>
                <span className="text-orange-600">占用 {occupiedBins.length}</span>
              </div>
            </div>
            {(bins ?? []).length === 0 && (
              <PdaEmptyCard icon="🗂️" title="暂无分拣格" description="请在仓库管理后台创建分拣格" />
            )}
            <div className="grid grid-cols-3 gap-2">
              {(bins ?? []).map((bin: SortingBin) => (
                <div key={bin.id} className={`rounded-xl border p-3 text-center ${
                  bin.status===2 ? 'border-orange-200 bg-orange-50' : 'border-border bg-card'
                }`}>
                  <p className={`text-lg font-black tracking-wide ${
                    bin.status===2 ? 'text-orange-700' : 'text-muted-foreground'
                  }`}>{bin.code}</p>
                  <p className="text-[10px] truncate mt-0.5 text-muted-foreground">
                    {bin.status===2 ? (bin.customerName ?? bin.currentTaskNo ?? '占用中') : '空闲'}
                  </p>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
