import { qty as formatQty } from '@/lib/format'
import PdaOverviewText from '@/components/pda/PdaOverviewText'
import PdaProductIdentity from '@/components/pda/PdaProductIdentity'
/**
 * PDA 打包作业
 * 路由：/pda/pack
 */
import { Package as PackageIcon, CircleCheck, Ban, PartyPopper } from 'lucide-react'
import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
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
import type { AddPackageItemPayload, PackageItem, RemovePackageItemResult } from '@/api/packages'
import { getOperationRequestStatusApi } from '@/api/operation-requests'
import type { Package, PackagePrintJob } from '@/api/packages'
import type { WarehouseTask } from '@/api/warehouse-tasks'
import { usePdaFeedback } from '@/hooks/usePdaFeedback'
import { triggerPrintPoll } from '@/lib/printQueue'
import { useCriticalPdaAction } from '@/hooks/useCriticalPdaAction'
import { usePendingRequests } from '@/hooks/usePendingRequests'
import PdaCriticalActionNotice from '@/components/pda/PdaCriticalActionNotice'
import { PdaTaskState } from '@/components/pda/PdaTaskState'
import PdaDoneView from '@/components/pda/PdaDoneView'
import PdaNextStep from '@/components/pda/PdaNextStep'
import { PERMISSIONS } from '@/lib/permission-codes'

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
    <div className={`rounded-2xl border transition-all motion-reduce:transition-none ${
      active ? 'border-primary bg-primary/5' : pkg.status === 2 ? 'border-success/30 bg-success/10' : pkg.status === 3 ? 'border-border bg-muted/20 opacity-60' : 'border-border bg-card'
    }`}>
      <button onClick={() => { setOpen(o => !o); if (!active && pkg.status !== 3) onActivate() }}
        className="w-full flex items-center justify-between px-4 py-3 text-left">
        <div className="flex items-center gap-2">
          <span className="shrink-0">
            {pkg.status === 2
              ? <CircleCheck className="h-4 w-4 text-success-ink" />
              : pkg.status === 3
                ? <Ban className="h-4 w-4 text-muted-foreground" />
                : <PackageIcon className={active ? 'h-4 w-4 text-primary' : 'h-4 w-4 text-muted-foreground'} />}
          </span>
          <div>
            <p className="font-mono font-bold text-foreground text-sm">{pkg.barcode}</p>
            {/* 种数按**商品**去重：装箱行按来源取货标签分行后，同一商品会有多行
                （旧 SKU 一行 + 各取货标签各一行），不能拿行数当"种"数 */}
            <p className="text-xs text-muted-foreground">{new Set(pkg.items.map(i => i.productId)).size} 种，{formatQty(totalQty)} 件</p>
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
                    size="lg"
                    variant="ghost"
                    className="px-3 text-xs text-destructive-ink hover:text-destructive-ink"
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
            size="lg"
            variant="outline"
            className="px-3 w-full mt-2"
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
            pkg.printStatus?.key === 'success' ? 'text-success-ink'
              : pkg.printStatus?.key === 'failed' ? 'text-destructive-ink'
                : 'text-warning-ink'
          }`}>
            箱贴：{pkg.printStatus?.label ?? '未生成箱贴'}
            {pkg.printStatus?.errorMessage ? `（${pkg.printStatus.errorMessage}）` : ''}
          </p>
          {editable && pkg.items.length > 0 && (
            <Button size="lg" className="px-3 w-full mt-1" onClick={onFinish} disabled={finishing}>
              {finishing ? '处理中…' : '✓ 完成此箱'}
            </Button>
          )}
          {editable && (
            <Button size="lg" variant="outline" className="px-3 w-full mt-1 text-destructive-ink hover:text-destructive-ink" onClick={onVoid} disabled={voiding}>
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
  const [completedTaskId, setCompletedTaskId] = useState<number | null>(null)
  const [shipTaskId, setShipTaskId] = useState<number | null>(null)

  const taskId = task?.id ?? routeTaskId
  const currentTaskId = useRef(taskId)
  currentTaskId.current = taskId
  const allDone = completedTaskId === taskId
  const goSelectTask = useCallback(() => {
    setTask(null)
    setActivePackageId(null)
    setCompletedTaskId(null)
    setShipTaskId(null)
    navigate('/pda/pack')
  }, [navigate])

  const {
    data: taskDetail,
    isLoading: taskLoading,
    isError: taskError,
    refetch: refetchTask,
  } = useQuery({
    queryKey: ['pda-pack-task', taskId],
    queryFn: () => getTaskByIdApi(taskId),
    enabled: taskId > 0,
  })

  // ── 兼容**旧版本已经落盘**的 finish pending ────────────────────────────────────
  // 更早的版本把 finish 的 action 写成 `package.finish.<taskId>`。那些记录已经存进 localStorage，
  // 若这里直接换成 base，它们就**再也匹配不上** —— 等于把原问题换了个形式（记录还在、人看不见，
  // 也没有「确认上次结果」入口）。因此：**页面层**识别到旧记录就**继续沿用它的 action**
  // （因而沿用原 key 与原 metadata），**新操作**才用 base。
  // **不改公共 pending 框架、也不静默清除旧记录**；旧记录仍由用户显式「清除」或在确认成功时自然消失。
  const { records: pendingRecords } = usePendingRequests()
  // 只**定位**旧记录：只要有 `package.finish.<数字>` 的旧 action 就沿用它的 action ——
  // 这样 hook 能匹配到它、**继续阻断**（旧记录不会因为换了 action 名而"消失"）。
  const legacyFinishRecord = useMemo(
    () => pendingRecords.find((r) => /^package\.finish\.\d+$/.test(String(r.action || ''))) ?? null,
    [pendingRecords],
  )
  // 箱贴打印 / 完成打包与 finish 同源：旧版 action 都绑了 taskId，换成 base 后旧记录会永久失联。
  // 同样只**定位**，沿用原 action 让记录继续阻断；是否据以恢复另有严格校验（见各自 resolveServerState）。
  // 后缀 `none` 是旧版在 taskId 缺失时写的（`package.print.${taskId || 'none'}`）：
  // 同样**沿用原 action** 让它继续阻断（不静默消失）；后缀不是数字时 resolver 不据以恢复。
  const legacyPrintRecord = useMemo(
    () => pendingRecords.find((r) => /^package\.print\.(\d+|none)$/.test(String(r.action || ''))) ?? null,
    [pendingRecords],
  )
  const legacyFinalizeRecord = useMemo(
    () => pendingRecords.find((r) => /^warehouse\.pack-done\.(\d+|none)$/.test(String(r.action || ''))) ?? null,
    [pendingRecords],
  )
  // 「是否**据以恢复内容**」的严格校验在下面两处（都不满足就只阻断、不恢复）：
  //   · `frozenRecordTrusted` —— 决定冻结卡片**展不展示原内容**（归属不明时只提示人工核对）；
  //   · `resolveServerState` —— 决定能不能把查询结果判成「本次成功」。
  // 三道条件：① scoped action 后缀 === `metadata.taskId`；② `packageId` 为正整数；③ owner 可信。
  // 任一条不满足 ⇒ **仍然沿用旧 action 让记录继续阻断**（不静默消失），但**不据其 metadata 恢复**，
  // 由用户显式「清除记录」收场 —— **不静默抛弃**。

  const finishAction = useCriticalPdaAction<{
    id: number
    allPackagesDone?: boolean
    printJob?: PackagePrintJob
    /** 回执自带原任务 id：用来判断「所有箱完成」是不是**当前任务**的结论 */
    warehouseTaskId?: number
  }>({
    // 有旧版 scoped 记录 ⇒ 沿用原 action（不绑 taskId 的新写法见下）；
    // 否则用 base：`usePendingRequests` 按 action 名存/找记录，带 taskId 会让「换任务重挂」
    // 后匹配不上，冻结定位与「确认」入口一起消失。服务端幂等 action 仍是 scoped
    // `package.finish.<箱id>`，具体绑定由 `resolveServerState` 里的 scoped 查询完成。
    action: legacyFinishRecord?.action ?? 'package.finish',
    requestAction: 'package.finish',
    label: '完成箱子',
    onConfirmed: async (data) => {
      await refetch()
      // 文案**不**说「当前箱」：恢复 / 换目标之后「当前」可能已经不是原箱了，
      // 成功与否是**回执里那个箱**的事（回执已绑定原箱：base 查唯一 scoped 行，
      // 兜底用原箱的 scoped action 并校验 resourceId）。
      ok(`箱子已完成（#${data?.id ?? '—'}），箱贴已进入打印链`)
      // 「所有箱子都完成了」只对当前任务说：可能是在**别的任务**的页面上查回**原任务**的原箱回执，
      // 直接说「所有箱完成」会被当成当前任务的结论。回执自带 `warehouseTaskId`，据此判断；
      // 该字段缺失 / 非法时不能拼出 `#NaN`，退回一句中文说明。
      const originalTaskId = Number(data?.warehouseTaskId)
      const hasOriginalTaskId = Number.isInteger(originalTaskId) && originalTaskId > 0
      const isCurrentTask = hasOriginalTaskId && originalTaskId === Number(taskId)
      if (data.allPackagesDone && isCurrentTask) {
        ok('本任务所有箱子已完成。请确认箱贴打印完成后，再结束打包进入待出库。')
      } else if (data.allPackagesDone) {
        warn(
          hasOriginalTaskId
            ? `这是原任务 #${originalTaskId} 的箱子，该任务箱子已全部完成；当前任务以本页列表为准。`
            : '这是其它任务的箱子（结果里没有任务号），当前任务以本页列表为准。',
          5000,
        )
      }
    },
    resolveServerState: async ({ record }) => {
      const packageId = Number(record.metadata?.packageId ?? 0)
      if (!Number.isInteger(packageId) || packageId <= 0) return { effective: false }
      // 旧版 scoped 记录：`package.finish.<taskId>` 的后缀必须与 metadata.taskId 一致，
      // 否则这条记录可能被挪用 / 属于别的任务 ⇒ **不据以恢复**（仍保留记录继续阻断）。
      const scoped = /^package\.finish\.(\d+)$/.exec(String(record.action || ''))
      if (scoped && Number(record.metadata?.taskId) !== Number(scoped[1])) return { effective: false }
      // owner 不可信的历史记录一律不据以恢复
      if (record.unverifiedOwner) return { effective: false }
      // **只认原键回执**。列表里 `status === 2` 只能说明「这个箱现在是已完成」——
      // 它**完全可能来自上一次**（工人重复点、或该箱本来就早完成了），
      // 所以拿列表状态当「本次完成成功」的证据是错的：那正是把「本次意图」猜成了别的操作的结果。
      // 服务端回执行是按原键 + 原箱落库的（`package.finish.<箱id>`），只有它 success 才算本次成功。
      const st = await getOperationRequestStatusApi(record.requestKey, `package.finish.${packageId}`)
      if (st?.status !== 'success') return { effective: false }
      // 回执必须绑定**原箱**
      if (st.resourceId != null && Number(st.resourceId) !== packageId) return { effective: false }
      return {
        effective: true,
        data: st.data as { id: number; allPackagesDone?: boolean },
        message: '本次完成箱已确认',
      }
    },
  })
  const printAction = useCriticalPdaAction<{
    queued: boolean
    job?: PackagePrintJob | unknown
  }>({
    // 与 finish 同源的问题：action 绑 `taskId` 会让「换任务重挂」后原 pending 匹配不上。
    // 有旧版 scoped 记录就沿用原 action（继续阻断、不静默消失），否则用 base。
    action: legacyPrintRecord?.action ?? 'package.print-label',
    requestAction: 'package.print-label',
    label: '箱贴打印',
    onConfirmed: async (data) => {
      // **三种成功路径都走这里**（正常提交 / 恢复确认 / hook 兜底确认）——所以轮询唤醒、刷新、
      // 离线提示、未绑定提示**全部放这一处**。只放 mutation 会让「查回执恢复」那条路静默：
      // 恢复不走 `mutation.onSuccess`，用户确认完什么提示都看不到。
      const job = (data?.job && typeof data.job === 'object' ? data.job : null) as
        (PackagePrintJob & { id?: number; refCode?: string }) | null
      if (data?.queued === true) {
        // PDA 自身不打印，箱贴由仓库里的桌面打印客户端领取执行；此处唤醒仅在桌面端生效
        triggerPrintPoll()
        refetch()
        const hint = job?.dispatchHint
        if (hint?.clientOnline === false) warn(packageLabelTraceMessage(job), 5000)
        // 回执带的是**原快照**（原箱条码），换任务后也不会说成「当前箱已打印」；
        // 措辞点明「只是排队」——这张提示不代表现场已经出纸。
        else ok(`箱贴已加入打印队列（打印任务 #${job?.id ?? '—'}${job?.refCode ? `，箱 ${job.refCode}` : ''}）——仅表示已排队，不代表已出纸`)
      } else {
        // 未绑定打印机：泛指「本次打印记录」，**不**拿当前界面上的箱去补旧 payload 里缺的信息
        warn('本次打印记录已保留，但未排队、未出纸；请先绑定打印机，再到「打印记录」页补打', 5000)
      }
    },
    resolveServerState: async ({ record }) => {
      // 与 finish 同口径：**只认原键回执**，且回执必须绑**原箱**（含回执里 job 的归属）。
      // 列表里的打印状态只说明「这只箱现在打印到哪一步了」，完全可能来自上一次，不能当本次证据。
      const packageId = Number(record.metadata?.packageId ?? 0)
      if (!Number.isInteger(packageId) || packageId <= 0) return { effective: false }
      if (record.unverifiedOwner) return { effective: false }
      // 旧版 scoped 记录的后缀是 **taskId**（原实现 `package.print.<taskId>`），
      // 必须与 metadata.taskId **严格相等**才据以恢复；对不上/残缺一律只阻断不恢复。
      const scoped = /^package\.print\.(\d+)$/.exec(String(record.action || ''))
      if (scoped && Number(scoped[1]) !== Number(record.metadata?.taskId)) return { effective: false }
      const st = await getOperationRequestStatusApi(record.requestKey, `package.print-label.${packageId}`)
      if (st?.status !== 'success') return { effective: false }
      if (st.resourceId != null && Number(st.resourceId) !== packageId) return { effective: false }
      // 回执里的 job 也必须指向原箱（后端已在写重放/查询两处拦住跨箱历史行，这里再兜一道）
      const job = (st.data as { job?: { refId?: number } } | null)?.job
      if (job && job.refId != null && Number(job.refId) !== packageId) return { effective: false }
      return {
        effective: true,
        data: st.data as { queued: boolean; job?: PackagePrintJob | unknown },
        message: '本次箱贴打印已确认',
      }
    },
  })
  const finalizeAction = useCriticalPdaAction<{ taskId: number }>({
    action: legacyFinalizeRecord?.action ?? 'warehouse.pack-done',
    requestAction: 'warehouse.pack-done',
    label: '完成打包',
    onConfirmed: async (data) => {
      // 「本任务已打包完成」只对**回执里那个任务**说：可能是在别的任务页面上确认回原任务的回执，
      // 那时把当前页切成「打包完成！」就是在骗人。
      const origTaskId = Number(data?.taskId)
      if (Number.isInteger(origTaskId) && origTaskId === Number(taskId)) {
        if (currentTaskId.current !== taskId) return
        setCompletedTaskId(origTaskId)
        setShipTaskId(null)
        try {
          const latest = await getTaskByIdApi(origTaskId, { skipGlobalError: true })
          if (currentTaskId.current === origTaskId && latest.id === origTaskId && latest.status === WT_STATUS.SHIPPING) setShipTaskId(origTaskId)
        } catch { /* 原完成回执保留；读取失败不提供出库入口。 */ }
      } else if (Number.isInteger(origTaskId) && origTaskId > 0) {
        warn(`原任务 #${origTaskId} 的「完成打包」已确认；当前任务以本页状态为准。`, 5000)
      }
    },
    resolveServerState: async ({ record }) => {
      // **只认原键回执**，并校验它绑定的是**原任务**。
      // 不能用「当前任务状态已是待出库(6)」当本次成功的证据 —— 那可能来自上一次、或别的操作。
      const scoped = /^warehouse\.pack-done\.(\d+)$/.exec(String(record.action || ''))
      const metaTaskId = Number(record.metadata?.taskId)
      const origTaskId = scoped ? Number(scoped[1]) : metaTaskId
      if (!Number.isInteger(origTaskId) || origTaskId <= 0) return { effective: false }
      if (record.unverifiedOwner) return { effective: false }
      // 旧版 scoped 记录**必须**与 metadata.taskId **严格相等**才敢用：只凭 action 后缀就恢复，
      // 等于用「action 名叫什么」代替「这条记录是谁的」——残缺/被挪用的记录会指错原目标。
      // 对不上就**只阻断不恢复**，由用户显式核对后清除。
      if (scoped && (!Number.isInteger(metaTaskId) || metaTaskId !== origTaskId)) return { effective: false }
      const st = await getOperationRequestStatusApi(record.requestKey, `warehouse.pack-done.${origTaskId}`)
      if (st?.status !== 'success') return { effective: false }
      if (st.resourceId != null && Number(st.resourceId) !== origTaskId) return { effective: false }
      return { effective: true, data: { taskId: origTaskId }, message: '本次完成打包已确认' }
    },
  })

  const { data: packages = [], isLoading: pkgLoading, isError: pkgError, refetch: refetchPackages } = useQuery({
    queryKey: ['pda-packages', taskId],
    queryFn:  () => getPackagesApi(taskId),
    // **只读事实的加载不绑状态**：任务被「完成打包」推进到 6 之后（尤其是后台成功、响应丢失后
    // 重挂的那次），页面仍要显示这只箱装了什么。原先 `enabled` 带 `status === PACKING`，
    // 状态一变查询就不发，`packages` 退化成 `[]`，页面把**没查**画成「0 箱 0 件」并劝人
    // 「点击下方新建箱子开始打包」——现场会以为箱子没了。
    // 放开这一点**不放开写**：建箱/装箱/移出/作废/完成/完成打包仍各自校验 `status === PACKING`。
    enabled:  taskId > 0 && !taskLoading,
  })

  useEffect(() => {
    if (activePackageId) return
    const open = packages.find(p => p.status === 1)
    if (open) setActivePackageId(open.id)
  }, [packages, activePackageId])

  // 用**函数声明**而不是 const 箭头：`printAction.onConfirmed` 定义在它之前，
  // 而「查回执恢复」那条路径同样要刷新箱子列表（不刷新就看不到打印状态变化）。
  function refetch() { return qc.invalidateQueries({ queryKey: ['pda-packages', taskId] }) }
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

  // 移出也走关键操作：未确认期间冻结**原目标**（箱 / 明细），恢复只认**原键回执**
  const removeAction = useCriticalPdaAction<RemovePackageItemResult>({
    // 与服务端幂等 action 对齐：服务端落库的 scopedAction 是 `package.remove-item.<箱id>`
    action: 'package.remove-item',
    requestAction: 'package.remove-item',
    label: '移出确认',
    onConfirmed: async (data) => {
      if (data) ok(data.removed ? `已移出 ${data.productName}` : `${data.productName} 数量已调整为 ${data.qty}`)
      refetch()
    },
    resolveServerState: async ({ record }) => {
      // 移出会**真的删行或改数量**，所以只能靠**原键回执**定位本次提交；
      // **不能**凭列表里该明细还在不在判本次成功——部分移出与整行移出的行状态不同，
      // 而且原明细可能已被整行删掉（那正是必须靠回执才能确认的场景）。
      const meta = record.metadata ?? {}
      const packageId = Number(meta.packageId)
      if (!Number.isInteger(packageId) || packageId <= 0) return { effective: false }
      const st = await getOperationRequestStatusApi(record.requestKey, `package.remove-item.${packageId}`)
      if (st?.status !== 'success') return { effective: false }
      // 回执必须绑定**原箱**
      if (st.resourceId != null && Number(st.resourceId) !== packageId) return { effective: false }
      return { effective: true, data: st.data as RemovePackageItemResult, message: '本次移出已确认' }
    },
  })

  // 作废同样走关键操作：作废是终态，同键重放必须回**首次回执**，而不是再报「已作废」
  const voidAction = useCriticalPdaAction<{ id: number }>({
    action: 'package.void',
    requestAction: 'package.void',
    label: '作废确认',
    onConfirmed: async (data) => {
      if (data) {
        ok(`箱子 ${data.id} 已作废`)
        setActivePackageId(prev => (prev === Number(data.id) ? null : prev))
      }
      refetch()
    },
    resolveServerState: async ({ record }) => {
      const meta = record.metadata ?? {}
      const packageId = Number(meta.packageId)
      if (!Number.isInteger(packageId) || packageId <= 0) return { effective: false }
      const st = await getOperationRequestStatusApi(record.requestKey, `package.void.${packageId}`)
      if (st?.status !== 'success') return { effective: false }
      if (st.resourceId != null && Number(st.resourceId) !== packageId) return { effective: false }
      return { effective: true, data: st.data as { id: number }, message: '本次作废已确认' }
    },
  })

  // 关键操作共用一个「当前待确认」位次：装箱 → 移出 → 作废 → **完成箱子** → 打印机 → 完成打包。
  // **完成箱子（finishAction）必须保留在位**：旧版链里就有它，漏掉会让「完成箱」待确认时
  // frozenRecord 变 null、查询/清除落到 finalizeAction，等于把既有的恢复入口改回归了。
  // 任一未确认都冻结换箱 / 换目标 / 新增等操作，别让原目标的恢复入口消失。
  const noticePendingAction =
    addAction.pendingRecord ? addAction
      : removeAction.pendingRecord ? removeAction
        : voidAction.pendingRecord ? voidAction
          : finishAction.pendingRecord ? finishAction
            : printAction.pendingRecord ? printAction
              : finalizeAction.pendingRecord ? finalizeAction
                : null
  const frozenRecord = noticePendingAction?.pendingRecord ?? null
  // 冻结卡片**能不能展示原内容**：归属不明（owner 不可信 / 缺 packageId / 旧 scoped 记录的后缀
  // 与 metadata.taskId 不一致）时**不展示**原内容，只提示人工核对并保留阻断 ——
  // 展示错的原目标比不展示更糟（工人会照着错的去核对实物）。
  const frozenRecordTrusted = useMemo(() => {
    if (!frozenRecord) return false
    if (frozenRecord.unverifiedOwner) return false
    const action = String(frozenRecord.action || '')
    const meta = (frozenRecord.metadata ?? {}) as { taskId?: unknown; packageId?: unknown }

    // 完成箱子：旧 scoped 记录要有 packageId 且后缀 === metadata.taskId
    const finishScoped = /^package\.finish\.(\d+)$/.exec(action)
    if (finishScoped) {
      const pid = Number(meta.packageId)
      if (!Number.isInteger(pid) || pid <= 0) return false
      return Number(meta.taskId) === Number(finishScoped[1])
    }
    // 箱贴打印：旧版 scoped 记录的后缀是 **taskId**（原实现 `package.print.<taskId>`，不是 packageId），
    // 因此要求 packageId 为正整数（恢复要用它去查 `package.print-label.<箱id>`）且后缀 === metadata.taskId
    const printScoped = /^package\.print\.(\d+)$/.exec(action)
    if (printScoped) {
      const pid = Number(meta.packageId)
      if (!Number.isInteger(pid) || pid <= 0) return false
      return Number(meta.taskId) === Number(printScoped[1])
    }
    // 完成打包：旧 scoped 记录要有 taskId 且后缀 === metadata.taskId
    const finalizeScoped = /^warehouse\.pack-done\.(\d+)$/.exec(action)
    if (finalizeScoped) {
      const tid = Number(meta.taskId)
      if (!Number.isInteger(tid) || tid <= 0) return false
      return Number(finalizeScoped[1]) === tid
    }
    // base action 的新记录：不再靠 action 名判归属，缺 packageId/taskId 时下面分支各自处理
    return true
  }, [frozenRecord])
  // 未确认原箱结果期间，本页的**换箱 / 扫码 / 新建箱 / 移出 / 作废 / 完成箱子 / 完成打包**都要被冻结 ——
  // 否则「原目标恢复入口」虽然还在，工人却已经能在别的箱上继续动手，定位就失去了意义。
  // finish 的 `submitBlocked` 只覆盖「有待确认记录」，**提交中**（`phase === 'submitting'`）也要算进来。
  // print / finalize 已随本批 C4 一并纳入（它们的待确认来源与 finish 同类）。
  const anySubmitBlocked = addAction.submitBlocked || removeAction.submitBlocked || voidAction.submitBlocked
    || finishAction.submitBlocked || finishAction.phase === 'submitting'
    // 打印 / 完成打包同样纳入本页冻结：它们也是「未确认原目标结果」的来源，
    // 只挡别的入口会让工人一边等着确认、一边在别的箱上继续动手，定位就失去意义。
    || printAction.submitBlocked || printAction.phase === 'submitting'
    || finalizeAction.submitBlocked || finalizeAction.phase === 'submitting'
  const anyBlockedReason = addAction.blockedReason || removeAction.blockedReason || voidAction.blockedReason
    || finishAction.blockedReason

  // 提示卡片的 phase/lastErrorMessage 来源：优先未确认的 pendingRecord，
  // 其次正在提交/刚失败的。放在这些 action 之后定义，避免提前引用。
  const packNoticeAction =
    noticePendingAction
      ?? (addAction.phase !== 'idle' || addAction.lastErrorMessage ? addAction
        : removeAction.phase !== 'idle' || removeAction.lastErrorMessage ? removeAction
          : voidAction.phase !== 'idle' || voidAction.lastErrorMessage ? voidAction
            : finishAction.phase !== 'idle' || finishAction.lastErrorMessage ? finishAction
              : printAction.phase !== 'idle' || printAction.lastErrorMessage ? printAction
                : finalizeAction.phase !== 'idle' || finalizeAction.lastErrorMessage ? finalizeAction
                  : null)

  // 移出走关键操作：未确认期间冻结**原目标**（箱 / 明细），恢复只认**原键回执**
  const runRemoveItem = async (pkg: Package, item: PackageItem) => {
    if (!taskDetail) { err('任务数据仍在加载，请稍后重试'); return }
    if (taskDetail.status !== WT_STATUS.PACKING) { err('当前任务不是待打包状态，不能移出商品'); return }
    try {
      await removeAction.run(
        (requestKey) => removePackageItemApi(pkg.id, item.id, undefined, requestKey),
        {
          // 冻结**原目标与原货**：恢复定位与展示只用这份快照，不读当前 activePackageId 或列表状态。
          // 只留 itemId 认不出是哪件货——**整行移出后原明细行会被删掉**，
          // 待确认卡片必须能显示原条码 / 原商品名，否则工人对不上账。
          taskId, taskNo: taskDetail.taskNo, packageId: pkg.id, packageBarcode: pkg.barcode,
          itemId: item.id,
          labelBarcode: item.labelBarcode ?? null,
          productCode: item.productCode ?? null,
          productName: item.productName ?? null,
          // 本批前端只走**整份移出**（不传 qty）；卡片据此显示「整份」而不是某个数字
          qty: null,
        },
      )
    } catch (e) {
      err((e as { message?: string })?.message ?? '移出失败')
    }
  }

  const runVoid = async (pkg: Package) => {
    if (!taskDetail) { err('任务数据仍在加载，请稍后重试'); return }
    if (taskDetail.status !== WT_STATUS.PACKING) { err('当前任务不是待打包状态，不能作废箱子'); return }
    try {
      await voidAction.run(
        (requestKey) => voidPackageApi(pkg.id, requestKey),
        { taskId, taskNo: taskDetail.taskNo, packageId: pkg.id, packageBarcode: pkg.barcode },
      )
    } catch (e) {
      err((e as { message?: string })?.message ?? '作废失败')
    }
  }

  const printLabelMut = useMutation({
    mutationFn: async (pkgId: number) => {
      if (!taskDetail) throw new Error('任务数据仍在加载，请稍后重试')
      if (taskDetail.status !== WT_STATUS.PACKING) throw new Error('当前任务不是待打包状态，不能打印箱贴')
      const pkg = (packages ?? []).find(p => Number(p.id) === pkgId)
      const result = await printAction.run((requestKey) =>
        printPackageLabelApi(pkgId, requestKey),
        // 冻结**原目标**：任务号 + 箱条码。只存 ID 时，换任务 / 重挂之后待确认卡片
        // 说不清「上次要补打的是哪只箱」，认不出原货，也无法判断旧 scoped 记录是否自洽。
        { taskId, taskNo: taskDetail.taskNo, packageId: pkgId, packageBarcode: pkg?.barcode ?? null },
      )
      return result
    },
    onSuccess: (d) => {
      // **只**处理待确认。成功 / 未绑定的用户可见提示 + 轮询唤醒 + 刷新统一由
      // `printAction.onConfirmed` 发出（正常、恢复、兜底三条路径共用），这里再发一次会重复。
      if (d.kind === 'pending') warn('网络中断，打印结果待确认')
    },
    onError: (e: unknown) => err((e as { message?: string })?.message ?? '打印失败'),
  })

  const finishMut = useMutation({
    mutationFn: async (pkgId: number) => {
      if (!taskDetail) throw new Error('任务数据仍在加载，请稍后重试')
      if (taskDetail.status !== WT_STATUS.PACKING) throw new Error('当前任务不是待打包状态，不能完成箱子')
      const pkg = (packages ?? []).find(p => Number(p.id) === pkgId)
      const result = await finishAction.run((requestKey) =>
        finishPackageApi(pkgId, requestKey).then((res) => res!),
        {
          // 冻结**原目标**：任务号 + 箱条码。只存 taskId/pkgId 时，换目标 / 重挂之后
          // 待确认卡片说不清「上次要完成的到底是哪个箱」，也认不出原货。
          taskId, taskNo: taskDetail.taskNo,
          packageId: pkgId, packageBarcode: pkg?.barcode ?? null,
        },
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
        // 冻结**原任务**：只存 taskId 时，换任务 / 重挂后待确认卡片只能说「任务 1207」，
        // 现场认不出那是哪个作业单，也没法跟单据核对。补 taskNo。
        { taskId, taskNo: taskDetail.taskNo },
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
    if (anySubmitBlocked) { err(anyBlockedReason || '上次操作结果待确认，请先确认后再扫'); return }
    const parsed = parseBarcode(raw)
    // 取货标签（整件 I 码）：整份装入该标签的未装余量，数量由服务端在锁内决定，
    // 这里**不传 qty**——工人扫一张标签就该把这张标签的货全放进去，不是 1 件。
    if (parsed.type === 'container') { void submitAdd({ labelBarcode: raw.trim() }); return }
    if (parsed.type !== 'product' && parsed.type !== 'unknown') { err('扫描商品条码或取货标签'); return }
    // 商品码路径保持原语义：扫码即直接装箱（默认数量 1），无需额外确认
    void submitAdd({ productCode: raw, qty: 1 })
  }, [activePackageId, err, anyBlockedReason, anySubmitBlocked, onlineBlocked, taskDetail, taskLoading, submitAdd])

  const recoveryNotice = <>
          <PdaCriticalActionNotice
            blockedReason={
              anyBlockedReason
              || finishAction.blockedReason
              || printAction.blockedReason
              || finalizeAction.blockedReason
              || (onlineBlocked ? '网络已断开，打包、打印和完成待出库都已阻断。' : null)
            }
            pendingRecord={frozenRecord}
            confirming={addAction.confirming || removeAction.confirming || voidAction.confirming || finishAction.confirming || printAction.confirming || finalizeAction.confirming}
            phase={packNoticeAction?.phase}
            phaseMessage={packNoticeAction?.phaseMessage}
            lastErrorMessage={packNoticeAction?.lastErrorMessage}
            onConfirm={() => {
              const handler = noticePendingAction ?? finalizeAction
              void handler.confirmPending().then((status) => {
                if (!status) return
                if (status.status === 'pending') warn(status.message || '系统还未确认结果，请稍后再查')
                if (status.status === 'state_unconfirmed') warn(status.message)
                if (status.status === 'not_found') warn(status.message || '未找到上次提交记录；请先刷新箱子和任务状态后再重试')
                if (status.status === 'failed') err(status.message || '上次操作未成功，请检查后重试')
              })
            }}
            onClear={() => {
              // 人工明确清除：只清**当前待确认**的那一个 action，绝不自动清 pending
              ;(noticePendingAction ?? finalizeAction).clearPending()
            }}
            onDismissError={() => packNoticeAction?.clearError()}
          />

          {/* 待确认期间的**原提交定位**：取自冻结记录而不是当前界面状态——重挂后 activePackageId
              可能已指向别的箱子，任务列表也可能换了人，不能让它们替代原目标。
              移出/作废同样冻结**原箱与原明细**，否则恢复时无法确认「上次动的到底是哪一行」。 */}
          {frozenRecord && (
            <div className="rounded-xl border border-warning/30 bg-warning/10 p-3 dark:border-warning/30 dark:bg-warning/10">
              <p className="text-xs font-semibold text-warning-ink dark:text-warning-ink">
                {frozenRecord.action === 'package.add'
                  ? '上次装箱提交（结果待确认）'
                  : frozenRecord.action === 'package.remove-item'
                    ? '上次移出提交（结果待确认）'
                    : frozenRecord.action === 'package.void'
                      ? '上次作废提交（结果待确认）'
                      // 其余（完成箱子 / 箱贴打印 / 完成打包）**不得**一律写成「装箱提交」，
                      // 按各自的 label 区分，否则现场看不出待确认的到底是哪一步。
                      : `上次${frozenRecord.label}（结果待确认）`}
              </p>
              {frozenRecordTrusted ? (
                <div className="mt-1 grid grid-cols-2 gap-2 text-xs text-warning-ink dark:text-warning-ink">
                  <div>任务 <span className="font-mono">{String(frozenRecord.metadata?.taskNo ?? frozenRecord.metadata?.taskId ?? '—')}</span></div>
                  <div>箱子 <span className="font-mono">{String(frozenRecord.metadata?.packageBarcode ?? frozenRecord.metadata?.packageId ?? '—')}</span></div>
                  <div className="min-w-0">
                    条码 <span className="font-mono break-all">
                      {String(frozenRecord.metadata?.labelBarcode ?? frozenRecord.metadata?.productCode ?? '—')}
                    </span>
                  </div>
                  {/* 原货名：整行移出后原明细行会被删掉，只有冻结快照还记得这是哪件货 */}
                  {frozenRecord.metadata?.productName != null && (
                    <div className="min-w-0">
                      商品 <span className="font-mono break-all">{String(frozenRecord.metadata.productName)}</span>
                    </div>
                  )}
                  <div>数量 <span className="font-mono">{frozenRecord.metadata?.qty == null ? '整份' : String(frozenRecord.metadata.qty)}</span></div>
                  {/* 移出冻结的是**某一行明细**，光有箱码定位不到是哪一行，恢复时对不上账 */}
                  {frozenRecord.metadata?.itemId != null && (
                    <div>明细 <span className="font-mono">#{String(frozenRecord.metadata.itemId)}</span></div>
                  )}
                </div>
              ) : (
                <p className="mt-1 text-xs text-warning-ink dark:text-warning-ink">
                  这条待确认记录的<strong>归属无法确认</strong>（关键字段缺失或与任务不一致），
                  因此不展示原内容，以免张冠李戴。已继续阻止重复提交：请人工核对实物后，
                  用「结果未生效，清除记录」显式清除，或先点「确认上次结果」再查一次。
                </p>
              )}
            </div>
          )}

  </>

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

  if (taskError) return <div className="min-h-screen bg-background"><PdaHeader title="打包作业" onBack={goSelectTask} /><div className="mx-auto max-w-md space-y-3 p-4">{recoveryNotice}<PdaQueryError onRetry={() => { void refetchTask() }} /></div></div>

  if (!taskDetail) {
    return (
      <PdaTaskState
        title="打包任务不存在"
        description={`未找到任务 #${taskId}，请确认任务是否已被删除或状态已变化。`}
        actionText="选择其他任务"
        onAction={goSelectTask}
        secondaryText="返回工作台"
        onSecondary={() => navigate('/pda')}
      />
    )
  }

  // 有未确认的原键记录时**不能**提前 return：「完成打包」后台成功、响应丢失后任务已经推进到 6，
  // 重挂时 `allDone`（本地 state）是 false、`taskDetail.status` 又不是 5 ⇒ 会直接落到这个分支，
  // 把「确认上次结果 / 原目标定位」整个藏掉 —— 那正是本页最需要用户看见的东西。
  if (!allDone && taskDetail.status !== WT_STATUS.PACKING && !noticePendingAction) {
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
      icon={<PartyPopper className="h-20 w-20 text-success-ink" />}
      title="打包完成！"
      description={`任务：${taskDetail.taskNo} · 共 ${totalBoxes} 箱，${formatQty(totalItems)} 件商品`}
      actionText="返回工作台"
      onAction={() => navigate('/pda')}
      secondaryText="继续打包"
      onSecondary={goSelectTask}
    >
      <PdaNextStep
        enabled={shipTaskId === taskId && taskDetail.id === taskId && !anySubmitBlocked && !onlineBlocked}
        required={[PERMISSIONS.WAREHOUSE_TASK_SHIP]}
        to="/pda/ship" label="去出库" hint="到出库页扫描物流码或箱码，再确认出库。"
      />
    </PdaDoneView>
  )

  return (
    <div className="flex min-h-screen flex-col bg-background">

      <PdaHeader
        title={taskDetail.taskNo}
        subtitle={taskDetail.customerName}
        onBack={goSelectTask}
        right={<span className="text-xs text-muted-foreground">{pkgError ? '箱子暂不可读取' : `${doneBoxes}/${totalBoxes} 箱`}</span>}
      />

      {/* Flash */}
      <PdaFlash flash={flash} />

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-md mx-auto px-4 py-4 space-y-3">
          {recoveryNotice}

          {/* 统计行 */}
          <PdaStatGrid cols={3}>
            <PdaStat label="箱子数" value={pkgError ? '—' : totalBoxes} />
            <PdaStat label="已完成" value={pkgError ? '—' : doneBoxes} accent />
            <PdaStat label="总件数" value={pkgError ? '—' : formatQty(totalItems)} />
          </PdaStatGrid>

          {/* 箱子列表 */}
          {pkgLoading && <PdaLoading className="h-24" />}
          {pkgError && <PdaQueryError onRetry={() => { void refetchPackages() }} />}
          {!pkgError && packages.map(pkg => (
            <PackageCard
              key={pkg.id}
              pkg={pkg}
              active={activePackageId === pkg.id}
              onActivate={() => {
                // 待确认期间冻结原目标：换箱会让「上次装箱到底装进哪只箱」失去可见的恢复入口
                if (anySubmitBlocked) { err(anyBlockedReason || '上次操作结果待确认，请先确认'); return }
                setActivePackageId(pkg.id)
              }}
              onFinish={() => {
                // 不能只靠按钮 disabled：handler 自身也要挡住，否则冻结状态被绕过
                if (anySubmitBlocked) { err(anyBlockedReason || '上次操作结果待确认，请先确认'); return }
                finishMut.mutate(pkg.id)
              }}
              finishing={finishMut.isPending || finishAction.submitBlocked || anySubmitBlocked || onlineBlocked}
              onPrintLabel={() => printLabelMut.mutate(pkg.id)}
              printingLabel={(printLabelMut.isPending && printLabelMut.variables === pkg.id) || printAction.submitBlocked || onlineBlocked}
              onRemoveItem={(itemId) => {
                // 待确认期间不得移出：会改变冻结记录对应的箱内状态
                if (anySubmitBlocked) { err(anyBlockedReason || '上次操作结果待确认，请先确认'); return }
                const item = (pkg.items ?? []).find(i => i.id === itemId)
                if (!item) { err('该明细已不存在，请刷新后重试'); return }
                void runRemoveItem(pkg, item)
              }}
              removingItemId={removeAction.phase === 'submitting' ? Number(removeAction.pendingRecord?.metadata?.itemId ?? 0) || null : null}
              onVoid={() => {
                if (anySubmitBlocked) { err(anyBlockedReason || '上次操作结果待确认，请先确认'); return }
                void runVoid(pkg)
              }}
              voiding={voidAction.phase === 'submitting' || anySubmitBlocked}
            />
          ))}
          {packages.length === 0 && !pkgLoading && !pkgError && (
            <div className="rounded-2xl border border-dashed border-border bg-muted/20 py-10 text-center">
              <p className="text-muted-foreground text-sm">点击下方「新建箱子」开始打包</p>
            </div>
          )}
          {!pkgError && !pkgLoading && totalBoxes > 0 && activeBoxes.every((pkg) => pkg.status === 2) ? (
            <>
              {/*
                箱贴未打印成功时，完成打包会被系统拒绝（出库前置：箱贴必须有打印成功记录）。
                这里把原因与出路直接摆出来，避免操作员只看到通用错误后反复无效重试。
              */}
              {unprintedBoxes.length > 0 && (
                <div className="rounded-2xl border border-warning/30 bg-warning/10 px-4 py-3 text-xs text-warning-ink space-y-1">
                  <p className="font-semibold">箱贴尚未打印完成，暂时不能进入待出库</p>
                  <p>
                    待处理箱：{unprintedBoxes.map(pkg => `${pkg.barcode}（${pkg.printStatus?.label ?? '未生成箱贴'}）`).join('、')}
                  </p>
                  <p className="text-warning-ink">
                    处理办法：点该箱的「打印箱贴」重新入队，或在 ERP「系统 → 条码打印查询 → 出库条码」重新打印；
                    若无出纸，请先启动绑定该打印机的极序 Flow 桌面端，客户端上线后会自动领取待派发任务。
                  </p>
                </div>
              )}
              <Button size="lg"
                type="button"
                className="px-3 w-full"
                onClick={() => {
                  if (anySubmitBlocked || finalizeAction.submitBlocked) {
                    err(anyBlockedReason || finalizeAction.blockedReason || '上次操作结果待确认，请先确认')
                    return
                  }
                  finalizeMut.mutate()
                }}
                disabled={finalizeMut.isPending || finalizeAction.submitBlocked || anySubmitBlocked}
              >
                {finalizeMut.isPending ? '处理中…' : '完成打包并进入待出库'}
              </Button>
            </>
          ) : null}
        </div>
      </div>

      <PdaBottomBar>
          {activePackageId && <PdaScanner onScan={handleScan} placeholder="扫描商品条码或取货标签" disabled={anySubmitBlocked || onlineBlocked || pkgLoading || pkgError} onDuplicate={() => err('重复扫码，请稍候')} />}
          <Button size="lg" variant={activePackageId ? 'outline' : 'default'} className="px-3 w-full" onClick={() => {
            if (anySubmitBlocked) { err(anyBlockedReason || '上次操作结果待确认，请先确认'); return }
            createMut.mutate()
          }} disabled={createMut.isPending || anySubmitBlocked || onlineBlocked || pkgLoading || pkgError}>
            {createMut.isPending ? '创建中…' : '＋ 新建箱子'}
          </Button>
      </PdaBottomBar>

    </div>
  )
}
