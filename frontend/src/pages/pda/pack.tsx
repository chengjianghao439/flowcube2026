/**
 * PDA 打包作业
 * 路由：/pda/pack
 */
import { useState, useCallback } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { parseBarcode } from '@/utils/barcode'
import PdaScanner from '@/components/pda/PdaScanner'
import PdaHeader from '@/components/pda/PdaHeader'
import PdaCard from '@/components/pda/PdaCard'
import PdaBottomBar from '@/components/pda/PdaBottomBar'
import PdaFlash from '@/components/pda/PdaFlash'
import { PdaEmptyCard, PdaLoading } from '@/components/pda/PdaEmptyState'
import PdaFlowPanel from '@/components/pda/PdaFlowPanel'
import PdaStat, { PdaStatGrid } from '@/components/pda/PdaStat'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { getTaskByIdApi, getTasksApi, packDoneApi } from '@/api/warehouse-tasks'
import { WT_STATUS } from '@/constants/warehouseTaskStatus'
import { getPackagesApi, createPackageApi, addPackageItemApi, finishPackageApi, printPackageLabelApi } from '@/api/packages'
import type { Package } from '@/api/packages'
import type { WarehouseTask } from '@/api/warehouse-tasks'
import { usePdaFeedback } from '@/hooks/usePdaFeedback'
import { getOutboundClosureCopy } from '@/lib/outboundClosure'
import {
  isDesktopLocalPrintError,
  tryDesktopLocalZplThenComplete,
} from '@/lib/desktopLocalPrint'
import { useCriticalPdaAction } from '@/hooks/useCriticalPdaAction'
import PdaCriticalActionNotice from '@/components/pda/PdaCriticalActionNotice'
import { stateConfirmedMessage, taskReachedStatus } from '@/lib/pdaCriticalState'

function readPositiveId(value: string | undefined | null): number {
  const n = Number(value)
  return Number.isInteger(n) && n > 0 ? n : 0
}

function PdaTaskState({
  title,
  description,
  actionText,
  onAction,
  secondaryText,
  onSecondary,
}: {
  title: string
  description: string
  actionText: string
  onAction: () => void
  secondaryText?: string
  onSecondary?: () => void
}) {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <PdaHeader title={title} onBack={onAction} />
      <div className="flex-1 px-4 py-10">
        <div className="mx-auto max-w-md rounded-2xl border border-border bg-card p-6 text-center shadow-sm">
          <p className="mb-4 text-5xl">⚠️</p>
          <h2 className="text-lg font-bold text-foreground">{title}</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>
          <div className="mt-6 flex gap-3">
            {secondaryText && onSecondary ? (
              <Button variant="outline" className="flex-1" onClick={onSecondary}>
                {secondaryText}
              </Button>
            ) : null}
            <Button className="flex-1" onClick={onAction}>
              {actionText}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

function TaskSelectStep({ onSelect }: { onSelect: (t: WarehouseTask) => void }) {
  const navigate = useNavigate()
  const { data, isLoading } = useQuery({
    queryKey: ['pda-pack-tasks'],
    queryFn: () => getTasksApi({ status: WT_STATUS.PACKING, pageSize: 50 }),
  })
  const tasks = data?.list ?? []
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <PdaHeader title="选择打包任务" onBack={() => navigate('/pda')} right={<span className="text-xs text-muted-foreground">{tasks.length} 个待打包</span>} />
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-md mx-auto px-4 py-4 space-y-3">
          <PdaFlowPanel
            badge="打包闭环提示"
            title="打包页负责把复核后的任务装成箱，并把箱贴打印收口后再推进到待出库"
            description="先选待打包任务，再创建箱子、扫码装箱并打印箱贴。发现箱贴失败、超时或任务卡住时，回仓库任务、出库补打或异常工作台继续处理。"
            nextAction="选择待打包任务"
            stepText="先确认复核已经完成，再开始装箱；箱贴打印状态正常后，再推进到待出库，不要跳过打包阶段直接出库。"
            actions={[
              { label: '打开仓库任务', onClick: () => navigate('/warehouse-tasks') },
              { label: '打开出库补打', onClick: () => navigate('/settings/barcode-print-query?category=outbound&status=failed') },
              { label: '打开异常工作台', onClick: () => navigate('/reports/exception-workbench') },
            ]}
          />
          {isLoading && <PdaLoading className="h-40" />}
          {!isLoading && tasks.length === 0 && (
            <PdaEmptyCard icon="📦" title="暂无待打包任务" />
          )}
          {tasks.map(task => (
            <PdaCard key={task.id} onClick={() => onSelect(task)} className="w-full text-left space-y-1.5">
              <div className="flex items-center justify-between">
                <p className="font-mono text-sm font-semibold text-foreground">{task.taskNo}</p>
                <Badge className={task.priority === 1 ? 'bg-red-100 text-red-700 border-red-200' : 'bg-orange-100 text-orange-700 border-orange-200'}>{task.priorityName}</Badge>
              </div>
              <p className="text-sm text-foreground">{task.customerName}</p>
              <p className="text-xs text-muted-foreground">{task.warehouseName}</p>
            </PdaCard>
          ))}
        </div>
      </div>
    </div>
  )
}

