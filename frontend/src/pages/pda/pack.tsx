import PdaOverviewText from '@/components/pda/PdaOverviewText'
import PdaProductIdentity from '@/components/pda/PdaProductIdentity'
/**
 * PDA 打包作业
 * 路由：/pda/pack
 */
import { Package as PackageIcon, CircleCheck, Ban, PartyPopper } from 'lucide-react'
import { useState, useCallback, useEffect } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { parseBarcode } from '@/utils/barcode'
import PdaScanner from '@/components/pda/PdaScanner'
import PdaHeader from '@/components/pda/PdaHeader'
import PdaCard from '@/components/pda/PdaCard'
import PdaBottomBar from '@/components/pda/PdaBottomBar'
import PdaFlash from '@/components/pda/PdaFlash'
import { PdaEmptyCard, PdaLoading, PdaQueryError } from '@/components/pda/PdaEmptyState'
import PdaStat, { PdaStatGrid } from '@/components/pda/PdaStat'
import { Button } from '@/components/ui/button'
import { SoftStatusLabel } from '@/components/shared/StatusBadge'
import { WT_PRIORITY_TONE } from '@/constants/warehouseTaskStatus'
import { getTaskByIdApi, getTasksApi, packDoneApi } from '@/api/warehouse-tasks'
import { WT_STATUS } from '@/constants/warehouseTaskStatus'
import { getPackagesApi, createPackageApi, addPackageItemApi, removePackageItemApi, voidPackageApi, finishPackageApi, printPackageLabelApi } from '@/api/packages'
import type { AddPackageItemPayload, PackageItem } from '@/api/packages'
import { getOperationRequestStatusApi } from '@/api/operation-requests'
import type { Package, PackagePrintJob } from '@/api/packages'
import type { WarehouseTask } from '@/api/warehouse-tasks'
import { usePdaFeedback } from '@/hooks/usePdaFeedback'
import { triggerPrintPoll } from '@/lib/printQueue'
import { useCriticalPdaAction } from '@/hooks/useCriticalPdaAction'
import PdaCriticalActionNotice from '@/components/pda/PdaCriticalActionNotice'
import { PdaTaskState } from '@/components/pda/PdaTaskState'
import PdaDoneView from '@/components/pda/PdaDoneView'
import { stateConfirmedMessage, taskReachedStatus } from '@/lib/pdaCriticalState'

function readPositiveId(value: string | undefined | null): number {
  const n = Number(value)
  return Number.isInteger(n) && n > 0 ? n : 0
}

function packageLabelTraceMessage(job?: PackagePrintJob | null): string {
  const hint = job?.dispatchHint ?? null
  const clientOnline = hint?.clientOnline
  if (clientOnline) return '箱贴已加入打印队列'
  if (hint?.code === 'client_not_bound') return '箱贴已入队，打印机未绑定客户端'
  return '箱贴已入队，打印客户端离线'
}

function TaskSelectStep({ onSelect }: { onSelect: (t: WarehouseTask) => void }) {
  const navigate = useNavigate()
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['pda-pack-tasks'],
    // 重进列表必须立刻取最新数据（2026-09-17 验收 ISSUE-017：新派发单据长时间看不到）
    refetchOnMount: 'always',
    queryFn: () => getTasksApi({ status: WT_STATUS.PACKING, pageSize: 200 }),
  })
  const tasks = data?.list ?? []
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <PdaHeader title="选择打包任务" onBack={() => navigate('/pda')} right={<span className="text-xs text-muted-foreground">{tasks.length} 个待打包</span>} />
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-md mx-auto px-4 py-4 space-y-3">
          {isLoading && <PdaLoading className="h-40" />}
          {isError && <PdaQueryError onRetry={() => { void refetch() }} />}
          {!isLoading && !isError && tasks.length === 0 && (
            <PdaEmptyCard icon={<PackageIcon className="h-12 w-12 text-muted-foreground" />} title="暂无待打包任务" />
          )}
          {!isError && tasks.map(task => (
            <PdaCard key={task.id} onClick={() => onSelect(task)} className="w-full text-left space-y-1.5">
              <div className="flex items-center justify-between">
                <p className="font-mono text-sm font-semibold text-foreground">{task.taskNo}</p>
                <SoftStatusLabel label={task.priorityName} tone={WT_PRIORITY_TONE[task.priority] ?? 'draft'} />
              </div>
              <PdaOverviewText>{task.customerName || '未知客户'}</PdaOverviewText>
              <p className="text-xs text-muted-foreground">{task.warehouseName}</p>
            </PdaCard>
          ))}
        </div>
      </div>
    </div>
  )
}

