import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
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
import { getReturnTaskByIdApi, getReturnPutawayContainerApi, getReturnPutawayLocationApi, putawayReturnApi } from '@/api/returns'
import { Button } from '@/components/ui/button'
import { parseBarcode } from '@/utils/barcode'

export default function PdaSaleReturnPutawayPage() {
  const { id } = useParams<{ id: string }>()
  const taskId = Number(id)
  const nav = useNavigate()
  const { flash, ok, err } = usePdaFeedback()
  const [step, setStep] = useState<'container' | 'location'>('container')
  const [containerId, setContainerId] = useState<number | null>(null)
  const [containerBarcode, setContainerBarcode] = useState('')
  const [scanning, setScanning] = useState(false)
  const scanInFlight = useRef(false)
  const scanGeneration = useRef(0)
  const taskLifetime = useMemo(() => ({ taskId, active: true }), [taskId])
  useEffect(() => {
    taskLifetime.active = true
    scanGeneration.current += 1
    scanInFlight.current = false
    setScanning(false)
    setStep('container')
    setContainerId(null)
    setContainerBarcode('')
    return () => { scanGeneration.current += 1; taskLifetime.active = false }
  }, [taskId, taskLifetime])

  const { data: task, isLoading, refetch } = useQuery({
    queryKey: ['pda-return-task', taskId],
    queryFn: () => getReturnTaskByIdApi(taskId),
    enabled: !!taskId,
    refetchInterval: 10_000,
  })

  // 结果不确定时依照同一操作回执确认，不将扫码当作自动重放。
  const putawayAction = useCriticalPdaAction({
    action: `return.putaway.${taskId}`,
    requestAction: 'return.putaway',
    label: `退货上架 ${task?.taskNo || ''}`,
    onConfirmed: () => {
      if (!taskLifetime.active) return
      setStep('container')
      setContainerId(null)
      setContainerBarcode('')
      void refetch()
    },
  })

  const handleScan = useCallback(async (raw: string) => {
    if (scanInFlight.current || putawayAction.submitBlocked || !task) return
    if (task.status !== 4) { err('只有待上架状态可以执行上架'); return }
    const barcode = raw.trim()
    const parsed = parseBarcode(barcode)
    if (parsed.type !== (step === 'container' ? 'container' : 'location')) {
      err(step === 'container' ? '请扫描待上架容器条码（I 或 CNT 开头）' : '请扫描库位条码（LOC- 或 R 开头）')
      return
    }
    scanInFlight.current = true
    setScanning(true)
    const generation = scanGeneration.current
    try {
      if (step === 'container') {
        const container = await getReturnPutawayContainerApi(taskId, barcode)
        if (generation !== scanGeneration.current) return
        if (!Number.isSafeInteger(container.containerId) || container.containerId <= 0 || container.taskId !== taskId || container.warehouseId !== task.warehouseId || container.status !== 4) {
          throw new Error('容器不是当前退货任务的待上架容器')
        }
        setContainerId(container.containerId)
        setContainerBarcode(container.barcode)
        setStep('location')
        ok(`容器 ${container.barcode}`)
      } else {
        if (containerId == null) throw new Error('请先扫描待上架容器')
        const location = await getReturnPutawayLocationApi(taskId, barcode)
        if (generation !== scanGeneration.current) return
        if (!Number.isSafeInteger(location.id) || location.id <= 0 || location.warehouseId !== task.warehouseId || location.status !== 1) {
          throw new Error('库位不可用或不在当前退货任务仓库')
        }
        const result = await putawayAction.run(requestKey =>
          putawayReturnApi(taskId, { containerId, locationId: location.id }, requestKey).then(r => r!)
        )
        if (generation !== scanGeneration.current) return
        if (result.kind === 'success') ok(`上架成功 → ${location.code}`)
      }
    } catch (error) {
      if (generation === scanGeneration.current) err(error instanceof Error ? error.message : '扫码上架失败，请重试')
    } finally {
      if (generation === scanGeneration.current) {
        scanInFlight.current = false
        setScanning(false)
      }
    }
  }, [step, containerId, ok, err, putawayAction, taskId, task])

  if (isLoading) return <div className="flex min-h-screen flex-col bg-background"><PdaHeader title="退货上架" onBack={() => nav('/pda/sale-return')} /><PdaLoading /></div>
  if (!task) return <div className="flex min-h-screen flex-col bg-background"><PdaHeader title="退货上架" onBack={() => nav('/pda/sale-return')} /><div className="p-4 text-center text-muted-foreground">任务不存在</div></div>
  if (task.status === 5) return <div className="flex min-h-screen flex-col bg-background"><PdaHeader title="退货上架" onBack={() => nav('/pda/sale-return')} /><div className="p-4 text-center text-green-600 font-semibold">退货入仓已完成</div></div>
  if (task.status !== 4) return <div className="flex min-h-screen flex-col bg-background"><PdaHeader title="退货上架" onBack={() => nav('/pda/sale-return')} /><div className="p-4 text-center text-muted-foreground">当前任务不在待上架状态，请先核对质检进度与任务状态。</div></div>

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <PdaHeader title="退货上架" subtitle={task.taskNo} onBack={() => nav('/pda/sale-return')} />
      <PdaFlash flash={flash} />

      <div className="flex-1 overflow-y-auto px-4 py-4 max-w-md mx-auto w-full space-y-3">
        {putawayAction.blockedReason && (
          <div role="status" className="space-y-2 text-sm text-muted-foreground">
            <p>{putawayAction.phaseMessage || putawayAction.blockedReason}</p>
            {putawayAction.pendingRecord && <Button type="button" variant="outline" disabled={putawayAction.confirming} onClick={() => void putawayAction.confirmPending()}>确认上次结果</Button>}
          </div>
        )}
        <PdaCard active={step === 'container'} done={!!containerBarcode}>
          <div className="text-sm text-muted-foreground">步骤 1</div>
          <div className="font-semibold">扫描容器条码</div>
          {containerBarcode && <div className="mt-2 font-mono text-lg text-green-600">{containerBarcode}</div>}
        </PdaCard>
        <PdaCard active={step === 'location'}>
          <div className="text-sm text-muted-foreground">步骤 2</div>
          <div className="font-semibold">扫描库位条码</div>
        </PdaCard>

        {!!task.pendingPutawayContainers?.length && (
          <section aria-label="待上架容器" className="space-y-2 text-sm">
            <p className="font-medium">待上架容器</p>
            <p className="text-muted-foreground">请核对质检后的条码和数量，贴好对应标签后扫描实物上架。</p>
            <ul className="divide-y rounded-md border px-3">
              {task.pendingPutawayContainers.map(container => (
                <li key={container.id} className="flex justify-between gap-3 py-2">
                  <div><p className="font-mono">{container.barcode}</p><p className="text-muted-foreground">{container.productName}</p></div>
                  <span className="shrink-0">数量 {container.qty}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <div className="text-sm text-muted-foreground mt-4">
          已上架 / 待上架：{
            task.items?.reduce((s, i) => s + i.putawayQty, 0) || 0
          } / {
            task.items?.reduce((s, i) => s + i.checkedQty, 0) || 0
          }
        </div>
      </div>

      <PdaBottomBar>
        <PdaScanner onScan={handleScan} allowManualEntry={false} disabled={scanning || putawayAction.submitBlocked || task.status !== 4}
          placeholder={step === 'container' ? '扫描容器条码（I/CNT 开头）...' : '扫描库位条码（LOC-/R 开头）...'}
        />
      </PdaBottomBar>
    </div>
  )
}