function PackageCard({ pkg, active, onActivate, onFinish, finishing, onPrintLabel, printingLabel }: {
  pkg: Package; active: boolean
  onActivate: () => void; onFinish: () => void; finishing: boolean
  onPrintLabel: () => void; printingLabel: boolean
}) {
  const [open, setOpen] = useState(active)
  const totalQty = pkg.items.reduce((s, i) => s + i.qty, 0)
  return (
    <div className={`rounded-2xl border transition-all ${
      active ? 'border-primary bg-primary/5' : pkg.status === 2 ? 'border-green-200 bg-green-50/40' : 'border-border bg-card'
    }`}>
      <button onClick={() => { setOpen(o => !o); if (!active) onActivate() }}
        className="w-full flex items-center justify-between px-4 py-3 text-left">
        <div className="flex items-center gap-2">
          <span className="text-lg">{pkg.status === 2 ? '✅' : active ? '📦' : '🟦'}</span>
          <div>
            <p className="font-mono font-bold text-foreground text-sm">{pkg.barcode}</p>
            <p className="text-xs text-muted-foreground">{pkg.items.length} 种，{totalQty.toFixed(0)} 件</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {active && pkg.status === 1 && <Badge className="text-xs">装箱中</Badge>}
          {pkg.status === 2 && <Badge className="bg-green-100 text-green-700 border-green-200 text-xs">已完成</Badge>}
          <span className="text-muted-foreground text-xs">{open ? '▲' : '▼'}</span>
        </div>
      </button>
      {open && (
        <div className="border-t border-border px-4 pb-4 pt-3 space-y-2">
          {pkg.items.length === 0 && <p className="text-sm text-muted-foreground text-center py-3">尚未添加商品</p>}
          {pkg.items.map(item => (
            <div key={item.id} className="flex items-center justify-between text-sm py-1.5 border-b border-border/50 last:border-0">
              <div className="min-w-0">
                <p className="font-medium text-foreground truncate">{item.productName}</p>
                <p className="text-xs font-mono text-muted-foreground">{item.productCode}</p>
              </div>
              <p className="font-bold text-primary shrink-0 ml-2">{item.qty} <span className="text-xs font-normal text-muted-foreground">{item.unit}</span></p>
            </div>
          ))}
          <Button
            size="sm"
            variant="outline"
            className="w-full mt-2"
            onClick={onPrintLabel}
            disabled={printingLabel}
          >
            {printingLabel ? '打印中…' : '🖨 打印箱贴'}
          </Button>
          {active && pkg.status === 1 && pkg.items.length > 0 && (
            <Button size="sm" className="w-full mt-1" onClick={onFinish} disabled={finishing}>
              {finishing ? '处理中…' : '✓ 完成此箱'}
            </Button>
          )}
        </div>
      )}
    </div>
  )
}

