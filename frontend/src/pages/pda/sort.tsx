import PdaProductIdentity from '@/components/pda/PdaProductIdentity'
import PdaOverviewText from '@/components/pda/PdaOverviewText'
/**
 * PDA 分拣作业 — Put Wall
 * 路由：/pda/sort
 *
 * 无感操作：
 *  1. 扫商品码 → 自动显示目标分拣格
 *  2. 扫分拣格码 → 自动确认，无需点击按钮
 */
import { useState, useRef } from 'react'
import { ClipboardList } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { getSortingBinsApi, scanProductForSortApi } from '@/api/sorting-bins'
import type { SortingBin } from '@/api/sorting-bins'
import { getTaskByIdApi, sortDoneApi } from '@/api/warehouse-tasks'
import PdaHeader, { PdaRefreshButton } from '@/components/pda/PdaHeader'
import PdaCard from '@/components/pda/PdaCard'
import PdaBottomBar from '@/components/pda/PdaBottomBar'
import PdaScanner from '@/components/pda/PdaScanner'
import PdaFlash from '@/components/pda/PdaFlash'
import { PdaEmptyCard, PdaLoading, PdaQueryError } from '@/components/pda/PdaEmptyState'
import { usePdaFeedback } from '@/hooks/usePdaFeedback'
import { useCriticalPdaAction } from '@/hooks/useCriticalPdaAction'
import PdaCriticalActionNotice from '@/components/pda/PdaCriticalActionNotice'
import { WT_STATUS } from '@/constants/warehouseTaskStatus'
import { stateConfirmedMessage, taskReachedStatus } from '@/lib/pdaCriticalState'
import { formatPdaErrorMessage } from '@/utils/displayFormatters'
import PdaNextStep from '@/components/pda/PdaNextStep'
import { PERMISSIONS } from '@/lib/permission-codes'

type Step = 'scan-product' | 'confirm-bin'

interface BinHint {
  binCode: string
  productCode: string
  productName: string
  qty: number
  unit: string
  taskNo: string
  customerName: string
  taskId: number
  itemId: number
  /** 扫的是取货码（整件 I 码）时为 true —— 提交形态与服务端归属都不同 */
  isPickCode?: boolean
  containerId?: number
  /** 最初扫到的那个码（商品码或取货码）——冻结记录要能还原「原目标是哪个码」 */
  scannedCode?: string
}

