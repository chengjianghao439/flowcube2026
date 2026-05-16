import { useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import PdaHeader from '@/components/pda/PdaHeader'
import PdaCard from '@/components/pda/PdaCard'
import PdaBottomBar from '@/components/pda/PdaBottomBar'
import PdaScanner from '@/components/pda/PdaScanner'
import PdaFlash from '@/components/pda/PdaFlash'
import { PdaLoading } from '@/components/pda/PdaEmptyState'
import { usePdaFeedback } from '@/hooks/usePdaFeedback'
import { useCriticalPdaAction } from '@/hooks/useCriticalPdaAction'
import { getReturnTaskByIdApi, putawayReturnApi } from '@/api/returns'
import { parseBarcode } from '@/utils/barcode'

export default function PdaSaleReturnPutawayPage() {
  const { id } = useParams<{ id: string }>()
  const taskId = Number(id)
  const nav = useNavigate()
  const { flash, ok, err } = usePdaFeedback()
  const [step, setStep] = useState<'container' | 'location'>('container')
  const [containerId, setContainerId] = useState<number | null>(null)
  const [containerBarcode, setContainerBarcode] = useState('')

  const { data: task, isLoading } = useQuery({
    queryKey: ['pda-return-task', taskId],
    queryFn: () => getReturnTaskByIdApi(taskId),
    enabled: !!taskId,
    refetchInterval: 10_000,
  })

  const putawayAction = useCriticalPdaAction({
    action: `return.putaway.${taskId}`,
    label: `退货上架 ${task?.taskNo || ''}`,
    onConfirmed: () => {
      setStep('container')
      setContainerId(null)
      setContainerBarcode('')
    },
  })

  const handleScan = useCallback((raw: string) => {
    const parsed = parseBarcode(raw.trim())
    if (step === 'container') {
      if (parsed?.type === 'container') {
        // TODO: 需要 API 验证容器属于此任务且状态为 PENDING_PUTAWAY
        setContainerId(Number(parsed.code))
        setContainerBarcode(raw.trim())
        ok(`容器 ${raw.trim()}`)
        setStep('location')
      } else {
        err('请扫描待上架容器条码（I 开头）')
      }
    } else {
      if (parsed?.type === 'location') {
        if (!containerId) return
        putawayAction.run(requestKey =>
          putawayReturnApi(taskId, { containerId, locationId: Number(parsed.code) }, requestKey).then(r => r!)
        ).then(result => {
          if (result.kind === 'success') ok(`上架成功 → ${raw.trim()}`)
        })
      } else {
        err('请扫描库位条码（LOC- 或 R 开头）')
      }
    }
  }, [step, containerId, ok, err, putawayAction, taskId])

  if (isLoading) return <div className="flex min-h-screen flex-col bg-background"><PdaHeader title="退货上架" onBack={() => nav('/pda/sale-return')} /><PdaLoading /></div>
  if (!task) return <div className="flex min-h-screen flex-col bg-background"><PdaHeader title="退货上架" onBack={() => nav('/pda/sale-return')} /><div className="p-4 text-center text-muted-foreground">任务不存在</div></div>
  if (task.status === 5) return <div className="flex min-h-screen flex-col bg-background"><PdaHeader title="退货上架" onBack={() => nav('/pda/sale-return')} /><div className="p-4 text-center text-green-600 font-semibold">退货入仓已完成</div></div>

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <PdaHeader title="退货上架" subtitle={task.taskNo} onBack={() => nav('/pda/sale-return')} />
      <PdaFlash flash={flash} />

      <div className="flex-1 overflow-y-auto px-4 py-4 max-w-md mx-auto w-full space-y-3">
        <PdaCard active={step === 'container'} done={!!containerBarcode}>
          <div className="text-sm text-muted-foreground">步骤 1</div>
          <div className="font-semibold">扫描容器条码</div>
          {containerBarcode && <div className="mt-2 font-mono text-lg text-green-600">{containerBarcode}</div>}
        </PdaCard>
        <PdaCard active={step === 'location'}>
          <div className="text-sm text-muted-foreground">步骤 2</div>
          <div className="font-semibold">扫描库位条码</div>
        </PdaCard>

        <div className="text-sm text-muted-foreground mt-4">
          已上架 / 待上架：{
            task.items?.reduce((s, i) => s + i.putawayQty, 0) || 0
          } / {
            task.items?.reduce((s, i) => s + i.checkedQty, 0) || 0
          }
        </div>
      </div>

      <PdaBottomBar>
        <PdaScanner onScan={handleScan} allowManualEntry={false}
          placeholder={step === 'container' ? '扫描容器条码（I 开头）...' : '扫描库位条码（LOC-/R 开头）...'}
        />
      </PdaBottomBar>
    </div>
  )
}
