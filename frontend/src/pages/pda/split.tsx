/**
 * PDA 同仓库存拆分 /pda/split
 */
import { useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import { parseBarcode } from '@/utils/barcode'
import PdaScanner from '@/components/pda/PdaScanner'
import PdaHeader from '@/components/pda/PdaHeader'
import PdaFlash from '@/components/pda/PdaFlash'
import PdaBottomBar from '@/components/pda/PdaBottomBar'
import PdaFlowPanel from '@/components/pda/PdaFlowPanel'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { getContainerByBarcodeApi, splitContainerApi } from '@/api/inventory'
import { usePdaFeedback } from '@/hooks/usePdaFeedback'

export default function PdaSplitPage() {
  const navigate = useNavigate()
  const { flash, ok, err } = usePdaFeedback()
  const [step, setStep] = useState<'scan' | 'qty'>('scan')
  const [containerId, setContainerId] = useState<number | null>(null)
  const [barcode, setBarcode] = useState<string | null>(null)
  const [productHint, setProductHint] = useState<string>('')
  const [sourceKind, setSourceKind] = useState<'inventory' | 'plastic_box'>('inventory')
  const [remaining, setRemaining] = useState<number>(0)
  const [qtyStr, setQtyStr] = useState('1')
  const [printLabel, setPrintLabel] = useState(true)

  const loadMut = useMutation({
    mutationFn: async (bc: string) => {
      const res = await getContainerByBarcodeApi(bc)
      return res!
    },
    onSuccess: (d) => {
      if (d.containerStatus === 'waiting_putaway') {
        err('待上架容器不能拆分')
        return
      }
      setContainerId(d.containerId)
      setBarcode(d.barcode)
      setSourceKind(d.containerKind === 'plastic_box' ? 'plastic_box' : 'inventory')
      setProductHint(`${d.productName}（${d.productCode}）`)
      setRemaining(d.remainingQty)
      setQtyStr('1')
      setStep('qty')
      ok(`已识别 ${d.barcode}`)
    },
    onError: (e: unknown) =>
      err((e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? '查询失败'),
  })

  const splitMut = useMutation({
    mutationFn: () => {
      if (!containerId) throw new Error('no container')
      const q = Number(qtyStr)
      if (!Number.isFinite(q) || q <= 0) throw new Error('数量无效')
      return splitContainerApi(containerId, { qty: q, printLabel })
    },
    onSuccess: (res) => {
      ok(`拆分成功：新塑料盒条码 ${res.newBarcode}`)
      setStep('scan')
      setContainerId(null)
      setBarcode(null)
      setSourceKind('inventory')
      setProductHint('')
      setRemaining(0)
      setQtyStr('1')
    },
    onError: (e: unknown) =>
      err((e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? '拆分失败'),
  })

  const handleScan = useCallback((raw: string) => {
    const parsed = parseBarcode(raw)
    if (parsed.type !== 'container' && parsed.type !== 'unknown') {
      err('扫描库存条码')
      return
    }
    loadMut.mutate(raw.trim())
  }, [err, loadMut])

  const onSubmitQty = () => {
    const q = Number(qtyStr)
    if (!Number.isFinite(q) || q <= 0) {
      err('请输入有效数量')
      return
    }
    if (q >= remaining) {
      err('数量须小于剩余数量')
      return
    }
    splitMut.mutate()
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <PdaHeader title="塑料盒拆分" subtitle="从库存中拆出散件塑料盒" onBack={() => navigate('/pda')} />
      <PdaFlash flash={flash} />

      <div className="flex-1 overflow-y-auto px-4 py-4 max-w-md mx-auto w-full space-y-4">
        <PdaFlowPanel
          badge="容器拆分闭环"
          title="拆分页负责把库存条码拆成新的塑料盒条码，并确保新标签立即可追踪"
          description="先扫描库存条码或塑料盒条码，再填写拆分数量并决定是否立即打印新条码。遇到标签异常时，回打印查询或异常工作台继续处理。"
          nextAction={step === 'scan' ? '扫描库存条码' : '确认拆分并打印新标签'}
          stepText="先识别来源容器，再确认拆分数量；新塑料盒条码打印成功后，再回上架、分拣或仓库任务继续现场执行。"
          actions={[
            { label: '打开库存管理', onClick: () => navigate('/inventory') },
            { label: '打开打印查询', onClick: () => navigate('/settings/barcode-print-query?category=inbound&status=failed') },
            { label: '打开异常工作台', onClick: () => navigate('/reports/exception-workbench') },
          ]}
        />
        {step === 'scan' && (
          <div className="rounded-2xl border border-border bg-card p-4 space-y-2">
            <p className="text-sm text-muted-foreground">扫描库存条码</p>
          </div>
        )}
        {step === 'qty' && containerId && (
          <div className="rounded-2xl border border-primary/30 bg-primary/5 p-4 space-y-3">
            <p className="font-mono text-lg font-bold text-foreground">{barcode}</p>
            <p className="text-sm text-foreground">{productHint}</p>
            <p className="text-xs text-muted-foreground">来源类型：<span className="font-semibold text-foreground">{sourceKind === 'plastic_box' ? '塑料盒条码' : '库存条码'}</span></p>
            <p className="text-xs text-muted-foreground">剩余可拆：<span className="font-semibold text-foreground">{remaining}</span></p>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">拆分数量</label>
              <Input
                type="number"
                inputMode="decimal"
                min={1}
                max={Math.max(0, remaining - 1)}
                value={qtyStr}
                onChange={e => setQtyStr(e.target.value)}
                className="font-mono text-lg"
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={printLabel}
                onChange={e => setPrintLabel(e.target.checked)}
                className="h-4 w-4 rounded border-border"
              />
              打印新塑料盒条码
            </label>
            <div className="flex gap-2 pt-2">
              <Button variant="outline" className="flex-1" onClick={() => { setStep('scan'); setContainerId(null) }}>
                重新扫码
              </Button>
              <Button className="flex-1" onClick={onSubmitQty} disabled={splitMut.isPending}>
                {splitMut.isPending ? '提交中…' : '确认拆分'}
              </Button>
            </div>
          </div>
        )}
      </div>

      <PdaBottomBar>
        {step === 'scan' && (
          <PdaScanner onScan={handleScan} placeholder="扫描库存条码" disabled={loadMut.isPending} />
        )}
      </PdaBottomBar>
    </div>
  )
}
