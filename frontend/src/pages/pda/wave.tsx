import { useState, useRef, useEffect, useCallback } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery, useMutation } from '@tanstack/react-query'
import {
  getWaveByIdApi, finishPickingApi, cancelWaveApi,
  getWavePickRouteApi, markRouteCompletedApi,
} from '@/api/picking-waves'
import type { WaveItem, WaveRouteStep, WaveRouteContainer, WavePickLine } from '@/api/picking-waves'
import { getContainerByBarcodeApi } from '@/api/inventory'
import { payloadClient as client } from '@/api/client'

// ── 容器查询 ──────────────────────────────────────────────────────────────────

interface ContainerInfo {
  containerId: number
  barcode: string
  containerKind?: 'inventory' | 'plastic_box'
  productId: number
  productName: string
  warehouseId: number
  locationCode: string | null
  remainingQty: number
}

async function fetchContainerByBarcode(bc: string): Promise<ContainerInfo> {
  return getContainerByBarcodeApi(bc)
}

function allocatePickLine(pickLines: WavePickLine[] | undefined, productId: number): WavePickLine | null {
  if (!pickLines?.length) return null
  return pickLines.find(l => l.productId === productId && l.pickedQty < l.requiredQty) ?? null
}

async function createScanLog(params: {
  taskId: number; itemId: number; containerId: number; barcode: string
  productId: number; qty: number; scanMode: string; locationCode?: string
}): Promise<void> {
  await client.post('/scan-logs', params, { headers: { 'X-Client': 'pda' } })
}

// ── 扫描记录 ──────────────────────────────────────────────────────────────────

interface ScanRecord {
  id: number; barcode: string; productName: string; locationCode: string | null
  qty: number; time: string; mode: string; containerKind?: 'inventory' | 'plastic_box'
}

function now(): string {
  return new Date().toLocaleTimeString('zh-CN', { hour12: false })
}

// ── 主组件 ────────────────────────────────────────────────────────────────────

