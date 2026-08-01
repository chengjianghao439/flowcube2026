import { useState, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import PdaHeader from '@/components/pda/PdaHeader'
import PdaCard from '@/components/pda/PdaCard'
import PdaBottomBar from '@/components/pda/PdaBottomBar'
import PdaFlash from '@/components/pda/PdaFlash'
import { PdaLoading } from '@/components/pda/PdaEmptyState'
import { usePdaFeedback } from '@/hooks/usePdaFeedback'
import { useCriticalPdaAction } from '@/hooks/useCriticalPdaAction'
import { getInboundTasksApi, getInboundTaskByIdApi, qaCheckInboundApi } from '@/api/inbound-tasks'
import type { InboundTask, InboundTaskItem } from '@/types/inbound-tasks'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

// ── 待质检任务列表 ──
function QaTaskList() {
  const navigate = useNavigate()
  const { data, isLoading } = useQuery({
    queryKey: ['pda-inbound-qa-list'],
    queryFn: () => getInboundTasksApi({ page: 1, pageSize: 500, status: 3 }).then(r => r?.list ?? []),
  })
  const tasks = (data ?? []).filter((t: InboundTask) => !!t.submittedAt && Number(t.qaStatus) === 1)
  if (isLoading) return <PdaLoading />
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <PdaHeader title="来料质检" subtitle="待质检收货任务" onBack={() => navigate('/pda')} />
      <div className="flex-1 space-y-2 overflow-y-auto p-3">
        {tasks.length === 0 && <PdaCard><p className="py-8 text-center text-sm text-muted-foreground">暂无待质检任务</p></PdaCard>}
        {tasks.map(t => (
          <button key={t.id} className="w-full" onClick={() => navigate(`/pda/inbound-qa/${t.id}`)}>
            <PdaCard>
              <div className="flex items-center justify-between">
                <div className="text-left">
                  <p className="font-medium text-foreground">{t.taskNo}</p>
                  <p className="text-xs text-muted-foreground">{t.supplierName || '—'} · {t.warehouseName || ''}</p>
                </div>
                <span className="rounded-full bg-amber-500/10 px-3 py-1 text-xs font-semibold text-amber-600">待质检</span>
              </div>
            </PdaCard>
          </button>
        ))}
      </div>
    </div>
  )
}

