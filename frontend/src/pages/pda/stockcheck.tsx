/**
 * PDA 扫码盘点（文档13 §4.3）
 * 路由：/pda/stockcheck（进行中的盘点单）、/pda/stockcheck/:id（逐商品扫容器码）
 *
 * 盘点一律扫容器码：
 *  - 个体条码（一件一码）：扫到即计 1，没扫到的判盘亏；
 *  - 数量容器（库存条码/塑料盒）：扫码后填该容器实盘数（预填账面数，多数情况一扫即过）。
 * 实盘数不是人填的总数，而是各容器实盘之和，由扫码集派生。
 * 仓库端只负责如实扫，盈亏判定与提交在 ERP 侧（守 CLAUDE.md「仓库端只执行不决策」）。
 *
 * 提交为**整行替换语义**：一次提交该商品扫到的全部容器，天然幂等，断网重来直接重扫覆盖。
 */
import { useState, useCallback, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import PdaHeader from '@/components/pda/PdaHeader'
import PdaCard from '@/components/pda/PdaCard'
import PdaBottomBar from '@/components/pda/PdaBottomBar'
import PdaFlash from '@/components/pda/PdaFlash'
import { PdaLoading } from '@/components/pda/PdaEmptyState'
import { usePdaFeedback } from '@/hooks/usePdaFeedback'
import { useCriticalPdaAction } from '@/hooks/useCriticalPdaAction'
import { usePdaScanner } from '@/hooks/usePdaScanner'
import { getPendingScanChecksApi, getScanCheckItemsApi, saveCheckItemScansApi } from '@/api/stockcheck'
import { getContainerByBarcodeApi } from '@/api/inventory'
import type { PendingScanCheck, ScanCheckItem } from '@/types/stockcheck'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { formatPdaErrorMessage } from '@/utils/displayFormatters'

interface ScannedContainer {
  barcode: string
  individual: boolean
  bookQty: number
  countedQty: number
}

// ── 待盘点单列表 ──
function CheckList() {
  const navigate = useNavigate()
  const { data, isLoading } = useQuery({
    queryKey: ['pda-stockcheck-pending'],
    queryFn: () => getPendingScanChecksApi().then(r => r ?? []),
    refetchInterval: 15_000,
  })
  const list: PendingScanCheck[] = data ?? []
  if (isLoading) return <PdaLoading />
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <PdaHeader title="扫码盘点" subtitle="逐商品扫描在架库存条码" onBack={() => navigate('/pda')} />
      <div className="max-w-md mx-auto flex-1 space-y-2 overflow-y-auto p-3 w-full">
        {list.length === 0 && <PdaCard><p className="py-8 text-center text-sm text-muted-foreground">暂无进行中的盘点单</p></PdaCard>}
        {list.map(c => (
          <button key={c.id} className="w-full" onClick={() => navigate(`/pda/stockcheck/${c.id}`)}>
            <PdaCard>
              <div className="flex items-center justify-between">
                <div className="text-left">
                  <p className="font-medium text-foreground">{c.checkNo}</p>
                  <p className="text-xs text-muted-foreground">{c.warehouseName}</p>
                </div>
                <span className="text-sm tabular-nums">待盘 <b className="text-amber-600">{c.pendingCount}</b>/{c.itemCount}</span>
              </div>
            </PdaCard>
          </button>
        ))}
      </div>
    </div>
  )
}

