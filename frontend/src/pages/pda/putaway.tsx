/**
 * PDA 上架作业
 * 路由：/pda/putaway
 *
 * 流程：
 *   Step 1 — 扫描容器条码（CNTxxxxx）→ 显示商品信息 + 当前库位
 *   Step 2 — 扫描库位条码（LOC-xxx）  → 显示目标库位
 *   Step 3 — 确认上架               → PUT /inventory/containers/:id/location
 */
import { useState, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import { parseBarcode } from '@/utils/barcode'
import PdaScanner from '@/components/pda/PdaScanner'
import PdaHeader from '@/components/pda/PdaHeader'
import PdaCard from '@/components/pda/PdaCard'
import PdaSection from '@/components/pda/PdaSection'
import PdaBottomBar from '@/components/pda/PdaBottomBar'
import { PdaLoading } from '@/components/pda/PdaEmptyState'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { getContainerByBarcodeApi, assignContainerLocationApi } from '@/api/inventory'
import apiClient from '@/api/client'
import type { ApiResponse } from '@/types'

// ─── 类型 ──────────────────────────────────────────────────────────────────────

interface ContainerInfo {
  containerId: number
  barcode: string
  productId: number
  productCode: string
  productName: string
  warehouseName: string
  locationId: number | null
  locationCode: string | null
  remainingQty: number
  unit: string
}

interface LocationInfo {
  id: number
  code: string
  zone: string | null
  aisle: string | null
  rack: string | null
  level: string | null
  position: string | null
}

type Step = 'scan-container' | 'scan-location' | 'confirm' | 'done'

// ─── 主组件 ────────────────────────────────────────────────────────────────────

export default function PdaPutawayPage() {
  const navigate = useNavigate()
  const confirmBtnRef = useRef<HTMLButtonElement>(null)

  const [step, setStep]           = useState<Step>('scan-container')
  const [container, setContainer] = useState<ContainerInfo | null>(null)
  const [location, setLocation]   = useState<LocationInfo | null>(null)
  const [loading, setLoading]     = useState(false)
  const [flash, setFlash]         = useState<{ type: 'ok' | 'err'; msg: string } | null>(null)

  // ── flash helpers ──────────────────────────────────────────────────────
  const showOk  = (msg: string) => { setFlash({ type: 'ok',  msg }); setTimeout(() => setFlash(null), 1500) }
  const showErr = (msg: string) => { setFlash({ type: 'err', msg }); setTimeout(() => setFlash(null), 2500) }

  // ── 上架 mutation ──────────────────────────────────────────────────────
  const putawayMut = useMutation({
    mutationFn: () => assignContainerLocationApi(container!.containerId, location!.id),
    onSuccess: () => {
      setStep('done')
    },
    onError: (e: unknown) => {
      const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? '上架失败，请重试'
      showErr(msg)
    },
  })

  // ── Step 1：扫描容器 ────────────────────────────────────────────────────
  const handleScanContainer = useCallback(async (raw: string) => {
    const parsed = parseBarcode(raw)
    if (parsed.type !== 'container') {
      showErr('必须扫描容器条码（CNTxxxxxx）')
      return
    }
    setLoading(true)
    try {
      const res = await getContainerByBarcodeApi(raw)
      setContainer(res.data.data!)
      setStep('scan-location')
      showOk('容器已识别，请扫描目标库位')
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? '容器不存在或已失效'
      showErr(msg)
    } finally {
      setLoading(false)
    }
  }, [])

  // ── Step 2：扫描库位 ────────────────────────────────────────────────────
  const handleScanLocation = useCallback(async (raw: string) => {
    const parsed = parseBarcode(raw)
    if (parsed.type !== 'location') {
      showErr('必须扫描库位条码（LOC-xxx）')
      return
    }
    setLoading(true)
    try {
      const res = await apiClient.get<ApiResponse<LocationInfo>>(`/locations/code/${encodeURIComponent(raw)}`)
      setLocation(res.data.data!)
      setStep('confirm')
      // 自动聚焦确认按钮
      setTimeout(() => confirmBtnRef.current?.focus(), 100)
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? '库位不存在'
      showErr(msg)
    } finally {
      setLoading(false)
    }
  }, [])

  // ── 重置 ──────────────────────────────────────────────────────────────
  function reset() {
    setContainer(null)
    setLocation(null)
    setStep('scan-container')
    setFlash(null)
    putawayMut.reset()
  }

  // ── 完成页 ────────────────────────────────────────────────────────────
  if (step === 'done') {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-background px-6 text-center">
        <div className="text-6xl mb-6">✅</div>
        <h2 className="text-2xl font-bold text-foreground">上架成功</h2>
        <p className="text-muted-foreground mt-2 mb-1">
          <span className="font-mono text-foreground">{container?.barcode}</span>
        </p>
        <p className="text-muted-foreground mb-8">已移至库位 <span className="font-semibold text-foreground">{location?.code}</span></p>
        <div className="flex gap-3 w-full max-w-xs">
          <Button variant="outline" className="flex-1" onClick={reset}>继续上架</Button>
          <Button className="flex-1" onClick={() => navigate('/pda')}>返回工作台</Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">

      {/* ── 顶部导航 ─────────────────────────────────────────────────── */}
      <PdaHeader
        title="上架作业"
        onBack={() => navigate('/pda')}
        subtitle={step === 'scan-container' ? '步骤 1/3' : step === 'scan-location' ? '步骤 2/3' : '步骤 3/3'}
      />

      {/* ── Flash 提示 ───────────────────────────────────────────────── */}
      {flash && (
        <div className={`mx-4 mt-3 rounded-xl py-2.5 text-center text-sm font-semibold ${
          flash.type === 'ok'
            ? 'bg-green-100 text-green-800 border border-green-200'
            : 'bg-red-100 text-red-800 border border-red-200'
        }`}>
          {flash.msg}
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-md mx-auto px-4 py-5 space-y-4">

          {/* ── 步骤指示器 ──────────────────────────────────────────── */}
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {(['scan-container','scan-location','confirm'] as Step[]).map((s, i) => (
              <div key={s} className="flex items-center gap-2">
                <div className={`h-6 w-6 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
                  step === s
                    ? 'bg-primary text-primary-foreground'
                    : (step === 'scan-location' && i === 0) || step === 'confirm'
                      ? 'bg-green-500 text-white'
                      : 'bg-muted text-muted-foreground'
                }`}>
                  {(step === 'scan-location' && i === 0) || (step === 'confirm' && i < 2) ? '✓' : i + 1}
                </div>
                <span className={step === s ? 'text-foreground font-medium' : ''}>
                  {s === 'scan-container' ? '扫容器' : s === 'scan-location' ? '扫库位' : '确认'}
                </span>
                {i < 2 && <div className="h-px flex-1 bg-border min-w-[20px]" />}
              </div>
            ))}
          </div>

          {/* ── Step 1：扫描容器 ──────────────────────────────────────── */}
          {step === 'scan-container' && (
            <PdaSection icon="📦" title="扫描容器条码" description="格式：CNTxxxxxx">
              <PdaScanner onScan={handleScanContainer} placeholder="扫描容器条码 CNTxxxxxx" disabled={loading} />
            </PdaSection>
          )}

          {/* ── Step 2：显示容器信息 + 扫描库位 ────────────────────────── */}
          {(step === 'scan-location' || step === 'confirm') && container && (
            <PdaCard done>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">容器信息</p>
                <Badge variant="outline" className="font-mono text-xs">{container.barcode}</Badge>
              </div>
              <div className="space-y-1.5">
                <p className="font-semibold text-foreground">{container.productName}</p>
                <p className="text-xs font-mono text-muted-foreground">{container.productCode}</p>
                <div className="flex items-center gap-4 text-sm mt-2">
                  <div><span className="text-muted-foreground text-xs">数量</span><p className="font-bold text-primary">{container.remainingQty} <span className="text-xs font-normal text-muted-foreground">{container.unit}</span></p></div>
                  <div><span className="text-muted-foreground text-xs">当前库位</span><p className="font-medium text-foreground">{container.locationCode ?? <span className="text-muted-foreground italic">未分配</span>}</p></div>
                  <div><span className="text-muted-foreground text-xs">仓库</span><p className="font-medium text-foreground">{container.warehouseName}</p></div>
                </div>
              </div>
            </PdaCard>
          )}

          {step === 'scan-location' && (
            <PdaSection icon="📍" title="扫描目标库位" description="格式：LOC-xxx 或库位编码">
              <PdaScanner onScan={handleScanLocation} placeholder="扫描库位条码 LOC-xxx" disabled={loading} />
              <button onClick={reset} className="w-full text-center text-xs text-muted-foreground hover:text-foreground py-1">← 重新扫描容器</button>
            </PdaSection>
          )}

          {/* ── Step 3：确认上架 ──────────────────────────────────────── */}
          {step === 'confirm' && container && location && (
            <div className="space-y-3">
              <PdaSection title="确认上架">
                <div className="flex items-center gap-3">
                  <div className="flex-1 rounded-xl border border-border bg-muted/30 p-3 text-center">
                    <p className="text-xs text-muted-foreground mb-1">当前库位</p>
                    <p className="font-mono font-semibold text-foreground">{container.locationCode ?? <span className="italic text-muted-foreground">未分配</span>}</p>
                  </div>
                  <span className="text-xl text-primary">→</span>
                  <div className="flex-1 rounded-xl border border-primary/40 bg-primary/5 p-3 text-center">
                    <p className="text-xs text-muted-foreground mb-1">目标库位</p>
                    <p className="font-mono font-bold text-primary">{location.code}</p>
                  </div>
                </div>
              </PdaSection>
              <PdaCard>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-foreground">{container.productName}</p>
                    <p className="text-xs font-mono text-muted-foreground">{container.barcode}</p>
                  </div>
                  <Badge variant="default">{container.remainingQty} {container.unit}</Badge>
                </div>
              </PdaCard>
              <div className="flex gap-3 pt-1">
                <Button variant="outline" className="flex-1" onClick={() => setStep('scan-location')} disabled={putawayMut.isPending}>重扫库位</Button>
                <Button ref={confirmBtnRef} className="flex-1" onClick={() => putawayMut.mutate()} disabled={putawayMut.isPending}>
                  {putawayMut.isPending ? (<span className="flex items-center gap-2"><span className="h-4 w-4 rounded-full border-2 border-primary-foreground border-t-transparent animate-spin" />上架中…</span>) : '✓ 确认上架'}
                </Button>
              </div>
            </div>
          )}

        </div>
      </div>

      {/* ── 底部加载遮罩 ─────────────────────────────────────────────── */}
      {loading && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
          <PdaCard className="px-8 py-6 flex flex-col items-center gap-3 shadow-xl">
            <PdaLoading size={32} />
            <p className="text-sm text-foreground">查询中…</p>
          </PdaCard>
        </div>
      )}

    </div>
  )
}