function PackageCard({ pkg, active, onActivate, onFinish, finishing, onPrintLabel, printingLabel, onRemoveItem, removingItemId, onVoid, voiding }: {
  pkg: Package; active: boolean
  onActivate: () => void; onFinish: () => void; finishing: boolean
  onPrintLabel: () => void; printingLabel: boolean
  onRemoveItem: (itemId: number) => void; removingItemId: number | null
  onVoid: () => void; voiding: boolean
}) {
  const [open, setOpen] = useState(active)
  const totalQty = pkg.items.reduce((s, i) => s + i.qty, 0)
  const editable = active && pkg.status === 1
  return (
    <div className={`rounded-2xl border transition-all ${
      active ? 'border-primary bg-primary/5' : pkg.status === 2 ? 'border-green-200 bg-green-50/40' : pkg.status === 3 ? 'border-border bg-muted/20 opacity-60' : 'border-border bg-card'
    }`}>
      <button onClick={() => { setOpen(o => !o); if (!active && pkg.status !== 3) onActivate() }}
        className="w-full flex items-center justify-between px-4 py-3 text-left">
        <div className="flex items-center gap-2">
          <span className="shrink-0">
            {pkg.status === 2
              ? <CircleCheck className="h-4 w-4 text-green-600" />
              : pkg.status === 3
                ? <Ban className="h-4 w-4 text-muted-foreground" />
                : <PackageIcon className={active ? 'h-4 w-4 text-primary' : 'h-4 w-4 text-muted-foreground'} />}
          </span>
          <div>
            <p className="font-mono font-bold text-foreground text-sm">{pkg.barcode}</p>
            {/* 种数按**商品**去重：装箱行按来源取货标签分行后，同一商品会有多行
                （旧 SKU 一行 + 各取货标签各一行），不能拿行数当"种"数 */}
            <p className="text-xs text-muted-foreground">{new Set(pkg.items.map(i => i.productId)).size} 种，{totalQty.toFixed(0)} 件</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {active && pkg.status === 1 && <SoftStatusLabel label="装箱中" tone="active" />}
          {pkg.status === 2 && <SoftStatusLabel label="已完成" tone="success" />}
          {pkg.status === 3 && <SoftStatusLabel label="已作废" tone="draft" />}
          <span className="text-muted-foreground text-xs">{open ? '▲' : '▼'}</span>
        </div>
      </button>
      {open && (
        <div className="border-t border-border px-4 pb-4 pt-3 space-y-2">
          {pkg.items.length === 0 && <p className="text-sm text-muted-foreground text-center py-3">尚未添加商品</p>}
          {pkg.items.map(item => (
            <div key={item.id} className="flex items-center justify-between text-sm py-1.5 border-b border-border/50 last:border-0">
              <div className="min-w-0">
                <PdaProductIdentity code={item.productCode} name={item.productName} view="detail" />
                {/* 来源取货标签：同一商品多行时靠这行才分得清哪一份是哪张码，避免移出错行 */}
                <p className="text-xs text-muted-foreground mt-0.5">
                  {item.labelBarcode ? `取货码 ${item.labelBarcode}` : '按商品码装箱'}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0 ml-2">
                <p className="font-bold text-primary">{item.qty} <span className="text-xs font-normal text-muted-foreground">{item.unit}</span></p>
                {editable && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-xs text-destructive hover:text-destructive"
                    onClick={() => onRemoveItem(item.id)}
                    disabled={removingItemId === item.id}
                  >
                    {removingItemId === item.id ? '移出中…' : '移出'}
                  </Button>
                )}
              </div>
            </div>
          ))}
          <Button
            size="sm"
            variant="outline"
            className="w-full mt-2"
            onClick={onPrintLabel}
            disabled={printingLabel}
          >
            {printingLabel ? '打印中…' : '打印箱贴'}
          </Button>
          {/*
            箱贴打印状态必须显示出来：完成打包要求箱贴打印成功（系统强制），
            此前页面不显示打印状态，操作员只能反复点「完成打包并进入待出库」
            （2026-09-17 验收 ISSUE-003）。
          */}
          <p className={`mt-1 text-xs ${
            pkg.printStatus?.key === 'success' ? 'text-emerald-600'
              : pkg.printStatus?.key === 'failed' ? 'text-destructive'
                : 'text-amber-600'
          }`}>
            箱贴：{pkg.printStatus?.label ?? '未生成箱贴'}
            {pkg.printStatus?.errorMessage ? `（${pkg.printStatus.errorMessage}）` : ''}
          </p>
          {editable && pkg.items.length > 0 && (
            <Button size="sm" className="w-full mt-1" onClick={onFinish} disabled={finishing}>
              {finishing ? '处理中…' : '✓ 完成此箱'}
            </Button>
          )}
          {editable && (
            <Button size="sm" variant="outline" className="w-full mt-1 text-destructive hover:text-destructive" onClick={onVoid} disabled={voiding}>
              {voiding ? '作废中…' : '作废本箱（装错重来）'}
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
  const { flash, ok, err, warn } = usePdaFeedback()
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
    printJob?: PackagePrintJob
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
      const latestPackages = await getPackagesApi(recordTaskId, { skipGlobalError: true })
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
    job?: PackagePrintJob | unknown
  }>({
    action: `package.print.${taskId || 'none'}`,
    requestAction: 'package.print-label',
    label: '箱贴打印',
  })
  const finalizeAction = useCriticalPdaAction<{ taskId: number }>({
    action: `warehouse.pack-done.${taskId || 'none'}`,
    requestAction: 'warehouse.pack-done',
    label: '完成打包',
    onConfirmed: async () => {
      setAllDone(true)
    },
    resolveServerState: async () => {
      const latest = await getTaskByIdApi(taskId, { skipGlobalError: true })
      if (taskReachedStatus(latest, WT_STATUS.SHIPPING)) {
        return { effective: true, data: { taskId }, message: stateConfirmedMessage('完成打包', latest.statusName) }
      }
      return { effective: false }
    },
  })

  const { data: packages = [], isLoading: pkgLoading } = useQuery({
    queryKey: ['pda-packages', taskId],
    queryFn:  () => getPackagesApi(taskId),
    enabled:  taskId > 0 && !taskLoading && taskDetail?.status === WT_STATUS.PACKING,
  })

  useEffect(() => {
    if (activePackageId) return
    const open = packages.find(p => p.status === 1)
    if (open) setActivePackageId(open.id)
  }, [packages, activePackageId])

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

  // 装箱走关键操作：未确认期间冻结**原目标**（箱 / 条码 / 数量），恢复不用当前 activePackageId
  const addAction = useCriticalPdaAction<PackageItem>({
    // 与服务端幂等 action 对齐：服务端落库的 scopedAction 是 `package.add.<箱id>`，
    // 这里给 base，具体绑定由 `resolveServerState` 里的 scoped action 完成
    action: 'package.add',
    requestAction: 'package.add',
    label: '装箱确认',
    // **成功反馈的唯一出路**：正常提交、查回执恢复、以及「非传输错误被
    // `confirmByServerState` 兜底确认」三条路径最终都会走到这里。
    // 之前的写法让 submitAdd 在 kind=success 也发一次，第三条路径会**双提示**
    //（hook 先 recovered:true 回调、run 再返回 success）——所以收敛到这一个回调里发。
    onConfirmed: async (data) => {
      if (data) ok(`✓ 本次装箱 ${data.addedQty ?? data.qty} ${data.unit}（该来源累计 ${data.qty} ${data.unit}）`)
      refetch()
    },
    resolveServerState: async ({ record }) => {
      // 装箱**不改变**箱子/任务状态，所以只能靠**原键回执**定位本次提交；
      // **不能**凭「列表里已经有该取货码的那一行」判本次成功——那可能是先前的部分装入。
      //
      // 正常路径由 hook 自己用 `requestAction='package.add'`（base）查：服务端
      // `getScopedOperationRequestStatus` 支持 base 匹配**唯一** scoped 行。
      // 这里只是 base 查不到（同键对应多资源时服务端保守返回 not_found）时的兜底：
      // 用**冻结记录里的原箱 id** 组成 scoped action 再查一次，服务端会按 resource_id 过滤，
      // 从而**只接受原箱**的回执，不会把别的箱子的结果算到这次头上。
      const meta = record.metadata ?? {}
      const packageId = Number(meta.packageId)
      if (!Number.isInteger(packageId) || packageId <= 0) return { effective: false }
      const st = await getOperationRequestStatusApi(record.requestKey, `package.add.${packageId}`)
      if (st?.status !== 'success') return { effective: false }
      // 再自查一次资源归属：回执必须绑定**原箱**
      if (st.resourceId != null && Number(st.resourceId) !== packageId) return { effective: false }
      return { effective: true, data: st.data as PackageItem, message: '本次装箱已确认' }
    },
  })

  // 四个并行 action 里挑一个作为提示卡片的 phase/lastErrorMessage 来源：优先未确认的 pendingRecord，
  // 其次正在提交/刚失败的。放在 addAction 之后定义，避免提前引用。
  const packNoticeAction =
    addAction.pendingRecord ? addAction
      : finishAction.pendingRecord ? finishAction
        : printAction.pendingRecord ? printAction
          : finalizeAction.pendingRecord ? finalizeAction
            : addAction.phase !== 'idle' || addAction.lastErrorMessage ? addAction
              : finishAction.phase !== 'idle' || finishAction.lastErrorMessage ? finishAction
                : printAction.phase !== 'idle' || printAction.lastErrorMessage ? printAction
                  : finalizeAction.phase !== 'idle' || finalizeAction.lastErrorMessage ? finalizeAction
                    : null

  const removeItemMut = useMutation({
    mutationFn: ({ packageId, itemId }: { packageId: number; itemId: number }) => {
      if (!taskDetail) throw new Error('任务数据仍在加载，请稍后重试')
      if (taskDetail.status !== WT_STATUS.PACKING) throw new Error('当前任务不是待打包状态，不能移出商品')
      return removePackageItemApi(packageId, itemId)
    },
    onSuccess: (res) => {
      const item = res!
      ok(item.removed ? `已移出 ${item.productName}` : `${item.productName} 数量已调整为 ${item.qty}`)
      refetch()
    },
    onError: (e: unknown) => err((e as { message?: string; response?: { data?: { message?: string } } })?.response?.data?.message ?? (e as { message?: string })?.message ?? '移出失败'),
  })

  const voidMut = useMutation({
    mutationFn: (packageId: number) => {
      if (!taskDetail) throw new Error('任务数据仍在加载，请稍后重试')
      if (taskDetail.status !== WT_STATUS.PACKING) throw new Error('当前任务不是待打包状态，不能作废箱子')
      return voidPackageApi(packageId)
    },
    onSuccess: (res) => {
      const pkg = res!
      ok(`箱子 ${pkg.id} 已作废`)
      setActivePackageId(prev => (prev === pkg.id ? null : prev))
      refetch()
    },
    onError: (e: unknown) => err((e as { message?: string; response?: { data?: { message?: string } } })?.response?.data?.message ?? (e as { message?: string })?.message ?? '作废失败'),
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
    onSuccess: (d) => {
      if (d.kind === 'pending') {
        warn('网络中断，打印结果待确认')
        return
      }
      const payload = d.data
      if (payload.queued) {
        // PDA 自身不打印，箱贴由仓库里的桌面打印客户端领取执行；此处唤醒仅在桌面端生效
        triggerPrintPoll()
        const job = payload.job && typeof payload.job === 'object' ? payload.job as PackagePrintJob : null
        const hint = job?.dispatchHint
        if (hint && hint.clientOnline === false) warn(packageLabelTraceMessage(job), 5000)
        else ok(packageLabelTraceMessage(job), 4000)
      } else {
        // 2026-09-14：没有可用打印机时后端只留一条打印记录（不算已排队），
        // 必须明确提示先绑定打印机，否则现场会以为箱贴已经在打。
        warn('未绑定可用打印机，箱贴未出纸；记录已保留，请先绑定打印机再到「打印记录」页补打', 5000)
      }
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
        warn('网络中断，装箱结果待确认。请先确认刚才那次是否成功，再决定是否重试。')
        return
      }
      const job = res.data.printJob
      if (job?.dispatchHint?.clientOnline === false) warn(packageLabelTraceMessage(job), 5000)
      else ok(packageLabelTraceMessage(job), 4000)
      setActivePackageId(null)
      refetch()
    },
    onError: (e: unknown) => err((e as { message?: string })?.message ?? '操作失败'),
  })
  const finalizeMut = useMutation({
    mutationFn: async () => {
      if (!taskDetail) throw new Error('任务数据仍在加载，请稍后重试')
      if (taskDetail.status !== WT_STATUS.PACKING) throw new Error('当前任务不是待打包状态，不能完成打包')
      const result = await finalizeAction.run((requestKey) =>
        packDoneApi(taskId, requestKey).then((res) => res as { taskId: number }),
        { taskId },
      )
      return result
    },
    onSuccess: (result) => {
      if (result.kind === 'pending') {
        warn('网络中断，完成打包的结果待确认。请先确认是否已进入待出库。')
      }
    },
    onError: (e: unknown) => err((e as { message?: string })?.message ?? '完成打包失败'),
  })

  const submitAdd = useCallback(async (payload: AddPackageItemPayload) => {
    const targetPackageId = activePackageId
    if (!targetPackageId) { err('请先创建或选择一个箱子'); return }
    try {
      const submitted = await addAction.run(
        (requestKey) => addPackageItemApi(targetPackageId, payload, requestKey),
        // 冻结**原目标**：箱 id/箱码、任务 id/任务号、条码、数量。重挂后按这份记录定位与核对，
        // 不取当前 activePackageId；同时留有**人能看懂**的 taskNo / packageBarcode，
        // 免得只给工人一串数据库编号。
        {
          packageId: targetPackageId,
          packageBarcode: packages.find(p => p.id === targetPackageId)?.barcode ?? null,
          taskId: taskDetail?.id ?? null,
          taskNo: taskDetail?.taskNo ?? null,
          labelBarcode: 'labelBarcode' in payload ? payload.labelBarcode : null,
          productCode: 'productCode' in payload ? payload.productCode : null,
          qty: payload.qty ?? null,
        },
      )
      // 成功提示**不在这里**发：统一由 `onConfirmed` 给（避免与恢复/兜底确认路径双提示）
      if (submitted.kind === 'pending') {
        warn('网络中断，装箱结果待确认。请先确认结果，再决定是否重扫。')
      }
    } catch (e: unknown) {
      err((e as { message?: string })?.message ?? '添加失败')
    }
  }, [activePackageId, addAction, err, warn, taskDetail, packages])

  const handleScan = useCallback((raw: string) => {
    if (onlineBlocked) { err('网络已断开，打包装箱已阻断，请恢复网络后再继续'); return }
    if (taskLoading) { err('任务数据加载中，请稍后扫码'); return }
    if (!taskDetail) { err('任务不存在或加载失败，请返回任务列表重新选择'); return }
    if (taskDetail.status !== WT_STATUS.PACKING) { err(`当前任务状态为「${taskDetail.statusName}」，不能打包`); return }
    if (!activePackageId) { err('请先创建或选择一个箱子'); return }
    // 待确认期间冻结：不能再扫新的商品/标签，否则会把「原目标」换掉、与冻结记录不一致
    if (addAction.submitBlocked) { err(addAction.blockedReason || '上次装箱结果待确认，请先确认后再扫'); return }
    const parsed = parseBarcode(raw)
    // 取货标签（整件 I 码）：整份装入该标签的未装余量，数量由服务端在锁内决定，
    // 这里**不传 qty**——工人扫一张标签就该把这张标签的货全放进去，不是 1 件。
    if (parsed.type === 'container') { void submitAdd({ labelBarcode: raw.trim() }); return }
    if (parsed.type !== 'product' && parsed.type !== 'unknown') { err('扫描商品条码或取货标签'); return }
    // 商品码路径保持原语义：扫码即直接装箱（默认数量 1），无需额外确认
    void submitAdd({ productCode: raw, qty: 1 })
  }, [activePackageId, err, addAction, onlineBlocked, taskDetail, taskLoading, submitAdd])

  // ── 任务未选 ────────────────────────────────────────────────────────────
  if (!task && !routeTaskId) return <TaskSelectStep onSelect={t => { setTask(t); setActivePackageId(null) }} />

  if (taskId <= 0) {
    return (
      <PdaTaskState
        title="缺少打包任务"
        description="未找到打包任务信息，请返回列表重新选择。"
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
        description={`任务 ${taskDetail.taskNo} 当前状态为「${taskDetail.statusName}」。打包页只允许处理「待打包」任务，请选择其他待打包任务。`}
        actionText="选择其他任务"
        onAction={goSelectTask}
        secondaryText="返回工作台"
        onSecondary={() => navigate('/pda')}
      />
    )
  }

  const activeBoxes = packages.filter(p => p.status !== 3)
  const totalBoxes = activeBoxes.length
  const doneBoxes  = activeBoxes.filter(p => p.status === 2).length
  const totalItems = activeBoxes.reduce((s, p) => s + p.items.reduce((ss, i) => ss + i.qty, 0), 0)
  // 已完成但箱贴还没打印成功的箱子：它们正是「完成打包」被服务端拦下的原因
  const unprintedBoxes = activeBoxes.filter(p => p.status === 2 && p.printStatus?.key !== 'success')
  // ── 全部完成页 ────────────────────────────────────────────────────────────
  if (allDone) return (
    <PdaDoneView
      icon={<PartyPopper className="h-20 w-20 text-green-600" />}
      title="打包完成！"
      description={`任务：${taskDetail.taskNo} · 共 ${totalBoxes} 箱，${totalItems.toFixed(0)} 件商品`}
      actionText="返回工作台"
      onAction={() => navigate('/pda')}
      secondaryText="继续打包"
      onSecondary={goSelectTask}
    />
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
              addAction.blockedReason
              || finishAction.blockedReason
              || printAction.blockedReason
              || finalizeAction.blockedReason
              || (onlineBlocked ? '网络已断开，打包、打印和完成待出库都已阻断。' : null)
            }
            pendingRecord={addAction.pendingRecord ?? finishAction.pendingRecord ?? printAction.pendingRecord ?? finalizeAction.pendingRecord}
            confirming={addAction.confirming || finishAction.confirming || printAction.confirming || finalizeAction.confirming}
            phase={packNoticeAction?.phase}
            phaseMessage={packNoticeAction?.phaseMessage}
            lastErrorMessage={packNoticeAction?.lastErrorMessage}
            onConfirm={() => {
              const handler = addAction.pendingRecord
                ? addAction
                : finishAction.pendingRecord
                  ? finishAction
                  : printAction.pendingRecord
                    ? printAction
                    : finalizeAction
              void handler.confirmPending().then((status) => {
                if (!status) return
                if (status.status === 'pending') warn(status.message || '系统还未确认结果，请稍后再查')
                if (status.status === 'state_unconfirmed') warn(status.message)
                if (status.status === 'not_found') warn(status.message || '未找到上次提交记录；请先刷新箱子和任务状态后再重试')
                if (status.status === 'failed') err(status.message || '上次操作未成功，请检查后重试')
              })
            }}
            onClear={() => {
              // 人工明确清除：只清**当前待确认**的那一个 action（装箱优先），绝不自动清 pending
              const handler = addAction.pendingRecord
                ? addAction
                : finishAction.pendingRecord
                  ? finishAction
                  : printAction.pendingRecord
                    ? printAction
                    : finalizeAction
              handler.clearPending()
            }}
            onDismissError={() => packNoticeAction?.clearError()}
          />

          {/* 待确认期间的**原提交定位**：取自冻结记录而不是当前界面状态——重挂后 activePackageId
              可能已指向别的箱子，任务列表也可能换了人，不能让它们替代原目标。 */}
          {addAction.pendingRecord && (
            <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 dark:border-amber-700 dark:bg-amber-950/40">
              <p className="text-xs font-semibold text-amber-800 dark:text-amber-200">上次装箱提交（结果待确认）</p>
              <div className="mt-1 grid grid-cols-2 gap-2 text-xs text-amber-900 dark:text-amber-100">
                <div>任务 <span className="font-mono">{String(addAction.pendingRecord.metadata?.taskNo ?? addAction.pendingRecord.metadata?.taskId ?? '—')}</span></div>
                <div>箱子 <span className="font-mono">{String(addAction.pendingRecord.metadata?.packageBarcode ?? addAction.pendingRecord.metadata?.packageId ?? '—')}</span></div>
                <div className="min-w-0">
                  条码 <span className="font-mono break-all">
                    {String(addAction.pendingRecord.metadata?.labelBarcode ?? addAction.pendingRecord.metadata?.productCode ?? '—')}
                  </span>
                </div>
                <div>数量 <span className="font-mono">{addAction.pendingRecord.metadata?.qty == null ? '整份' : String(addAction.pendingRecord.metadata.qty)}</span></div>
              </div>
            </div>
          )}

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
              onActivate={() => {
                // 待确认期间冻结原目标：换箱会让「上次装箱到底装进哪只箱」失去可见的恢复入口
                if (addAction.submitBlocked) { err(addAction.blockedReason || '上次装箱结果待确认，请先确认'); return }
                setActivePackageId(pkg.id)
              }}
              onFinish={() => finishMut.mutate(pkg.id)}
              finishing={finishMut.isPending || finishAction.submitBlocked || addAction.submitBlocked || onlineBlocked}
              onPrintLabel={() => printLabelMut.mutate(pkg.id)}
              printingLabel={(printLabelMut.isPending && printLabelMut.variables === pkg.id) || printAction.submitBlocked || onlineBlocked}
              onRemoveItem={(itemId) => {
                // 待确认期间不得移出：会改变冻结记录对应的箱内状态
                if (addAction.submitBlocked) { err(addAction.blockedReason || '上次装箱结果待确认，请先确认'); return }
                removeItemMut.mutate({ packageId: pkg.id, itemId })
              }}
              removingItemId={removeItemMut.isPending ? removeItemMut.variables?.itemId ?? null : null}
              onVoid={() => {
                if (addAction.submitBlocked) { err(addAction.blockedReason || '上次装箱结果待确认，请先确认'); return }
                voidMut.mutate(pkg.id)
              }}
              voiding={(voidMut.isPending && voidMut.variables === pkg.id) || addAction.submitBlocked}
            />
          ))}
          {packages.length === 0 && !pkgLoading && (
            <div className="rounded-2xl border border-dashed border-border bg-muted/20 py-10 text-center">
              <p className="text-muted-foreground text-sm">点击下方「新建箱子」开始打包</p>
            </div>
          )}
          {totalBoxes > 0 && activeBoxes.every((pkg) => pkg.status === 2) ? (
            <>
              {/*
                箱贴未打印成功时，完成打包会被系统拒绝（出库前置：箱贴必须有打印成功记录）。
                这里把原因与出路直接摆出来，避免操作员只看到通用错误后反复无效重试。
              */}
              {unprintedBoxes.length > 0 && (
                <div className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-xs text-amber-800 space-y-1">
                  <p className="font-semibold">箱贴尚未打印完成，暂时不能进入待出库</p>
                  <p>
                    待处理箱：{unprintedBoxes.map(pkg => `${pkg.barcode}（${pkg.printStatus?.label ?? '未生成箱贴'}）`).join('、')}
                  </p>
                  <p className="text-amber-700">
                    处理办法：点该箱的「打印箱贴」重新入队，或在 ERP「系统 → 条码打印查询 → 出库条码」重新打印；
                    若无出纸，请先启动绑定该打印机的极序 Flow 桌面端，客户端上线后会自动领取待派发任务。
                  </p>
                </div>
              )}
              <Button
                type="button"
                className="w-full"
                onClick={() => finalizeMut.mutate()}
                disabled={finalizeMut.isPending || finalizeAction.submitBlocked || addAction.submitBlocked}
              >
                {finalizeMut.isPending ? '处理中…' : '完成打包并进入待出库'}
              </Button>
            </>
          ) : null}
        </div>
      </div>

      <PdaBottomBar>
          {activePackageId && <PdaScanner onScan={handleScan} placeholder="扫描商品条码或取货标签" disabled={addAction.submitBlocked || onlineBlocked} onDuplicate={() => err('重复扫码，请稍候')} />}
          <Button variant={activePackageId ? 'outline' : 'default'} className="w-full" onClick={() => createMut.mutate()} disabled={createMut.isPending || addAction.submitBlocked || onlineBlocked}>
            {createMut.isPending ? '创建中…' : '＋ 新建箱子'}
          </Button>
      </PdaBottomBar>

    </div>
  )
}