export default function PdaPackPage() {
  const navigate = useNavigate()
  const routeParams = useParams()
  const [params] = useSearchParams()
  const qc       = useQueryClient()
  const { flash, ok, err } = usePdaFeedback()
  const routeTaskId = readPositiveId(routeParams.id) || readPositiveId(params.get('taskId'))

  const [task, setTask]                       = useState<WarehouseTask | null>(null)
  const [activePackageId, setActivePackageId] = useState<number | null>(null)
  const [allDone, setAllDone]                 = useState(false)

  const taskId = task?.id ?? routeTaskId
  const goSelectTask = useCallback(() => {
    setTask(null)
    setActivePackageId(null)
    setAllDone(false)
    navigate('/pda/pack')
  }, [navigate])

  const {
    data: taskDetail,
    isLoading: taskLoading,
    isError: taskError,
    error: taskLoadError,
  } = useQuery({
    queryKey: ['pda-pack-task', taskId],
    queryFn: () => getTaskByIdApi(taskId),
    enabled: taskId > 0,
  })

  const finishAction = useCriticalPdaAction<{
    id: number
    allPackagesDone?: boolean
  }>({
    action: `package.finish.${taskId || 'none'}`,
    requestAction: 'package.finish',
    label: '完成箱子',
    onConfirmed: async (data) => {
      await refetch()
      ok('当前箱已完成，箱贴已进入打印链')
      if (data.allPackagesDone) {
        ok('所有箱子已完成。请确认箱贴打印完成后，再结束打包进入待出库。')
      }
    },
    resolveServerState: async ({ record }) => {
      const packageId = Number(record.metadata?.packageId ?? 0)
      const recordTaskId = Number(record.metadata?.taskId ?? taskId)
      if (!packageId || !recordTaskId) return { effective: false }
      const latestPackages = await getPackagesApi(recordTaskId)
      const latestPackage = latestPackages.find(pkg => Number(pkg.id) === packageId)
      if (latestPackage?.status === 2) {
        const allPackagesDone = latestPackages.length > 0 && latestPackages.every(pkg => pkg.status === 2)
        return {
          effective: true,
          data: { id: packageId, allPackagesDone },
          message: `箱子 ${latestPackage.barcode} 已完成，箱贴任务已入链或可追踪。`,
        }
      }
      return { effective: false }
    },
  })
  const printAction = useCriticalPdaAction<{
    queued: boolean
    job?: {
      id?: number
      content?: string
      contentType?: string
      printerName?: string | null
    } | unknown
  }>({
    action: `package.print.${taskId || 'none'}`,
    requestAction: 'package.print-label',
    label: '箱贴打印',
  })
  const finalizeAction = useCriticalPdaAction<{ taskId: number }>({
    action: `warehouse.pack-done.${taskId || 'none'}`,
    requestAction: 'warehouse.pack-done',
    label: '打包收口',
    onConfirmed: async () => {
      setAllDone(true)
    },
    resolveServerState: async () => {
      const latest = await getTaskByIdApi(taskId)
      if (taskReachedStatus(latest, WT_STATUS.SHIPPING)) {
        return { effective: true, data: { taskId }, message: stateConfirmedMessage('打包收口', latest.statusName) }
      }
      return { effective: false }
    },
  })

  const { data: packages = [], isLoading: pkgLoading } = useQuery({
    queryKey: ['pda-packages', taskId],
    queryFn:  () => getPackagesApi(taskId),
    enabled:  taskId > 0 && !taskLoading && taskDetail?.status === WT_STATUS.PACKING,
    onSuccess: (pkgs) => {
      if (!activePackageId) {
        const open = pkgs.find(p => p.status === 1)
        if (open) setActivePackageId(open.id)
      }
    },
  })

  const refetch = () => qc.invalidateQueries({ queryKey: ['pda-packages', taskId] })
  const onlineBlocked = finishAction.networkStatus !== 'online'

  const createMut = useMutation({
    mutationFn: () => {
      if (!taskDetail) throw new Error('任务数据仍在加载，请稍后重试')
      if (taskDetail.status !== WT_STATUS.PACKING) throw new Error('当前任务不是待打包状态，不能新建箱子')
      return createPackageApi(taskId)
    },
    onSuccess: (res) => {
      const pkg = res!
      ok(`已创建箱子 ${pkg.barcode}`)
      setActivePackageId(pkg.id)
      refetch()
    },
    onError: (e: unknown) => err((e as { message?: string; response?: { data?: { message?: string } } })?.response?.data?.message ?? (e as { message?: string })?.message ?? '创建失败'),
  })

  const addMut = useMutation({
    mutationFn: ({ code, qty }: { code: string; qty: number }) => {
      if (!taskDetail) throw new Error('任务数据仍在加载，请稍后重试')
      if (taskDetail.status !== WT_STATUS.PACKING) throw new Error('当前任务不是待打包状态，不能装箱')
      if (!activePackageId) throw new Error('请先创建或选择一个箱子')
      return addPackageItemApi(activePackageId, code, qty)
    },
    onSuccess: (res) => {
      const item = res!
      ok(`✓ ${item.productName} × ${item.qty} ${item.unit} 已装箱`)
      refetch()
    },
    onError: (e: unknown) => err((e as { message?: string; response?: { data?: { message?: string } } })?.response?.data?.message ?? (e as { message?: string })?.message ?? '添加失败'),
  })

  const printLabelMut = useMutation({
    mutationFn: async (pkgId: number) => {
      if (!taskDetail) throw new Error('任务数据仍在加载，请稍后重试')
      if (taskDetail.status !== WT_STATUS.PACKING) throw new Error('当前任务不是待打包状态，不能打印箱贴')
      const result = await printAction.run((requestKey) =>
        printPackageLabelApi(pkgId, requestKey),
        { taskId, packageId: pkgId },
      )
      return result
    },
    onSuccess: async (d) => {
      if (d.kind === 'pending') {
        err('网络中断，箱贴打印结果待确认。请先确认是否已入队或已出纸，再决定是否重试。')
        return
      }
      const payload = d.data
      if (payload.queued && payload.job && typeof payload.job === 'object') {
        const job = payload.job as {
          id?: number
          content?: string
          contentType?: string
          printerName?: string | null
        }
        const local = await tryDesktopLocalZplThenComplete({
          jobId: job.id,
          content: job.content,
          contentType: job.contentType,
          printerName: job.printerName,
        })
        if (local === 'ok') {
          ok(
            '已向本机提交箱贴 RAW 并核销队列。若未出纸，请核对打印机指令集 ZPL/TSPL 是否与机型一致，并查看系统打印队列。',
          )
          return
        }
        if (isDesktopLocalPrintError(local)) {
          err(
            `${local.error} PDA 仅提交任务；请在已安装极序 Flow 桌面端、且连接标签机的电脑上登录 ERP 执行打印，或检查打印机名称与 RAW 驱动。`,
          )
          return
        }
        if (local === 'skipped_no_desktop') {
          err(
            '当前浏览器未连接本机打印桥接（非桌面端或未注入 flowcubeDesktop），箱贴不会在本机出纸；任务已在服务器入队，请到装了极序 Flow 桌面端且挂了标签机的电脑登录后处理「打印任务」。',
          )
          return
        }
        if (local === 'skipped_no_payload') {
          err(
            '任务已入队，但响应中缺少 ZPL 或任务 ID，本机未送 RAW。请重试或在桌面端「打印任务」中处理，并检查网络/网关是否截断响应。',
          )
          return
        }
      }
      if (payload.queued) ok('箱贴已加入打印队列')
    },
    onError: (e: unknown) => err((e as { message?: string })?.message ?? '打印失败'),
  })

  const finishMut = useMutation({
    mutationFn: async (pkgId: number) => {
      if (!taskDetail) throw new Error('任务数据仍在加载，请稍后重试')
      if (taskDetail.status !== WT_STATUS.PACKING) throw new Error('当前任务不是待打包状态，不能完成箱子')
      const result = await finishAction.run((requestKey) =>
        finishPackageApi(pkgId, requestKey).then((res) => res!),
        { taskId, packageId: pkgId },
      )
      return result
    },
    onSuccess: (res) => {
      if (res.kind === 'pending') {
        err('网络中断，装箱结果待确认。请先确认刚才那次是否成功，再决定是否重试。')
        return
      }
      setActivePackageId(null)
      refetch()
    },
    onError: (e: unknown) => err((e as { message?: string })?.message ?? '操作失败'),
  })
  const finalizeMut = useMutation({
    mutationFn: async () => {
      if (!taskDetail) throw new Error('任务数据仍在加载，请稍后重试')
      if (taskDetail.status !== WT_STATUS.PACKING) throw new Error('当前任务不是待打包状态，不能收口')
      const result = await finalizeAction.run((requestKey) =>
        packDoneApi(taskId, requestKey).then((res) => res as { taskId: number }),
        { taskId },
      )
      return result
    },
    onSuccess: (result) => {
      if (result.kind === 'pending') {
        err('网络中断，打包收口结果待确认。请先确认是否已进入待出库。')
      }
    },
    onError: (e: unknown) => err((e as { message?: string })?.message ?? '打包收口失败'),
  })

  const handleScan = useCallback((raw: string) => {
    if (onlineBlocked) { err('网络已断开，打包装箱已阻断，请恢复网络后再继续'); return }
    if (taskLoading) { err('任务数据加载中，请稍后扫码'); return }
    if (!taskDetail) { err('任务不存在或加载失败，请返回任务列表重新选择'); return }
    if (taskDetail.status !== WT_STATUS.PACKING) { err(`当前任务状态为「${taskDetail.statusName}」，不能打包`); return }
    if (!activePackageId) { err('请先创建或选择一个箱子'); return }
    const parsed = parseBarcode(raw)
    if (parsed.type !== 'product' && parsed.type !== 'unknown') { err('扫描产品条码'); return }
    // 扫码即直接装箱（默认数量 1），无需额外确认
    addMut.mutate({ code: raw, qty: 1 })
  }, [activePackageId, err, addMut, onlineBlocked, taskDetail, taskLoading])

  // ── 任务未选 ────────────────────────────────────────────────────────────
  if (!task && !routeTaskId) return <TaskSelectStep onSelect={t => { setTask(t); setActivePackageId(null) }} />

  if (taskId <= 0) {
    return (
      <PdaTaskState
        title="缺少打包任务"
        description="当前页面没有有效任务号，请从待打包任务列表重新选择。"
        actionText="选择任务"
        onAction={goSelectTask}
        secondaryText="返回工作台"
        onSecondary={() => navigate('/pda')}
      />
    )
  }

  if (taskLoading) {
    return (
      <div className="flex min-h-screen flex-col bg-background">
        <PdaHeader title="打包作业" onBack={goSelectTask} />
        <div className="flex flex-1 items-center justify-center">
          <div className="space-y-3 text-center">
            <PdaLoading className="h-10" />
            <p className="text-sm text-muted-foreground">正在加载任务数据…</p>
          </div>
        </div>
      </div>
    )
  }

  if (taskError || !taskDetail) {
    return (
      <PdaTaskState
        title="打包任务不存在"
        description={(taskLoadError as { message?: string })?.message || `未找到任务 #${taskId}，请确认任务是否已被删除或状态已变化。`}
        actionText="选择其他任务"
        onAction={goSelectTask}
        secondaryText="返回工作台"
        onSecondary={() => navigate('/pda')}
      />
    )
  }

  if (!allDone && taskDetail.status !== WT_STATUS.PACKING) {
    return (
      <PdaTaskState
        title="当前任务不能打包"
        description={`任务 ${taskDetail.taskNo} 当前状态为「${taskDetail.statusName}」。打包页只允许处理「待打包」任务，请回到仓库任务确认主流程状态。`}
        actionText="选择其他任务"
        onAction={goSelectTask}
        secondaryText="打开仓库任务"
        onSecondary={() => navigate('/warehouse-tasks')}
      />
    )
  }

  const totalBoxes = packages.length
  const doneBoxes  = packages.filter(p => p.status === 2).length
  const totalItems = packages.reduce((s, p) => s + p.items.reduce((ss, i) => ss + i.qty, 0), 0)
  const closureCopy = getOutboundClosureCopy({
    status: taskDetail.status,
    statusName: taskDetail.statusName,
    taskNo: taskDetail.taskNo,
    customerName: taskDetail.customerName,
    packageSummary: {
      totalPackages: totalBoxes,
      openPackages: packages.filter(p => p.status !== 2).length,
      donePackages: doneBoxes,
      totalItems,
    },
    printSummary: {
      totalPackages: totalBoxes,
      successCount: 0,
      failedCount: 0,
      timeoutCount: 0,
      processingCount: 0,
      recentError: null,
      recentPrinter: null,
    },
  })
  // ── 全部完成页 ────────────────────────────────────────────────────────────
  if (allDone) return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-6 text-center">
      <div className="text-6xl mb-6">🎉</div>
      <h2 className="text-2xl font-bold text-foreground">打包完成！</h2>
      <p className="text-muted-foreground mt-2 mb-1">任务：<span className="font-mono font-semibold text-foreground">{taskDetail.taskNo}</span></p>
      <p className="text-muted-foreground mb-4">共 {totalBoxes} 箱，{totalItems.toFixed(0)} 件商品</p>
      <div className="mb-6 w-full max-w-md">
        <PdaFlowPanel
          badge="打包收口"
          title="当前任务已完成打包，可以继续推进到待出库"
          description="优先确认箱贴和物流标签没有异常，再去 PDA 出库或仓库任务继续现场执行。"
          nextAction="进入出库确认"
          stepText="先确认打印异常清零，再继续出库；如果需要重新排优先级或查看异常，分别回岗位工作台和异常工作台。"
          actions={[
            { label: '打开 PDA 出库', onClick: () => navigate('/pda/ship') },
            { label: '打开仓库任务', onClick: () => navigate('/warehouse-tasks') },
            { label: '打开异常工作台', onClick: () => navigate('/reports/exception-workbench') },
          ]}
        />
      </div>
      <div className="flex gap-3 w-full max-w-xs">
        <Button variant="outline" className="flex-1" onClick={goSelectTask}>继续打包</Button>
        <Button className="flex-1" onClick={() => navigate('/pda')}>返回工作台</Button>
      </div>
    </div>
  )

  return (
    <div className="flex min-h-screen flex-col bg-background">

      <PdaHeader
        title={taskDetail.taskNo}
        subtitle={taskDetail.customerName}
        onBack={goSelectTask}
        right={<span className="text-xs text-muted-foreground">{doneBoxes}/{totalBoxes} 箱</span>}
      />

      {/* Flash */}
      <PdaFlash flash={flash} />

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-md mx-auto px-4 py-4 space-y-3">
          <PdaCriticalActionNotice
            blockedReason={
              finishAction.blockedReason
              || printAction.blockedReason
              || finalizeAction.blockedReason
              || (onlineBlocked ? '网络已断开，打包、打印和待出库收口都已阻断。' : null)
            }
            pendingRecord={finishAction.pendingRecord ?? printAction.pendingRecord ?? finalizeAction.pendingRecord}
            confirming={finishAction.confirming || printAction.confirming || finalizeAction.confirming}
            onConfirm={() => {
              const handler = finishAction.pendingRecord
                ? finishAction
                : printAction.pendingRecord
                  ? printAction
                  : finalizeAction
              void handler.confirmPending().then((status) => {
                if (!status) return
                if (status.status === 'pending') err('服务端仍未确认结果，请稍后再查')
                if (status.status === 'not_found') err('未找到上次提交记录，请先刷新箱子和任务状态后再重试')
                if (status.status === 'failed') err(status.message || '上次操作未成功，请检查后重试')
              })
            }}
            onClear={() => {
              if (finishAction.pendingRecord) finishAction.clearPending()
              if (printAction.pendingRecord) printAction.clearPending()
              if (finalizeAction.pendingRecord) finalizeAction.clearPending()
            }}
          />
          <PdaFlowPanel
            badge="打包执行中"
            title={`当前阶段：${closureCopy.stageLabel}`}
            description={closureCopy.description}
            nextAction={closureCopy.nextAction}
            stepText="先把当前箱装满并完成箱贴打印，再处理下一箱；若箱贴失败或超时，先收口打印异常，再继续装箱或推进到出库。"
            actions={[
              { label: '打开仓库任务', onClick: () => navigate('/warehouse-tasks') },
              { label: '打开出库补打', onClick: () => navigate(`/settings/barcode-print-query?category=outbound&keyword=${encodeURIComponent(taskDetail.taskNo)}`) },
              { label: '打开异常工作台', onClick: () => navigate('/reports/exception-workbench') },
            ]}
          />

          {/* 统计行 */}
          <PdaStatGrid cols={3}>
            <PdaStat label="箱子数" value={totalBoxes} />
            <PdaStat label="已完成" value={doneBoxes} accent />
            <PdaStat label="总件数" value={totalItems.toFixed(0)} />
          </PdaStatGrid>

          {/* 箱子列表 */}
          {pkgLoading && <PdaLoading className="h-24" />}
          {packages.map(pkg => (
            <PackageCard
              key={pkg.id}
              pkg={pkg}
              active={activePackageId === pkg.id}
              onActivate={() => setActivePackageId(pkg.id)}
              onFinish={() => finishMut.mutate(pkg.id)}
              finishing={finishMut.isPending || finishAction.submitBlocked || onlineBlocked}
              onPrintLabel={() => printLabelMut.mutate(pkg.id)}
              printingLabel={(printLabelMut.isPending && printLabelMut.variables === pkg.id) || printAction.submitBlocked || onlineBlocked}
            />
          ))}
          {packages.length === 0 && !pkgLoading && (
            <div className="rounded-2xl border border-dashed border-border bg-muted/20 py-10 text-center">
              <p className="text-muted-foreground text-sm">点击下方「新建箱子」开始打包</p>
            </div>
          )}
          {packages.length > 0 && packages.every((pkg) => pkg.status === 2) ? (
            <Button
              type="button"
              className="w-full"
              onClick={() => finalizeMut.mutate()}
              disabled={finalizeMut.isPending || finalizeAction.submitBlocked}
            >
              {finalizeMut.isPending ? '收口中…' : '完成打包并进入待出库'}
            </Button>
          ) : null}
        </div>
      </div>

      <PdaBottomBar>
          {activePackageId && <PdaScanner onScan={handleScan} placeholder="扫描产品条码" disabled={addMut.isPending || onlineBlocked} />}
          <Button variant={activePackageId ? 'outline' : 'default'} className="w-full" onClick={() => createMut.mutate()} disabled={createMut.isPending || onlineBlocked}>
            {createMut.isPending ? '创建中…' : '＋ 新建箱子'}
          </Button>
      </PdaBottomBar>

    </div>
  )
}
