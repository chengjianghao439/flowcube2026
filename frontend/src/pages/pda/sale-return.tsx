import { ArrowDownToLine } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import PdaHeader from '@/components/pda/PdaHeader'
import PdaCard from '@/components/pda/PdaCard'
import { PdaLoading, PdaEmptyCard } from '@/components/pda/PdaEmptyState'
import { SoftStatusLabel } from '@/components/shared/StatusBadge'
import type { StatusTone } from '@/lib/statusTone'
import { getPdaReturnTasksApi, type ReturnTask } from '@/api/returns'

/** return_tasks 内联状态机：1待收货 2收货中 3待质检 4待上架 5已完成 6已取消 */
const STATUS_TONE: Record<number, StatusTone> = {
  1: 'draft', 2: 'active', 3: 'active', 4: 'active', 5: 'success', 6: 'danger',
}

function TaskCard({ task }: { task: ReturnTask }) {
  const nav = useNavigate()
  const canEnter = [1, 2, 3, 4].includes(task.status)

  return (
    <PdaCard
      active={canEnter}
      onClick={canEnter ? () => {
        if (task.status <= 3) nav(`/pda/sale-return/${task.id}/receive`)
        else nav(`/pda/sale-return/${task.id}/putaway`)
      } : undefined}
    >
      <div className="flex items-start justify-between">
        <div>
          <div className="text-sm font-mono text-muted-foreground">{task.taskNo}</div>
          <div className="font-semibold mt-1">{task.partyName || task.returnNo}</div>
        </div>
        <SoftStatusLabel label={task.statusName} tone={STATUS_TONE[task.status] ?? 'draft'} />
      </div>
    </PdaCard>
  )
}

export default function PdaSaleReturnListPage() {
  const nav = useNavigate()
  const { data: tasks, isLoading } = useQuery({
    queryKey: ['pda-return-tasks'],
    queryFn: getPdaReturnTasksApi,
    refetchInterval: 15_000,
  })

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <PdaHeader title="销售退货" subtitle="退货收货/质检/上架" onBack={() => nav('/pda')} />
      <div className="flex-1 overflow-y-auto px-4 py-4 max-w-md mx-auto w-full space-y-3">
        {isLoading && <PdaLoading />}
        {!isLoading && (!tasks || tasks.length === 0) && (
          <PdaEmptyCard icon={<ArrowDownToLine className="h-12 w-12 text-muted-foreground" />} title="暂无退货任务" description="请在 ERP 端确认退货单并提交到 PDA" />
        )}
        {tasks?.map(t => <TaskCard key={t.id} task={t} />)}
      </div>
    </div>
  )
}