// ── 单盘点单作业：选商品 → 逐只扫容器码 → 提交该商品 ──
function CheckWork({ checkId }: { checkId: number }) {
  const navigate = useNavigate()
  const { flash, ok, err } = usePdaFeedback()
  const [activeItem, setActiveItem] = useState<ScanCheckItem | null>(null)
  const [scanned, setScanned] = useState<ScannedContainer[]>([])
  const [manual, setManual] = useState('')
  const [checking, setChecking] = useState(false)

  const { data: detail, isLoading, refetch } = useQuery({
    queryKey: ['pda-stockcheck', checkId],
    queryFn: () => getScanCheckItemsApi(checkId),
  })

  const saveAction = useCriticalPdaAction<{ scannedContainers: number; actualQty: number; bookQty: number; diffQty: number }>({
    action: `stockcheck.scan.${checkId}`,
    requestAction: 'stockcheck.scan',
    label: `扫码盘点 ${detail?.checkNo || ''}`,
    onConfirmed: (data) => {
      ok(`已记录 ${data.scannedContainers} 个条码、实盘 ${data.actualQty}（账面 ${data.bookQty}，差异 ${data.diffQty > 0 ? '+' : ''}${data.diffQty}）`)
      setActiveItem(null)
      setScanned([])
      refetch()
    },
    // 断网重连兜底：回查该行扫码集是否已等于本次提交
    resolveServerState: async ({ record }) => {
      const itemId = Number(record.metadata?.itemId)
      const count = Number(record.metadata?.count)
      if (!itemId) return { effective: false }
      const d = await getScanCheckItemsApi(checkId).catch(() => null)
      const row = d?.items.find(i => i.id === itemId)
      if (row && row.actualQty != null && row.scannedContainerCount === count) {
        return { effective: true, data: { scannedContainers: row.scannedContainerCount, actualQty: row.actualQty, bookQty: row.bookQty, diffQty: row.actualQty - row.bookQty }, message: '该商品扫码结果已记录' }
      }
      return { effective: false }
    },
  })

  // 扫到容器码：先查容器——个体直接计 1；数量容器预填账面剩余、现场可改
  const addContainer = useCallback(async (raw: string) => {
    const bc = raw.trim()
    if (!bc || !activeItem || checking) return
    if (scanned.some(s => s.barcode.toUpperCase() === bc.toUpperCase())) { err(`条码 ${bc} 已扫过`); return }
    setChecking(true)
    try {
      const d = await getContainerByBarcodeApi(bc)
      if (d.productId !== activeItem.productId) { err(`条码 ${bc} 不是商品「${activeItem.productName}」的库存条码`); return }
      if (d.containerStatus !== 'stored') { err(`条码 ${bc} 不是在库条码（待上架/已出库不能盘）`); return }
      if (d.individual) {
        setScanned(prev => [...prev, { barcode: d.barcode, individual: true, bookQty: 1, countedQty: 1 }])
        ok(`单件 ${d.barcode} 计 1（已扫 ${scanned.length + 1} 个）`)
      } else {
        setScanned(prev => [...prev, { barcode: d.barcode, individual: false, bookQty: d.remainingQty, countedQty: d.remainingQty }])
        ok(`已扫 ${d.barcode}（账面 ${d.remainingQty}，请核对实物数量）`)
      }
    } catch (e: unknown) {
      err(formatPdaErrorMessage((e as { response?: { data?: { message?: string } } })?.response?.data?.message, '条码查询失败'))
    } finally {
      setChecking(false)
    }
  }, [activeItem, checking, scanned, err, ok])

  usePdaScanner({ onScan: (code) => { void addContainer(code) }, enabled: !!activeItem && !saveAction.submitBlocked })

  const submit = useCallback(() => {
    if (!activeItem) return
    if (saveAction.submitBlocked) { err(saveAction.blockedReason || '当前不可提交'); return }
    saveAction.run(
      (requestKey) => saveCheckItemScansApi(checkId, activeItem.id,
        scanned.map(s => (s.individual ? { barcode: s.barcode } : { barcode: s.barcode, countedQty: s.countedQty })),
        requestKey,
      ).then(r => r as { scannedContainers: number; actualQty: number; bookQty: number; diffQty: number }),
      { itemId: activeItem.id, count: scanned.length },
    ).catch((e: unknown) => err(formatPdaErrorMessage((e as { message?: string })?.message, '记录失败，请重试')))
  }, [activeItem, scanned, checkId, saveAction, err])

  const totalCounted = useMemo(() => scanned.reduce((sum, s) => sum + s.countedQty, 0), [scanned])
  const diffPreview = useMemo(() => {
    if (!activeItem) return null
    return totalCounted - activeItem.bookQty
  }, [activeItem, totalCounted])

  if (isLoading) return <PdaLoading />
  if (!detail) return <div className="p-8 text-center text-muted-foreground">盘点单不存在</div>

  // ── 作业中：某商品逐只扫容器 ──
  if (activeItem) {
    return (
      <div className="flex min-h-screen flex-col bg-background">
        <PdaHeader title={activeItem.productName} subtitle={`账面 ${activeItem.bookQty} ${activeItem.unit} · ${activeItem.bookContainerCount} 个在库条码`}
          backLabel="← 商品列表" onBack={() => { setActiveItem(null); setScanned([]) }} />
        <div className="max-w-md mx-auto flex-1 space-y-3 overflow-y-auto p-3 w-full">
          <PdaCard>
            <p className="text-sm">
              扫描<b>在架的每一个库存条码</b>：已扫 <b className="tabular-nums text-primary">{scanned.length}</b> 个 · 实盘 <b className="tabular-nums text-primary">{totalCounted}</b>
              {diffPreview !== null && diffPreview !== 0 && (
                <span className={diffPreview > 0 ? ' text-emerald-600' : ' text-amber-600'}>
                  （账面 {activeItem.bookQty}，差 {diffPreview > 0 ? '+' : ''}{diffPreview}）
                </span>
              )}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">扫完该商品的全部实物后点「提交本商品」；<b>没扫到的条码会被判为盘亏</b>，请务必扫全。数量容器预填账面数，实物少了就改成实际数。</p>
            <div className="mt-2 flex gap-2">
              <Input
                data-scanner-manual="true"
                value={manual}
                onChange={e => setManual(e.target.value)}
                placeholder="手动输入条码"
                className="h-10 flex-1"
                onKeyDown={e => { if (e.key === 'Enter') { void addContainer(manual); setManual('') } }}
              />
              <Button className="h-10" disabled={checking} onClick={() => { void addContainer(manual); setManual('') }}>加入</Button>
            </div>
          </PdaCard>

          <PdaCard>
            <p className="mb-2 text-sm font-medium">已扫条码（{scanned.length}）</p>
            {scanned.length === 0 && <p className="py-4 text-center text-xs text-muted-foreground">尚未扫描（扫码枪对准库存条码 / 塑料盒条码）</p>}
            <div className="space-y-1">
              {scanned.map(s => (
                <div key={s.barcode} className="flex items-center justify-between gap-2 rounded-md bg-background px-2 py-1 text-sm">
                  <span className="text-doc-code shrink-0">{s.barcode}</span>
                  {s.individual ? (
                    <span className="text-xs text-muted-foreground">单件 ×1</span>
                  ) : (
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      实盘
                      <Input
                        type="number" min={0} max={s.bookQty} step="0.0001"
                        data-scanner-manual="true"
                        className="h-7 w-20 text-right tabular-nums"
                        value={String(s.countedQty)}
                        onChange={e => {
                          const v = Number(e.target.value)
                          setScanned(prev => prev.map(x => x.barcode === s.barcode ? { ...x, countedQty: Number.isFinite(v) ? v : 0 } : x))
                        }}
                      />
                      <span className={s.countedQty !== s.bookQty ? 'text-amber-600' : ''}>/ 账面 {s.bookQty}</span>
                    </span>
                  )}
                  <button type="button" className="text-xs text-destructive shrink-0"
                    onClick={() => setScanned(prev => prev.filter(x => x.barcode !== s.barcode))}
                  >移除</button>
                </div>
              ))}
            </div>
          </PdaCard>
        </div>
        <PdaBottomBar>
          <Button className="w-full" disabled={saveAction.phase === 'submitting' || checking} onClick={submit}>
            {saveAction.phase === 'submitting' ? '提交中…' : `提交本商品（${scanned.length} 个条码 / 实盘 ${totalCounted}）`}
          </Button>
        </PdaBottomBar>
        <PdaFlash flash={flash} />
      </div>
    )
  }

  // ── 商品列表 ──
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <PdaHeader title={detail.checkNo} subtitle={`${detail.warehouseName} · 扫码盘点`} onBack={() => navigate('/pda/stockcheck')} />
      <div className="max-w-md mx-auto flex-1 space-y-2 overflow-y-auto p-3 w-full">
        {detail.items.length === 0 && <PdaCard><p className="py-8 text-center text-sm text-muted-foreground">该盘点单没有明细</p></PdaCard>}
        {detail.items.map(it => {
          const done = it.actualQty != null
          const diff = done && it.actualQty != null ? it.actualQty - it.bookQty : 0
          return (
            <button key={it.id} className="w-full" onClick={() => {
              setActiveItem(it)
              // 断点续扫：回显已扫集（整行替换语义要求带全量重提交）
              setScanned(it.scans.map(s => ({ barcode: s.barcode, individual: s.individual, bookQty: s.countedQty, countedQty: s.countedQty })))
            }}>
              <PdaCard>
                <div className="flex items-center justify-between">
                  <div className="min-w-0 text-left">
                    <p className="truncate font-medium text-foreground">{it.productName}</p>
                    <p className="text-xs text-muted-foreground">{it.productCode} · 账面 {it.bookQty} {it.unit} · {it.bookContainerCount} 个在库条码</p>
                  </div>
                  <div className="shrink-0 text-right text-sm">
                    {done
                      ? <span className={diff === 0 ? 'text-emerald-600' : 'text-amber-600'}>
                          已扫 {it.scannedContainerCount} 个{diff !== 0 ? `（${diff > 0 ? '+' : ''}${diff}）` : ' ✓'}
                        </span>
                      : <span className="text-muted-foreground">待盘</span>}
                  </div>
                </div>
              </PdaCard>
            </button>
          )
        })}
      </div>
      <PdaBottomBar>
        <p className="w-full text-center text-xs text-muted-foreground">选商品后逐一扫描在架库存条码；盈亏由系统比对账面得出</p>
      </PdaBottomBar>
      <PdaFlash flash={flash} />
    </div>
  )
}

export default function PdaStockcheckPage() {
  const { id } = useParams<{ id?: string }>()
  return id ? <CheckWork checkId={Number(id)} /> : <CheckList />
}