// ── 单任务质检作业 ──
function QaTaskWork({ taskId }: { taskId: number }) {
  const navigate = useNavigate()
  const { flash, ok, err } = usePdaFeedback()
  const { data: task, isLoading, refetch } = useQuery({ queryKey: ['pda-inbound-qa', taskId], queryFn: () => getInboundTaskByIdApi(taskId) })
  const [selected, setSelected] = useState<InboundTaskItem | null>(null)
  // 三桶：正常合格 / 让步接收 / 拒收。合格量(passedQty)=正常合格+让步；让步(concessionQty)是其子集（旁路统计）。
  const [normalPass, setNormalPass] = useState('')
  const [concession, setConcession] = useState('')
  const [rejected, setRejected] = useState('')

  // 质检行按商品聚合待质检量（received − checked）
  const pending = useMemo(() => {
    const items = (task?.items ?? []).filter(i => i.qaRequired)
    const byProduct: Record<number, { item: InboundTaskItem; toCheck: number }> = {}
    for (const i of items) {
      const toCheck = Number(i.receivedQty) - Number(i.checkedQty || 0)
      if (toCheck <= 0) continue
      if (byProduct[i.productId]) byProduct[i.productId].toCheck += toCheck
      else byProduct[i.productId] = { item: i, toCheck }
    }
    return Object.values(byProduct)
  }, [task])

  const checkAction = useCriticalPdaAction<{ taskId: number }>({
    action: `inbound.qa.${taskId}`,
    requestAction: 'inbound.qa.check',
    label: `来料质检 ${task?.taskNo || ''}`,
    onConfirmed: () => { ok('质检已确认'); setSelected(null); setNormalPass(''); setConcession(''); setRejected(''); refetch() },
  })

  if (isLoading) return <PdaLoading />
  if (!task) return <div className="p-8 text-center text-muted-foreground">任务不存在</div>

  const submit = (row: { item: InboundTaskItem; toCheck: number }) => {
    const np = Number(normalPass) || 0
    const c = Number(concession) || 0
    const r = Number(rejected) || 0
    const passed = np + c   // 合格量（含让步）
    if (np < 0 || c < 0 || r < 0) { err('数量不能为负'); return }
    if (passed + r <= 0) { err('请输入合格或拒收数量'); return }
    if (passed + r > row.toCheck) { err(`质检量超过待质检 ${row.toCheck}`); return }
    checkAction.run(
      (requestKey) => qaCheckInboundApi(taskId, { productId: row.item.productId, passedQty: passed, rejectedQty: r, concessionQty: c }, requestKey).then(res => res as { taskId: number }),
      { productId: row.item.productId, expectedQty: passed + r },
    )
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <PdaHeader title={task.taskNo} subtitle={`来料质检 · ${task.supplierName || ''}`} onBack={() => navigate('/pda/inbound-qa')} />
      <div className="flex-1 space-y-3 overflow-y-auto p-3">
        {pending.length === 0 && <PdaCard><p className="py-8 text-center text-sm text-muted-foreground">本任务已无待质检商品，可返回上架</p></PdaCard>}
        {pending.map(row => {
          const isSel = selected?.productId === row.item.productId
          return (
            <PdaCard key={row.item.productId}>
              <button className="w-full text-left" onClick={() => { setSelected(isSel ? null : row.item); setNormalPass(String(row.toCheck)); setConcession('0'); setRejected('0') }}>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-foreground">{row.item.productName}</p>
                    <p className="text-xs text-muted-foreground text-doc-code">{row.item.productCode}</p>
                  </div>
                  <span className="text-sm tabular-nums">待质检 <b className="text-amber-600">{row.toCheck}</b> {row.item.unit || ''}</span>
                </div>
              </button>
              {isSel && (
                <div className="mt-3 space-y-2 border-t border-border pt-3">
                  <div className="flex items-center gap-2">
                    <span className="w-20 text-sm text-emerald-600">正常合格</span>
                    <Input type="number" min="0" value={normalPass} onChange={e => setNormalPass(e.target.value)} className="h-10 flex-1 text-right tabular-nums" />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-20 text-sm text-amber-600">让步接收</span>
                    <Input type="number" min="0" value={concession} onChange={e => setConcession(e.target.value)} className="h-10 flex-1 text-right tabular-nums" />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-20 text-sm text-red-600">拒收量</span>
                    <Input type="number" min="0" value={rejected} onChange={e => setRejected(e.target.value)} className="h-10 flex-1 text-right tabular-nums" />
                  </div>
                  <p className="text-xs text-muted-foreground">正常合格与让步接收都可上架并计入应付（让步=不良但协商接收，仅作质量统计区分）；拒收量转不合格区，不入库不结算。</p>
                  <Button className="w-full" disabled={checkAction.phase === 'submitting'} onClick={() => submit(row)}>
                    {checkAction.phase === 'submitting' ? '提交中...' : '确认质检'}
                  </Button>
                </div>
              )}
            </PdaCard>
          )
        })}
      </div>
      <PdaBottomBar>
        <p className="w-full text-center text-xs text-muted-foreground">质检合格的容器方可扫码上架；全部质检完成后到「上架」作业</p>
      </PdaBottomBar>
      <PdaFlash flash={flash} />
    </div>
  )
}

export default function PdaInboundQaPage() {
  const { id } = useParams<{ id?: string }>()
  return id ? <QaTaskWork taskId={Number(id)} /> : <QaTaskList />
}
