/**
 * PDA 打包作业
 * 路由：/pda/pack
 */
import { useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { parseBarcode } from '@/utils/barcode'
import PdaScanner from '@/components/pda/PdaScanner'
import PdaHeader from '@/components/pda/PdaHeader'
import PdaCard from '@/components/pda/PdaCard'
import PdaBottomBar from '@/components/pda/PdaBottomBar'
import PdaFlash from '@/components/pda/PdaFlash'
import { PdaEmptyCard, PdaLoading } from '@/components/pda/PdaEmptyState'
import PdaStat, { PdaStatGrid } from '@/components/pda/PdaStat'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { getTasksApi, packDoneApi } from '@/api/warehouse-tasks'
import { WT_STATUS } from '@/constants/warehouseTaskStatus'
import { getPackagesApi, createPackageApi, addPackageItemApi, finishPackageApi, printPackageLabelApi } from '@/api/packages'
import type { Package } from '@/api/packages'
import type { WarehouseTask } from '@/api/warehouse-tasks'
import { usePdaFeedback } from '@/hooks/usePdaFeedback'
import {
  isDesktopLocalPrintError,
  tryDesktopLocalZplThenComplete,
} from '@/lib/desktopLocalPrint'

function TaskSelectStep({ onSelect }: { onSelect: (t: WarehouseTask) => void }) {
  const navigate = useNavigate()
  const { data, isLoading } = useQuery({
    queryKey: ['pda-pack-tasks'],
    queryFn: () => getTasksApi({ status: WT_STATUS.PACKING, pageSize: 50 }).then(r => r.data.data!),
  })
  const tasks = data?.list ?? []
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <PdaHeader title="选择打包任务" onBack={() => navigate('/pda')} right={<span className="text-xs text-muted-foreground">{tasks.length} 个待打包</span>} />
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-md mx-auto px-4 py-4 space-y-3">
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
  const qc       = useQueryClient()
  const { flash, ok, err } = usePdaFeedback()

  const [task, setTask]                       = useState<WarehouseTask | null>(null)
  const [activePackageId, setActivePackageId] = useState<number | null>(null)
  const [pendingCode, setPendingCode]         = useState<string | null>(null)
  const [pendingQty, setPendingQty]           = useState<number>(1)
  const [allDone, setAllDone]                 = useState(false)

  const taskId = task?.id ?? 0

  const { data: packages = [], isLoading: pkgLoading } = useQuery({
    queryKey: ['pda-packages', taskId],
    queryFn:  () => getPackagesApi(taskId).then(r => r.data.data!),
    enabled:  taskId > 0,
    onSuccess: (pkgs) => {
      if (!activePackageId) {
        const open = pkgs.find(p => p.status === 1)
        if (open) setActivePackageId(open.id)
      }
    },
  })

  const refetch = () => qc.invalidateQueries({ queryKey: ['pda-packages', taskId] })

  const createMut = useMutation({
    mutationFn: () => createPackageApi(taskId),
    onSuccess: (res) => {
      const pkg = res.data.data!
      ok(`已创建箱子 ${pkg.barcode}`)
      setActivePackageId(pkg.id)
      refetch()
    },
    onError: (e: unknown) => err((e as {response?:{data?:{message?:string}}})?.response?.data?.message ?? '创建失败'),
  })

  const addMut = useMutation({
    mutationFn: ({ code, qty }: { code: string; qty: number }) => addPackageItemApi(activePackageId!, code, qty),
    onSuccess: (res) => {
      const item = res.data.data!
      ok(`✓ ${item.productName} × ${item.qty} ${item.unit} 已装箱`)
      setPendingCode(null)
      setPendingQty(1)
      refetch()
    },
    onError: (e: unknown) => err((e as {response?:{data?:{message?:string}}})?.response?.data?.message ?? '添加失败'),
  })

  const printLabelMut = useMutation({
    mutationFn: (pkgId: number) => printPackageLabelApi(pkgId).then(r => r.data.data!),
    onSuccess: async (d) => {
      if (d.queued && d.job && typeof d.job === 'object') {
        const job = d.job as {
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
          ok('箱贴已从本机打印')
          return
        }
        if (isDesktopLocalPrintError(local)) {
          err(local.error)
          return
        }
      }
      if (d.queued) ok('箱贴已加入打印队列')
      else ok('未配置标签机，未创建打印任务')
    },
    onError: (e: unknown) => err((e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? '打印失败'),
  })

  const finishMut = useMutation({
    mutationFn: (pkgId: number) => finishPackageApi(pkgId),
    onSuccess: (res) => {
      ok('此箱已完成！')
      setActivePackageId(null)
      setPendingCode(null)
      refetch()
      // 后端自动判断是否全部打包完成（autoPacked=true 表示已推进到待出库）
      if (res.data.data?.autoPacked) {
        setAllDone(true)
      }
    },
    onError: (e: unknown) => err((e as {response?:{data?:{message?:string}}})?.response?.data?.message ?? '操作失败'),
  })

  const handleScan = useCallback((raw: string) => {
    if (!activePackageId) { err('请先创建或选择一个箱子'); return }
    const parsed = parseBarcode(raw)
    if (parsed.type !== 'product' && parsed.type !== 'unknown') { err('请扫描商品条码（PRDxxxxxx 或 SKU 编码）'); return }
    // 扫码即直接装箱（默认数量 1），无需额外确认
    addMut.mutate({ code: raw, qty: 1 })
  }, [activePackageId, err, addMut])

  const totalBoxes = packages.length
  const doneBoxes  = packages.filter(p => p.status === 2).length
  const totalItems = packages.reduce((s, p) => s + p.items.reduce((ss, i) => ss + i.qty, 0), 0)
  // ── 任务未选 ────────────────────────────────────────────────────────────
  if (!task) return <TaskSelectStep onSelect={t => { setTask(t); setActivePackageId(null) }} />

  // ── 全部完成页 ────────────────────────────────────────────────────────────
  if (allDone) return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-6 text-center">
      <div className="text-6xl mb-6">🎉</div>
      <h2 className="text-2xl font-bold text-foreground">打包完成！</h2>
      <p className="text-muted-foreground mt-2 mb-1">任务：<span className="font-mono font-semibold text-foreground">{task.taskNo}</span></p>
      <p className="text-muted-foreground mb-8">共 {totalBoxes} 箱，{totalItems.toFixed(0)} 件商品</p>
      <div className="flex gap-3 w-full max-w-xs">
        <Button variant="outline" className="flex-1" onClick={() => { setTask(null); setAllDone(false) }}>继续打包</Button>
        <Button className="flex-1" onClick={() => navigate('/pda')}>返回工作台</Button>
      </div>
    </div>
  )

  return (
    <div className="flex min-h-screen flex-col bg-background">

      <PdaHeader
        title={task.taskNo}
        subtitle={task.customerName}
        onBack={() => setTask(null)}
        right={<span className="text-xs text-muted-foreground">{doneBoxes}/{totalBoxes} 箱</span>}
      />

      {/* Flash */}
      <PdaFlash flash={flash} />

      <div className="flex-1 overflow-y-auto pb-64">
        <div className="max-w-md mx-auto px-4 py-4 space-y-3">

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
              finishing={finishMut.isPending}
              onPrintLabel={() => printLabelMut.mutate(pkg.id)}
              printingLabel={printLabelMut.isPending && printLabelMut.variables === pkg.id}
            />
          ))}
          {packages.length === 0 && !pkgLoading && (
            <div className="rounded-2xl border border-dashed border-border bg-muted/20 py-10 text-center">
              <p className="text-muted-foreground text-sm">点击下方「新建箱子」开始打包</p>
            </div>
          )}
        </div>
      </div>

      <PdaBottomBar>
          {activePackageId && <PdaScanner onScan={handleScan} placeholder="扫描商品条码 PRDxxxxxx" disabled={addMut.isPending} />}
          <Button variant={activePackageId ? 'outline' : 'default'} className="w-full" onClick={() => createMut.mutate()} disabled={createMut.isPending}>
            {createMut.isPending ? '创建中…' : '＋ 新建箱子'}
          </Button>
      </PdaBottomBar>

    </div>
  )
}