export default function PdaWavePage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const waveId = Number(params.get('waveId')) || 0

  const inputRef = useRef<HTMLInputElement>(null)
  const [records, setRecords] = useState<ScanRecord[]>([])
  const [inputVal, setInputVal] = useState('')
  const [flash, setFlash] = useState<'success' | 'error' | null>(null)
  const [errorMsg, setErrorMsg] = useState('')
  const [scanning, setScanning] = useState(false)
  const [finished, setFinished] = useState<'completed' | 'cancelled' | null>(null)

  // ── 获取波次详情 ────────────────────────────────────────────────────────

  const { data: wave, isLoading, error: loadError, refetch } = useQuery({
    queryKey: ['pda-wave', waveId],
    queryFn: () => getWaveByIdApi(waveId),
    enabled: waveId > 0,
    refetchOnWindowFocus: false,
  })

  // ── 拣货路线（含缓存 + 断点恢复）──────────────────────────────────────

  const { data: routeData, refetch: refetchRoute } = useQuery({
    queryKey: ['pda-wave-route', waveId],
    queryFn: () => getWavePickRouteApi(waveId),
    enabled: waveId > 0 && !!wave && wave.status === 2,
    refetchOnWindowFocus: false,
  })

  const routeSteps: WaveRouteStep[] = routeData?.route ?? []

  // 找到第一个未完成步骤
  const currentStepIdx = routeSteps.findIndex(s => s.status !== 'completed')

  // 统计已完成容器数（跨步骤）
  const totalContainers = routeData?.totalContainers ?? 0
  const completedContainers = routeSteps.reduce(
    (sum, s) => sum + (s.containers?.filter(c => c.status === 'completed').length ?? 0), 0,
  )

  // ── mutations ───────────────────────────────────────────────────────────

  const finishPickingMut = useMutation({
    mutationFn: () => finishPickingApi(waveId),
    onSuccess: () => setFinished('completed'),
  })

  const cancelMut = useMutation({
    mutationFn: () => cancelWaveApi(waveId),
    onSuccess: () => setFinished('cancelled'),
  })

  // ── 焦点管理 ───────────────────────────────────────────────────────────

  const focusInput = useCallback(() => {
    if (!finished) inputRef.current?.focus()
  }, [finished])

  useEffect(() => { focusInput() }, [focusInput, wave])

  // ── 扫码处理 ───────────────────────────────────────────────────────────

  async function handleScan(barcode: string) {
    const trimmed = barcode.trim()
    if (!trimmed || !wave?.items?.length) return

    if (!/^(?:I|B|CNT)\d{6}$/.test(trimmed)) {
      showError('扫描库存条码')
      setInputVal('')
      return
    }

    setScanning(true)
    setErrorMsg('')
    try {
      const container = await fetchContainerByBarcode(trimmed)

      const matchItem = wave.items.find(i => i.productId === container.productId)
      if (!matchItem) {
        showError(`该商品（${container.productName}）不属于当前波次`)
        return
      }

      const line = allocatePickLine(wave.pickLines, container.productId)
      if (!line) {
        showError(`${matchItem.productName} 在波次任务中已无可分配拣货行，请刷新后重试`)
        return
      }

      const remaining = line.requiredQty - line.pickedQty
      if (remaining <= 0) {
        showError(`${matchItem.productName} 已完成拣货`)
        return
      }

      const isWhole = container.remainingQty > 1
      const addQty = isWhole ? Math.min(container.remainingQty, remaining) : 1
      const scanMode = isWhole ? '整件' : '散件'

      await createScanLog({
        taskId: line.taskId,
        itemId: line.itemId,
        containerId: container.containerId,
        barcode: trimmed,
        productId: container.productId,
        qty: addQty,
        scanMode,
        locationCode: container.locationCode || undefined,
      })

      await markRouteCompletedApi(waveId, trimmed)

      setRecords(prev => [{
        id: Date.now(), barcode: trimmed, productName: matchItem.productName,
        locationCode: container.locationCode, qty: addQty, time: now(), mode: scanMode, containerKind: container.containerKind,
      }, ...prev])
      triggerFlash('success')

      const refetchResult = await refetch()
      await refetchRoute()
      const fresh = refetchResult.data
      if (fresh && fresh.status === 2 && fresh.items.length > 0 && fresh.items.every(i => i.pickedQty >= i.totalQty)) {
        await finishPickingMut.mutateAsync()
      }
    } catch (err: unknown) {
      let msg = '扫码失败'
      if (err && typeof err === 'object' && 'response' in err) {
        const axErr = err as { response?: { data?: { message?: string } } }
        msg = axErr.response?.data?.message || msg
      } else if (err instanceof Error) {
        msg = err.message
      }
      showError(msg)
    } finally {
      setScanning(false)
      setInputVal('')
    }
  }

  function showError(msg: string) { setErrorMsg(msg); triggerFlash('error') }
  function triggerFlash(type: 'success' | 'error') { setFlash(type); setTimeout(() => setFlash(null), 800) }
  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' && !scanning) handleScan(inputVal)
  }

  // ── 进度 ───────────────────────────────────────────────────────────────

  const items: WaveItem[] = wave?.items ?? []
  const totalRequired = items.reduce((s, i) => s + i.totalQty, 0)
  const totalPicked = items.reduce((s, i) => s + i.pickedQty, 0)
  const progressPct = totalRequired === 0 ? 0 : Math.round((totalPicked / totalRequired) * 100)
  const allDone = items.length > 0 && items.every(i => i.pickedQty >= i.totalQty)

  // ── 渲染：无 waveId ─────────────────────────────────────────────────────

  if (!waveId) {
    return (
      <div className="flex h-screen flex-col items-center justify-center bg-gray-950 text-white">
        <div className="text-center">
          <div className="mb-4 text-6xl opacity-30">📦</div>
          <h1 className="mb-2 text-xl font-bold">缺少波次参数</h1>
          <p className="mb-6 text-sm text-gray-400">请从波次拣货页面进入</p>
          <button onClick={() => navigate('/picking-waves')}
            className="rounded-xl bg-white/10 px-8 py-3 text-base font-medium text-white hover:bg-white/20 active:scale-95">
            返回波次列表
          </button>
        </div>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-950 text-white">
        <div className="text-center">
          <div className="mb-3 text-lg font-medium">加载波次中...</div>
          <div className="text-sm text-gray-400">波次ID：{waveId}</div>
        </div>
      </div>
    )
  }

  if (loadError || !wave) {
    return (
      <div className="flex h-screen flex-col items-center justify-center bg-gray-950 text-white">
        <div className="text-center">
          <div className="mb-4 text-5xl text-red-400">✕</div>
          <h1 className="mb-2 text-xl font-bold">波次加载失败</h1>
          <p className="mb-6 text-sm text-gray-400">{(loadError as Error)?.message || '波次不存在'}</p>
          <button onClick={() => navigate('/picking-waves')}
            className="rounded-xl bg-white/10 px-8 py-3 text-base font-medium text-white hover:bg-white/20 active:scale-95">
            返回波次列表
          </button>
        </div>
      </div>
    )
  }

  if (finished) {
    const ok = finished === 'completed'
    return (
      <div className="flex h-screen flex-col items-center justify-center bg-gray-950 text-white">
        <div className="text-center">
          <div className={`mb-6 text-8xl ${ok ? 'text-green-400' : 'text-red-400'}`}>{ok ? '✓' : '✕'}</div>
          <h1 className="mb-2 text-3xl font-bold">{ok ? '波次拣货完成' : '波次已取消'}</h1>
          <p className="mb-2 text-lg text-gray-400">{wave.waveNo}</p>
          {ok && (
            <p className="mb-8 text-base text-gray-400">
              共扫描 <span className="font-bold text-green-400">{records.length}</span> 次，
              拣货 <span className="font-bold text-green-400">{totalPicked}</span> 件
            </p>
          )}
          <button onClick={() => navigate('/picking-waves')}
            className="rounded-xl bg-white/10 px-8 py-4 text-lg font-medium text-white hover:bg-white/20 active:scale-95">
            返回波次列表
          </button>
        </div>
      </div>
    )
  }

  // ── 渲染：主界面 ────────────────────────────────────────────────────────

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-gray-950 text-white select-none" onClick={focusInput}>

      {/* 顶部信息栏 */}
      <header className="shrink-0 border-b border-white/10 bg-gray-900 px-4 py-3">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="rounded bg-purple-500/20 px-2 py-0.5 text-xs font-medium text-purple-300">波次拣货</span>
              <span className="text-base font-bold tracking-wide text-white">{wave.waveNo}</span>
            </div>
            <div className="mt-1 flex items-center gap-3 text-sm text-gray-400">
              <span>仓库：<span className="text-gray-200">{wave.warehouseName}</span></span>
              <span>·</span>
              <span>包含 <span className="text-gray-200">{wave.taskCount}</span> 个任务</span>
            </div>
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold tabular-nums text-white">
              {totalPicked}<span className="text-lg text-gray-500">/{totalRequired}</span>
            </div>
            <div className="text-xs text-gray-400">已拣 / 总需</div>
          </div>
        </div>
        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
          <div className="h-full rounded-full bg-purple-500 transition-all duration-300" style={{ width: `${progressPct}%` }} />
        </div>
      </header>

      {/* 主内容区 */}
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">

        {/* 路线进度 */}
        {routeSteps.length > 0 && (
          <div className="shrink-0 space-y-2">
            <div className="flex items-center justify-between rounded-lg bg-white/5 px-3 py-2">
              <span className="text-xs text-gray-400">拣货路线</span>
              <span className="text-sm font-bold tabular-nums text-white">
                库位 {routeSteps.filter(s => s.status === 'completed').length}/{routeSteps.length}
                <span className="ml-2 text-gray-500">
                  容器 {completedContainers}/{totalContainers}
                </span>
              </span>
            </div>

            {/* 步骤列表 — 同库位合并展示 */}
            {routeSteps.map((step, idx) => {
              const isDone = step.status === 'completed'
              const isCurrent = idx === currentStepIdx
              const pendingContainers = step.containers?.filter(c => c.status !== 'completed') ?? []
              const doneContainers = step.containers?.filter(c => c.status === 'completed') ?? []

              return (
                <div key={step.step}
                  className={`relative rounded-xl border-2 transition-all ${
                    isDone ? 'border-green-500/40 bg-green-500/5'
                    : isCurrent ? 'border-purple-500 bg-purple-500/10 shadow-lg shadow-purple-500/10'
                    : 'border-white/5 bg-white/[0.02] opacity-50'
                  }`}>

                  {/* 步骤编号 */}
                  <div className="absolute -left-3 top-3">
                    <div className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${
                      isDone ? 'bg-green-500 text-white'
                      : isCurrent ? 'bg-purple-500 text-white animate-pulse'
                      : 'bg-gray-700 text-gray-400'
                    }`}>
                      {isDone ? '✓' : step.step}
                    </div>
                  </div>

                  <div className="pl-6 pr-3 py-3">
                    {/* 库位标题 */}
                    <div className={`text-lg font-bold tracking-wide ${
                      isDone ? 'text-green-400' : isCurrent ? 'text-purple-300' : 'text-gray-500'
                    }`}>
                      📍 {step.locationCode || '未分配库位'}
                    </div>

                    {/* 该库位下的容器列表 */}
                    <div className="mt-2 space-y-1.5">
                      {(step.containers ?? []).map((c: WaveRouteContainer) => {
                        const cDone = c.status === 'completed'
                        return (
                          <div key={c.barcode}
                            className={`flex items-center justify-between rounded-lg px-3 py-2 ${
                              cDone ? 'bg-green-500/10 opacity-60'
                                : isCurrent ? 'bg-white/5'
                                : 'bg-white/[0.02]'
                            }`}>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                {cDone
                                  ? <span className="text-xs text-green-400">✓</span>
                                  : <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-purple-400" />}
                                <span className={`font-mono text-sm ${cDone ? 'text-gray-500' : 'text-white'}`}>
                                  {c.barcode}
                                </span>
                                <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                                  String(c.barcode).startsWith('B') ? 'bg-orange-500/20 text-orange-300' : 'bg-slate-500/20 text-slate-300'
                                }`}>
                                  {String(c.barcode).startsWith('B') ? '塑料盒' : '库存'}
                                </span>
                                {!cDone && isCurrent && (
                                  <button
                                    onClick={e => { e.stopPropagation(); handleScan(c.barcode) }}
                                    disabled={scanning}
                                    className="rounded bg-purple-500 px-2 py-0.5 text-[10px] font-bold text-white active:scale-95 disabled:opacity-50">
                                    扫描
                                  </button>
                                )}
                              </div>
                              <div className="mt-0.5 pl-4 text-xs text-gray-500">
                                {c.productName} · {c.productCode}
                              </div>
                            </div>
                            <div className="shrink-0 text-right">
                              <div className={`text-base font-bold tabular-nums ${cDone ? 'text-green-400' : 'text-purple-300'}`}>
                                {c.qty}
                              </div>
                              <div className="text-[10px] text-gray-500">{c.unit}</div>
                            </div>
                          </div>
                        )
                      })}
                    </div>

                    {/* 库位摘要 */}
                    {isCurrent && pendingContainers.length > 0 && (
                      <div className="mt-2 text-xs text-gray-500">
                        待扫 {pendingContainers.length} 个容器
                        {doneContainers.length > 0 && `，已完成 ${doneContainers.length} 个`}
                      </div>
                    )}
                  </div>

                  {/* 步骤连接线 */}
                  {idx < routeSteps.length - 1 && (
                    <div className={`absolute -bottom-2 left-0 ml-[0.45rem] h-2 w-0.5 ${
                      isDone ? 'bg-green-500/50' : 'bg-white/10'
                    }`} />
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* 扫描输入区 */}
        {!allDone && (
          <div className={`shrink-0 rounded-xl border-2 p-4 transition-all duration-300 ${
            flash === 'success' ? 'border-green-500 bg-green-500/10'
              : flash === 'error' ? 'border-red-500 bg-red-500/10'
              : 'border-purple-500/40 bg-white/5'
          }`}>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-widest text-gray-400">
                {scanning ? '处理中...' : '扫描条码'}
              </span>
              {flash === 'success' && <span className="text-sm text-green-400">✓ 扫描成功</span>}
              {flash === 'error' && <span className="text-sm text-red-400">✕ {errorMsg}</span>}
            </div>
            <input ref={inputRef} type="text"
              value={inputVal}
              onChange={e => setInputVal(e.target.value)}
              onKeyDown={handleKeyDown}
              onBlur={() => setTimeout(focusInput, 100)}
              placeholder="等待扫码枪输入 I000001 / B000001 ..."
              disabled={scanning}
              autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false}
              className="w-full bg-transparent text-lg font-mono text-white placeholder-gray-600 outline-none disabled:opacity-50" />
          </div>
        )}

        {/* 扫描记录 */}
        {records.length > 0 && (
          <div className="min-h-0 flex-1">
            <div className="mb-2 text-xs font-medium uppercase tracking-widest text-gray-500">
              扫描记录 ({records.length})
            </div>
            <div className="space-y-1.5 overflow-y-auto" style={{ maxHeight: '180px' }}>
              {records.map((rec, idx) => (
                <div key={rec.id}
                  className={`flex items-center justify-between rounded-lg px-3 py-2 ${idx === 0 ? 'bg-white/10' : 'bg-white/5'}`}>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="shrink-0 text-xs text-green-400">✓</span>
                      <span className="truncate font-mono text-sm text-gray-200">{rec.barcode}</span>
                      <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${
                        rec.containerKind === 'plastic_box' ? 'bg-orange-500/20 text-orange-300' : 'bg-slate-500/20 text-slate-300'
                      }`}>{rec.containerKind === 'plastic_box' ? '塑料盒' : '库存'}</span>
                      <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${
                        rec.mode === '整件' ? 'bg-purple-500/20 text-purple-300' : 'bg-cyan-500/20 text-cyan-300'
                      }`}>{rec.mode} ×{rec.qty}</span>
                    </div>
                    <div className="pl-4 text-xs text-gray-500">
                      {rec.productName}
                      {rec.locationCode && <span className="ml-2 text-yellow-400/70">📍{rec.locationCode}</span>}
                    </div>
                  </div>
                  <span className="shrink-0 pl-3 text-xs tabular-nums text-gray-500">{rec.time}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 底部操作栏 */}
      <footer className="shrink-0 border-t border-white/10 bg-gray-900 p-4">
        <div className="flex gap-3">
          <button onClick={() => cancelMut.mutate()}
            className="flex-1 rounded-xl border border-white/10 bg-white/5 py-4 text-base font-medium text-gray-300 hover:bg-white/10 active:scale-95">
            取消波次
          </button>
          {allDone ? (
            <button type="button" onClick={() => finishPickingMut.mutate()}
              disabled={finishPickingMut.isPending}
              className="flex-[2] rounded-xl bg-green-500 py-4 text-base font-bold text-white shadow-lg shadow-green-500/30 hover:bg-green-400 active:scale-95 disabled:opacity-50">
              {finishPickingMut.isPending ? '提交中...' : '✓ 提交拣货完成'}
            </button>
          ) : (
            <div className="flex-[2] flex items-center justify-center rounded-xl border border-white/10 bg-white/5 py-4 text-sm text-gray-500">
              请扫满全部数量后再提交（{totalPicked}/{totalRequired}）
            </div>
          )}
        </div>
      </footer>
    </div>
  )
}
