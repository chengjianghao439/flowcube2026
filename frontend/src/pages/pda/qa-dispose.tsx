/**
 * PDA 拒收处置物理扫出（文档07 Phase3）
 * 路由：/pda/qa-dispose（待扫出处置单列表）、/pda/qa-dispose/:id（扫码作业）
 *
 * 决策（退供应商/报废/哪些商品）在 ERP 已定；PDA 只对**系统列出**的 REJECTED 容器逐个扫码
 * 物理确认出场（void），操作员不自选、不决策（守 CLAUDE.md「仓库端只执行不决策」）。
 */
import { useState, useCallback } from 'react'
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
import { getQaDisposePendingApi, getQaDisposeScanDetailApi, qaDisposeScanOutApi } from '@/api/inbound-tasks'
import type { QaDisposition } from '@/types/inbound-tasks'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

// ── 待扫出处置单列表 ──
function DisposeList() {
  const navigate = useNavigate()
  const { data, isLoading } = useQuery({
    queryKey: ['pda-dispose-pending'],
    queryFn: () => getQaDisposePendingApi().then(r => r ?? []),
  })
  const list: QaDisposition[] = data ?? []
  if (isLoading) return <PdaLoading />
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <PdaHeader title="拒收处置扫出" subtitle="待物理出场确认" onBack={() => navigate('/pda')} />
      <div className="flex-1 space-y-2 overflow-y-auto p-3">
        {list.length === 0 && <PdaCard><p className="py-8 text-center text-sm text-muted-foreground">暂无待扫出处置单</p></PdaCard>}
        {list.map(d => {
          const total = (d.scannedCount ?? 0) + (d.pendingCount ?? 0)
          return (
            <button key={d.id} className="w-full" onClick={() => navigate(`/pda/qa-dispose/${d.id}`)}>
              <PdaCard>
                <div className="flex items-center justify-between">
                  <div className="text-left">
                    <p className="font-medium text-foreground">{d.dispositionNo}</p>
                    <p className="text-xs text-muted-foreground">{d.dispositionTypeName} · {d.supplierName || '—'} · {d.warehouseName || ''}</p>
                  </div>
                  <span className="text-sm tabular-nums">待扫 <b className="text-amber-600">{d.pendingCount ?? 0}</b>/{total}</span>
                </div>
              </PdaCard>
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ── 单处置单扫出作业 ──
function DisposeWork({ dispositionId }: { dispositionId: number }) {
  const navigate = useNavigate()
  const { flash, ok, err } = usePdaFeedback()
  const { data: detail, isLoading, refetch } = useQuery({
    queryKey: ['pda-dispose', dispositionId],
    queryFn: () => getQaDisposeScanDetailApi(dispositionId),
  })
  const [manual, setManual] = useState('')

  const scanAction = useCriticalPdaAction<{ done: boolean; pending: number }>({
    action: `inbound.qa.dispose.scan.${dispositionId}`,
    requestAction: 'inbound.qa.dispose.scan',
    label: `拒收扫出 ${detail?.dispositionNo || ''}`,
    onConfirmed: (data) => {
      ok(data.done ? '全部扫出完成，处置单已完成' : '已确认扫出')
      refetch()
      if (data.done) setTimeout(() => navigate('/pda/qa-dispose'), 700)
    },
    // 断网重连兜底：回查该容器是否已扫出（回执之外的第二道确认）
    resolveServerState: async ({ record }) => {
      const bc = record.metadata?.barcode as string | undefined
      if (!bc) return { effective: false }
      const d = await getQaDisposeScanDetailApi(dispositionId).catch(() => null)
      if (!d) return { effective: false }
      const c = d.containers.find(x => x.barcode === bc)
      if (c?.scanned) return { effective: true, data: { done: d.status === 2, pending: d.pendingCount ?? 0 }, message: '该容器已确认扫出' }
      return { effective: false }
    },
  })

  const submitScan = useCallback((raw: string) => {
    const barcode = raw.trim()
    if (!barcode || !detail) return
    const target = detail.containers.find(c => c.barcode === barcode)
    if (!target) { err(`条码 ${barcode} 不在待扫清单`); return }
    if (target.scanned) { err(`容器 ${barcode} 已扫出`); return }
    scanAction.run(
      (requestKey) => qaDisposeScanOutApi(dispositionId, barcode, requestKey).then(res => res as { done: boolean; pending: number }),
      { barcode },
    )
  }, [detail, dispositionId, scanAction, err])

  usePdaScanner({ onScan: submitScan, enabled: !!detail })

  if (isLoading) return <PdaLoading />
  if (!detail) return <div className="p-8 text-center text-muted-foreground">处置单不存在</div>
  const pending = detail.containers.filter(c => !c.scanned)
  const scanned = detail.containers.filter(c => c.scanned)

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <PdaHeader title={detail.dispositionNo} subtitle={`${detail.dispositionTypeName} · 扫出确认`} onBack={() => navigate('/pda/qa-dispose')} />
      <div className="flex-1 space-y-3 overflow-y-auto p-3">
        <PdaCard>
          <p className="text-sm">扫码逐个确认拒收容器物理出场（<b className="tabular-nums text-emerald-600">{scanned.length}</b>/{detail.containers.length}）</p>
          <div className="mt-2 flex gap-2">
            <Input
              data-scanner-manual="true"
              value={manual}
              onChange={e => setManual(e.target.value)}
              placeholder="手动输入容器条码"
              className="h-10 flex-1"
              onKeyDown={e => { if (e.key === 'Enter') { submitScan(manual); setManual('') } }}
            />
            <Button className="h-10" disabled={scanAction.phase === 'submitting'} onClick={() => { submitScan(manual); setManual('') }}>确认</Button>
          </div>
        </PdaCard>
        {pending.length > 0 && (
          <PdaCard>
            <p className="mb-2 text-sm font-medium text-amber-600">待扫出（{pending.length}）</p>
            <div className="space-y-1.5">
              {pending.map(c => (
                <div key={c.id} className="flex items-center justify-between text-sm">
                  <span className="text-doc-code">{c.barcode}</span>
                  <span className="text-muted-foreground">{c.productName} · {c.qty}</span>
                </div>
              ))}
            </div>
          </PdaCard>
        )}
        {scanned.length > 0 && (
          <PdaCard>
            <p className="mb-2 text-sm font-medium text-emerald-600">已扫出（{scanned.length}）</p>
            <div className="space-y-1.5">
              {scanned.map(c => (
                <div key={c.id} className="flex items-center justify-between text-sm opacity-60">
                  <span className="text-doc-code line-through">{c.barcode}</span>
                  <span className="text-emerald-600">✓</span>
                </div>
              ))}
            </div>
          </PdaCard>
        )}
      </div>
      <PdaBottomBar>
        <p className="w-full text-center text-xs text-muted-foreground">扫码枪对准容器条码即可；全部扫完处置单自动完成</p>
      </PdaBottomBar>
      <PdaFlash flash={flash} />
    </div>
  )
}

export default function PdaQaDisposePage() {
  const { id } = useParams<{ id?: string }>()
  return id ? <DisposeWork dispositionId={Number(id)} /> : <DisposeList />
}
