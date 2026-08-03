/**
 * PDA 序列号盘点（文档04 Phase3b·C-full）
 * 路由：/pda/stockcheck（含序列号商品的进行中盘点单）、/pda/stockcheck/:id（逐商品逐台扫码）
 *
 * 序列号商品的实盘数**不是人填的数字，而是现场逐台扫出来的**：操作员把该商品在架的每一台
 * 都扫一遍，系统据此算「账面有但没扫到 = 盘亏这几台」「扫到但账面没有 = 盘盈这几台」。
 * 仓库端只负责如实扫，盈亏判定与提交在 ERP 侧（守 CLAUDE.md「仓库端只执行不决策」）。
 *
 * 提交为**整行替换语义**：一次提交该商品扫到的全部台，天然幂等，断网重来直接重扫覆盖。
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
import { getPendingSerialChecksApi, getSerialCheckItemsApi, saveCheckItemSerialsApi } from '@/api/stockcheck'
import type { PendingSerialCheck, SerialCheckItem } from '@/types/stockcheck'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { formatPdaErrorMessage } from '@/utils/displayFormatters'

// ── 待盘点单列表 ──
function CheckList() {
  const navigate = useNavigate()
  const { data, isLoading } = useQuery({
    queryKey: ['pda-stockcheck-pending'],
    queryFn: () => getPendingSerialChecksApi().then(r => r ?? []),
    refetchInterval: 15_000,
  })
  const list: PendingSerialCheck[] = data ?? []
  if (isLoading) return <PdaLoading />
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <PdaHeader title="序列号盘点" subtitle="逐台扫描在架序列号" onBack={() => navigate('/pda')} />
      <div className="flex-1 space-y-2 overflow-y-auto p-3">
        {list.length === 0 && <PdaCard><p className="py-8 text-center text-sm text-muted-foreground">暂无待盘点的序列号商品</p></PdaCard>}
        {list.map(c => (
          <button key={c.id} className="w-full" onClick={() => navigate(`/pda/stockcheck/${c.id}`)}>
            <PdaCard>
              <div className="flex items-center justify-between">
                <div className="text-left">
                  <p className="font-medium text-foreground">{c.checkNo}</p>
                  <p className="text-xs text-muted-foreground">{c.warehouseName}</p>
                </div>
                <span className="text-sm tabular-nums">待盘 <b className="text-amber-600">{c.pendingCount}</b>/{c.serialItemCount}</span>
              </div>
            </PdaCard>
          </button>
        ))}
      </div>
    </div>
  )
}

// ── 单盘点单作业：选商品 → 逐台扫 → 提交该商品 ──
function CheckWork({ checkId }: { checkId: number }) {
  const navigate = useNavigate()
  const { flash, ok, err } = usePdaFeedback()
  const [activeItem, setActiveItem] = useState<SerialCheckItem | null>(null)
  const [scanned, setScanned] = useState<string[]>([])
  const [manual, setManual] = useState('')

  const { data: detail, isLoading, refetch } = useQuery({
    queryKey: ['pda-stockcheck', checkId],
    queryFn: () => getSerialCheckItemsApi(checkId),
  })

  const saveAction = useCriticalPdaAction<{ scannedCount: number; bookQty: number; diffQty: number }>({
    action: `stockcheck.serials.${checkId}`,
    requestAction: 'stockcheck.serials',
    label: `序列号盘点 ${detail?.checkNo || ''}`,
    onConfirmed: (data) => {
      const d = data.diffQty
      ok(`已记录 ${data.scannedCount} 台（账面 ${data.bookQty}，差异 ${d > 0 ? '+' : ''}${d}）`)
      setActiveItem(null)
      setScanned([])
      refetch()
    },
    // 断网重连兜底：回查该行已扫台数是否已等于本次提交的台数
    resolveServerState: async ({ record }) => {
      const itemId = Number(record.metadata?.itemId)
      const count = Number(record.metadata?.count)
      if (!itemId) return { effective: false }
      const d = await getSerialCheckItemsApi(checkId).catch(() => null)
      const row = d?.items.find(i => i.id === itemId)
      if (row && row.actualQty != null && row.scannedCount === count) {
        return { effective: true, data: { scannedCount: row.scannedCount, bookQty: row.bookQty, diffQty: row.scannedCount - row.bookQty }, message: '该商品扫码结果已记录' }
      }
      return { effective: false }
    },
  })

  const addSerial = useCallback((raw: string) => {
    const sn = raw.trim()
    if (!sn || !activeItem) return
    setScanned(prev => {
      if (prev.includes(sn)) { err(`序列号 ${sn} 已扫过`); return prev }
      ok(`已扫 ${sn}（${prev.length + 1} 台）`)
      return [...prev, sn]
    })
  }, [activeItem, err, ok])

  usePdaScanner({ onScan: addSerial, enabled: !!activeItem && !saveAction.submitBlocked })

  const submit = useCallback(() => {
    if (!activeItem) return
    if (saveAction.submitBlocked) { err(saveAction.blockedReason || '当前不可提交'); return }
    saveAction.run(
      (requestKey) => saveCheckItemSerialsApi(checkId, activeItem.id, scanned, requestKey)
        .then(r => r as { scannedCount: number; bookQty: number; diffQty: number }),
      { itemId: activeItem.id, count: scanned.length },
    ).catch((e: unknown) => err(formatPdaErrorMessage((e as { message?: string })?.message, '记录失败，请重试')))
  }, [activeItem, scanned, checkId, saveAction, err])

  const diffPreview = useMemo(() => {
    if (!activeItem) return null
    return scanned.length - activeItem.bookQty
  }, [activeItem, scanned])

  if (isLoading) return <PdaLoading />
  if (!detail) return <div className="p-8 text-center text-muted-foreground">盘点单不存在</div>

  // ── 作业中：某商品逐台扫 ──
  if (activeItem) {
    return (
      <div className="flex min-h-screen flex-col bg-background">
        <PdaHeader title={activeItem.productName} subtitle={`账面 ${activeItem.bookQty} ${activeItem.unit}`}
          backLabel="← 商品列表" onBack={() => { setActiveItem(null); setScanned([]) }} />
        <div className="flex-1 space-y-3 overflow-y-auto p-3">
          <PdaCard>
            <p className="text-sm">
              逐台扫描<b>在架的每一台</b>：已扫 <b className="tabular-nums text-primary">{scanned.length}</b> 台
              {diffPreview !== null && diffPreview !== 0 && (
                <span className={diffPreview > 0 ? ' text-emerald-600' : ' text-amber-600'}>
                  （账面 {activeItem.bookQty}，差 {diffPreview > 0 ? '+' : ''}{diffPreview}）
                </span>
              )}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">扫完这台商品的全部实物后点「提交本商品」；少扫的台会被判为盘亏，请务必扫全。</p>
            <div className="mt-2 flex gap-2">
              <Input
                data-scanner-manual="true"
                value={manual}
                onChange={e => setManual(e.target.value)}
                placeholder="手动输入序列号"
                className="h-10 flex-1"
                onKeyDown={e => { if (e.key === 'Enter') { addSerial(manual); setManual('') } }}
              />
              <Button className="h-10" onClick={() => { addSerial(manual); setManual('') }}>加入</Button>
            </div>
          </PdaCard>

          <PdaCard>
            <p className="mb-2 text-sm font-medium">已扫序列号（{scanned.length}）</p>
            {scanned.length === 0 && <p className="py-4 text-center text-xs text-muted-foreground">尚未扫描（扫码枪对准机身序列号）</p>}
            <div className="space-y-1">
              {scanned.map(sn => (
                <div key={sn} className="flex items-center justify-between rounded-md bg-background px-2 py-1 text-sm">
                  <span className="text-doc-code">{sn}</span>
                  <button type="button" className="text-xs text-destructive"
                    onClick={() => setScanned(prev => prev.filter(x => x !== sn))}
                  >移除</button>
                </div>
              ))}
            </div>
          </PdaCard>
        </div>
        <PdaBottomBar>
          <Button className="w-full" disabled={saveAction.phase === 'submitting'} onClick={submit}>
            {saveAction.phase === 'submitting' ? '提交中…' : `提交本商品（${scanned.length} 台）`}
          </Button>
        </PdaBottomBar>
        <PdaFlash flash={flash} />
      </div>
    )
  }

  // ── 商品列表 ──
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <PdaHeader title={detail.checkNo} subtitle={`${detail.warehouseName} · 序列号商品盘点`} onBack={() => navigate('/pda/stockcheck')} />
      <div className="flex-1 space-y-2 overflow-y-auto p-3">
        {detail.items.length === 0 && <PdaCard><p className="py-8 text-center text-sm text-muted-foreground">该盘点单没有序列号商品</p></PdaCard>}
        {detail.items.map(it => {
          const done = it.actualQty != null
          const diff = done ? it.scannedCount - it.bookQty : 0
          return (
            <button key={it.id} className="w-full" onClick={() => { setActiveItem(it); setScanned([]) }}>
              <PdaCard>
                <div className="flex items-center justify-between">
                  <div className="min-w-0 text-left">
                    <p className="truncate font-medium text-foreground">{it.productName}</p>
                    <p className="text-xs text-muted-foreground">{it.productCode} · 账面 {it.bookQty} {it.unit}</p>
                  </div>
                  <div className="shrink-0 text-right text-sm">
                    {done
                      ? <span className={diff === 0 ? 'text-emerald-600' : (diff > 0 ? 'text-emerald-600' : 'text-amber-600')}>
                          已扫 {it.scannedCount}{diff !== 0 ? `（${diff > 0 ? '+' : ''}${diff}）` : ' ✓'}
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
        <p className="w-full text-center text-xs text-muted-foreground">选商品后逐台扫描在架序列号；盈亏由系统比对账面得出</p>
      </PdaBottomBar>
      <PdaFlash flash={flash} />
    </div>
  )
}

export default function PdaStockcheckPage() {
  const { id } = useParams<{ id?: string }>()
  return id ? <CheckWork checkId={Number(id)} /> : <CheckList />
}