export default function PdaSortPage() {
  const nav = useNavigate()
  const [step, setStep]     = useState<Step>('scan-product')
  const [hint, setHint]     = useState<BinHint | null>(null)
  const [scanning, setScanning] = useState(false)
  const [checkTask, setCheckTask] = useState<{ id: number; taskNo: string } | null>(null)
  const scanGeneration = useRef(0)
  const submittedSort = useRef<{
    requestKey: string
    metadata: Record<string, unknown>
    generation: number
    unverifiedOwner?: boolean
  } | null>(null)
  const { flash, ok, err, warn }  = usePdaFeedback()
  const sortAction = useCriticalPdaAction<{ allSorted: boolean; progress?: string; warning?: string | null }>({
    action: 'warehouse.sort',
    requestAction: 'warehouse.sort',
    label: '分拣确认',
    onConfirmed: async (data, ctx) => {
      // 只有「查回执」的恢复路径在这里提示；正常提交的提示由 handleBinScan 按任务真实状态给出，
      // 否则会双发。恢复也必须**按回执区分部分进度与整任务完成**——查到回执 ≠ 任务分拣完成。
      if (!ctx.recovered) return
      // run 的即时兜底仍使用提交前闭包（pendingRecord 可能为空），原提交定位另绑原键。
      // 不推进扫码代次，否则同一次 run 返回后的正常收尾也会被误当迟到结果。
      const submission = submittedSort.current?.requestKey === ctx.requestKey ? submittedSort.current : null
      const generation = submission?.generation ?? scanGeneration.current
      if (scanGeneration.current === generation) {
        setCheckTask(null)
        // 先执行既有恢复收尾；随后只读核对不能迟到清掉员工新扫出的提示。
        setStep('scan-product')
        setHint(null)
      }
      void refetch()
      if (data?.allSorted) {
        ok('分拣已成功，任务已进入待复核')
        // 只读交接使用本次原回执的冻结定位；当前 hint 可能属于另一任务。
        const record = sortAction.pendingRecord?.requestKey === ctx.requestKey ? sortAction.pendingRecord : submission
        const meta = record?.metadata
        const taskId = Number(meta?.taskId)
        const itemId = Number(meta?.itemId)
        const binCode = typeof meta?.binCode === 'string' ? meta.binCode.trim() : ''
        if (record && record.requestKey === ctx.requestKey && !record.unverifiedOwner && Number.isSafeInteger(taskId) && taskId > 0 && Number.isSafeInteger(itemId) && itemId > 0 && binCode) {
          try {
            const latest = await getTaskByIdApi(taskId, { skipGlobalError: true })
            if (scanGeneration.current === generation && latest.id === taskId && latest.status === WT_STATUS.CHECKING) setCheckTask(latest)
          } catch { /* 恢复提示保持；服务端读取失败时不给复核入口。 */ }
        }
      } else {
        warn(`本次分拣已确认（${data?.progress ?? '部分进度'}），任务尚未全部分拣完成，请继续扫其余商品`)
      }
    },
    resolveServerState: async ({ record }) => {
      // 只认**冻结记录**里的定位：页面重挂后 hint 已丢失，拿当前 hint 取数会张冠李戴。
      // 定位残缺或不合法的快照一律**不推断成功**——宁可让工人刷新核对，也不能凭半份记录
      // 就说「已完成」。兼容边界：本批之前写入的旧记录没有 itemId/binCode（甚至没有 metadata），
      // 一律按「无法核对」处理，落到人工核对分支，绝不当成功。
      const meta = record.metadata ?? {}
      const taskId = Number(meta.taskId)
      const itemId = Number(meta.itemId)
      const binCode = typeof meta.binCode === 'string' ? meta.binCode.trim() : ''
      if (!Number.isInteger(taskId) || taskId <= 0) return { effective: false }
      if (!Number.isInteger(itemId) || itemId <= 0) return { effective: false }
      if (!binCode) return { effective: false }
      const latest = await getTaskByIdApi(taskId, { skipGlobalError: true })
      if (taskReachedStatus(latest, WT_STATUS.CHECKING)) {
        return {
          effective: true,
          data: { allSorted: true },
          message: stateConfirmedMessage(`任务 ${latest.taskNo} 分拣`, latest.statusName),
        }
      }
      return { effective: false }
    },
  })

  const { data: bins, isLoading, isError, refetch } = useQuery({
    queryKey: ['sorting-bins-occupied'],
    queryFn: () => getSortingBinsApi().then(r => r ?? []),
    refetchInterval: 15_000,
  })

  async function handleProductScan(raw: string) {
    // 待确认期间冻结：不能再扫新的商品/取货码，否则会把「原目标」换掉、与冻结记录不一致
    if (sortAction.submitBlocked) { err(sortAction.blockedReason || '上次分拣结果待确认，请先确认后再扫商品'); return }
    if (sortAction.networkStatus !== 'online') { err('网络已断开，分拣作业已阻断，请恢复网络后再继续'); return }
    const code = raw.trim()
    if (!code) return
    scanGeneration.current += 1
    setCheckTask(null)
    setScanning(true)
    try {
      const res = await scanProductForSortApi(code)
      const result = res
      if (!result) { err('无拣货中订单，请核对条码'); return }
      if (!result.sortingBinCode) { err(`任务 ${result.taskNo} 待分配分拣格，请联系主管补分配，刷新后重新扫商品`); return }
      const isPickCode = Boolean(result.isPickCode)
      setHint({
        binCode: result.sortingBinCode, productCode: result.productCode, productName: result.productName,
        // 取货码的量是「这张取货码的有效取货量」；商品码路径只能报**未被取货标签覆盖**的
        // 剩余已拣量（sortableQty），否则会与标签份额重复计算
        qty: isPickCode ? Number(result.qty ?? 0) : Number(result.sortableQty ?? result.pickedQty ?? 0),
        unit: result.unit, taskNo: result.taskNo,
        customerName: result.customerName, taskId: result.taskId, itemId: result.itemId,
        isPickCode,
        containerId: isPickCode && result.containerId ? Number(result.containerId) : undefined,
        scannedCode: code,
      })
      setStep('confirm-bin')
    } catch { err('查询失败，请重试') }
    finally { setScanning(false) }
  }

  async function handleBinScan(raw: string) {
    if (sortAction.submitBlocked) { err(sortAction.blockedReason || '当前不可提交'); return }
    const code = raw.trim()
    if (!code || !hint) return
    if (code.toUpperCase() !== hint.binCode.toUpperCase()) {
      err(`放错格：请放 ${hint.binCode}`)
      return
    }
    const generation = scanGeneration.current
    setScanning(true)
    try {
      // 取货码走 `{ containerId, binCode }`，由服务端在同一事务内解析归属与份额；
      // 商品码保持原 `{ itemId, sortedQty }`。两条路都走同一个 sort-done，不新增平行接口。
      const items = hint.isPickCode && hint.containerId
        ? [{ containerId: hint.containerId, binCode: hint.binCode }]
        : [{ itemId: hint.itemId, sortedQty: hint.qty }]
      // 同一快照用于原持久记录与 mounted 提交定位；恢复不能读取当前 hint 猜原任务。
      const metadata = {
        taskId: hint.taskId,
        itemId: hint.itemId,
        containerId: hint.containerId ?? null,
        barcode: hint.scannedCode ?? null,
        binCode: hint.binCode,
        qty: hint.qty,
      }
      const submitted = await sortAction.run((requestKey) => {
        submittedSort.current = { requestKey, metadata, generation }
        return sortDoneApi(metadata.taskId, items, requestKey)
          .then((res) => res as { allSorted: boolean; progress?: string; warning?: string | null })
      }, metadata)
      if (submitted.kind === 'pending') {
        warn('网络中断，分拣结果待确认。请先确认结果，再决定是否重扫。')
        return
      }
      const result = submitted.data
      const latest = await getTaskByIdApi(metadata.taskId, { skipGlobalError: true })
      if (scanGeneration.current === generation && latest.id === metadata.taskId && latest.status === WT_STATUS.CHECKING) setCheckTask(latest)
      if (taskReachedStatus(latest, WT_STATUS.CHECKING)) {
        ok(stateConfirmedMessage(`任务 ${latest.taskNo} 分拣`, latest.statusName))
      } else if (result?.allSorted) {
        warn(`分拣请求已返回完成，但系统里的任务状态仍为「${latest.statusName ?? latest.status}」。请稍后刷新确认，暂勿重复扫码。`)
      } else if (result?.warning) {
        warn(`✓ 已放入 ${hint.binCode}（${result?.progress ?? '?'}）· ${result.warning}`)
      } else {
        ok(`✓ 已放入 ${hint.binCode}（${result?.progress ?? '?'}）`)
      }
    } catch (error: unknown) {
      err(formatPdaErrorMessage((error as { message?: string })?.message, '分拣失败，请刷新任务后重试'))
    }
    finally { if (scanGeneration.current === generation) setScanning(false) }
    if (scanGeneration.current === generation) {
      setStep('scan-product')
      setHint(null)
    }
  }

  const occupiedBins = (bins ?? []).filter(b => b.status === 2)
  const freeBins     = (bins ?? []).filter(b => b.status === 1)

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <PdaHeader title="分拣作业" subtitle="Put Wall"
        onBack={() => nav('/pda')}
        right={<PdaRefreshButton onRefresh={() => refetch()} />}
      />

      <div className="max-w-md mx-auto flex-1 px-4 pb-8 space-y-4 py-4 w-full">
        <PdaFlash flash={flash} />
        <PdaCriticalActionNotice
          blockedReason={sortAction.blockedReason}
          pendingRecord={sortAction.pendingRecord}
          confirming={sortAction.confirming}
          phase={sortAction.phase}
          phaseMessage={sortAction.phaseMessage}
          lastErrorMessage={sortAction.lastErrorMessage}
          onConfirm={() => {
            void sortAction.confirmPending().then((status) => {
              if (!status) return
              if (status.status === 'pending') warn(formatPdaErrorMessage(status.message, '系统还未确认结果，请稍后再查'))
              if (status.status === 'state_unconfirmed') warn(formatPdaErrorMessage(status.message, '任务状态还未确认，请稍后再查'))
              if (status.status === 'not_found') warn(formatPdaErrorMessage(status.message, '未找到上次分拣确认记录；请先刷新任务状态后再决定是否重扫'))
              if (status.status === 'failed') err(formatPdaErrorMessage(status.message, '分拣失败，请刷新任务后重试'))
            })
          }}
          onClear={() => sortAction.clearPending()}
          onDismissError={() => sortAction.clearError()}
        />

        {checkTask && <PdaCard>
          <p className="font-mono text-sm font-semibold text-foreground mb-3">任务 {checkTask.taskNo} 已进入待复核</p>
          <PdaNextStep
            enabled={!scanning && !sortAction.submitBlocked && sortAction.networkStatus === 'online'}
            required={[PERMISSIONS.WAREHOUSE_TASK_VIEW, PERMISSIONS.WAREHOUSE_TASK_CHECK]}
            to={`/pda/check/${checkTask.id}`} label="去复核" hint="也可留在本页继续扫描其他商品。"
          />
        </PdaCard>}

        {/* 待确认期间的**原提交定位**：取自冻结记录而非当前 hint——页面重挂后 hint 已为 null，
            只有这份记录还能说明「上次提交的是哪一件」，并据此核对恢复结果。 */}
        {sortAction.pendingRecord && (
          <PdaCard>
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">上次分拣提交（结果待确认）</p>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><p className="text-xs text-muted-foreground">任务</p><p className="font-mono text-xs">{String(sortAction.pendingRecord.metadata?.taskId ?? '—')}</p></div>
                <div><p className="text-xs text-muted-foreground">分拣格</p><p className="font-mono text-xs">{String(sortAction.pendingRecord.metadata?.binCode ?? '—')}</p></div>
                <div className="min-w-0"><p className="text-xs text-muted-foreground">条码</p><p className="font-mono text-xs min-w-0 whitespace-normal [overflow-wrap:anywhere]">{String(sortAction.pendingRecord.metadata?.barcode ?? '—')}</p></div>
                <div><p className="text-xs text-muted-foreground">数量</p><p className="font-bold text-primary">{String(sortAction.pendingRecord.metadata?.qty ?? '—')}</p></div>
              </div>
            </div>
          </PdaCard>
        )}

        {/* 步骤进度 */}
        <div className="flex items-center gap-3">
          <div className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${
            step==='scan-product' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
          }`}>1</div>
          <p className={`text-sm ${step==='scan-product' ? 'font-semibold text-foreground' : 'text-muted-foreground'}`}>扫产品条码</p>
          <div className="flex-1 h-px bg-border" />
          <div className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${
            step==='confirm-bin' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
          }`}>2</div>
          <p className={`text-sm ${step==='confirm-bin' ? 'font-semibold text-foreground' : 'text-muted-foreground'}`}>扫分拣格确认</p>
        </div>

        {/* 分拣提示卡 */}
        {hint && step==='confirm-bin' && (
          <PdaCard>
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">请将以下商品放入指定分拣格</p>
              <div className="rounded-xl bg-primary/5 border border-primary/20 p-4 text-center">
                <p className="font-mono text-4xl font-black text-primary [overflow-wrap:anywhere]">{hint.binCode}</p>
                <p className="text-xs text-muted-foreground mt-1">分拣格编号</p>
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="min-w-0"><p className="text-xs text-muted-foreground">商品</p><PdaProductIdentity code={hint.productCode} name={hint.productName} view="detail" /></div>
                <div><p className="text-xs text-muted-foreground">数量</p><p className="font-bold text-primary">{hint.qty} {hint.unit}</p></div>
                <div><p className="text-xs text-muted-foreground">任务号</p><p className="font-mono text-xs min-w-0 whitespace-normal [overflow-wrap:anywhere]">{hint.taskNo}</p></div>
                <div><p className="text-xs text-muted-foreground">客户</p><p className="text-xs min-w-0 whitespace-normal [overflow-wrap:anywhere]">{hint.customerName}</p></div>
              </div>
              <button className="min-h-11 rounded-md text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
                disabled={sortAction.submitBlocked}
                onClick={() => {
                  // 待确认期间冻结原目标：这时清掉提示会让工人误以为可以换一件重扫
                  if (sortAction.submitBlocked) { err(sortAction.blockedReason || '上次分拣结果待确认，请先确认后再继续'); return }
                  setStep('scan-product'); setHint(null)
                }}
              >← 取消，重新扫商品</button>
            </div>
          </PdaCard>
        )}

        {/* 分拣格状态总览 */}
        {isLoading && <PdaLoading className="h-24" />}
        {isError && <PdaQueryError onRetry={() => { void refetch() }} />}
        {!isLoading && !isError && (
          <>
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">分拣格状态</p>
              <div className="flex gap-3 text-xs">
                <span className="text-success-ink">空闲 {freeBins.length}</span>
                <span className="text-warning-ink">占用 {occupiedBins.length}</span>
              </div>
            </div>
            {(bins ?? []).length === 0 && (
              <PdaEmptyCard icon={<ClipboardList className="h-12 w-12 text-muted-foreground" />} title="暂无分拣格" description="请在仓库管理后台创建分拣格" />
            )}
            <div className="grid grid-cols-3 gap-2">
              {(bins ?? []).map((bin: SortingBin) => (
                <div key={bin.id} className={`min-w-0 rounded-xl border p-3 text-center ${
                  bin.status===2 ? 'border-warning/30 bg-warning/10' : 'border-border bg-card'
                }`}>
                  <p className={`font-mono text-lg font-black [overflow-wrap:anywhere] ${
                    bin.status===2 ? 'text-warning-ink' : 'text-muted-foreground'
                  }`}>{bin.code}</p>
                  <PdaOverviewText className="mt-0.5">
                    {bin.status===2 ? (bin.customerName ?? bin.currentTaskNo ?? '占用中') : '空闲'}
                  </PdaOverviewText>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
      <PdaBottomBar>
        <PdaScanner
          onScan={(code) => { if (step === 'scan-product') void handleProductScan(code); else void handleBinScan(code) }}
          placeholder={step === 'scan-product' ? '扫描商品条码' : '扫描分拣格条码'}
          disabled={scanning || sortAction.submitBlocked || isError}
          busy={scanning}
          onDuplicate={() => err('重复扫码，请稍候')}
        />
      </PdaBottomBar>
    </div>
  )
}
