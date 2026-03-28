/**
 * 收货订单详情 — 收货 / 上架 / 容器列表
 * 路由：/inbound-tasks/:id（多标签）
 */
import { useContext, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import PageHeader from '@/components/shared/PageHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { TabPathContext } from '@/components/layout/TabPathContext'
import { useWorkspaceStore } from '@/store/workspaceStore'
import { toast } from '@/lib/toast'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import {
  useInboundTaskDetail,
  useInboundTaskContainers,
  useReceiveInbound,
  useCancelInbound,
} from '@/hooks/useInboundTasks'
import {
  INBOUND_STATUS_LABEL,
  INBOUND_STATUS_VARIANT,
  type InboundContainerRow,
  type InboundTaskItem,
} from '@/types/inbound-tasks'

function skuRemainToReceive(items: InboundTaskItem[] | undefined, productId: number): number {
  if (!items?.length) return 0
  return items
    .filter(i => i.productId === productId)
    .reduce((s, i) => s + Math.max(0, i.orderedQty - i.receivedQty), 0)
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card-base p-5 space-y-4">
      <h3 className="text-section-title pb-2 border-b border-border/50">{title}</h3>
      {children}
    </div>
  )
}

export default function InboundTaskDetailPage() {
  const tabPath = useContext(TabPathContext)
  const navigate = useNavigate()
  const taskId = Number((tabPath || '').split('/').pop())
  const validId = Number.isFinite(taskId) && taskId > 0 ? taskId : null

  const { data: task, isLoading, refetch: refetchTask } = useInboundTaskDetail(validId)
  const { data: containers, refetch: refetchContainers } = useInboundTaskContainers(validId)

  const receiveMut = useReceiveInbound()
  const cancelMut = useCancelInbound()

  const [lineQty, setLineQty] = useState<Record<number, string>>({})
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false)

  function closeTab() {
    const { removeTab, tabs } = useWorkspaceStore.getState()
    const nextKey = removeTab(tabPath || '/inbound-tasks')
    const nextTab = tabs.find(t => t.key === nextKey)
    navigate(nextTab?.path ?? '/inbound-tasks')
  }

  async function afterMutation() {
    await refetchTask()
    await refetchContainers()
  }

  function submitOnePackage(it: InboundTaskItem) {
    if (!validId || !task) return
    const raw = lineQty[it.id]?.trim()
    if (!raw) {
      toast.error('请填写本包数量')
      return
    }
    const q = Number(raw.replace(/,/g, '.'))
    if (!Number.isFinite(q) || q <= 0) {
      toast.error(`数量无效：${it.productName}`)
      return
    }
    const remainSku = skuRemainToReceive(task.items, it.productId)
    if (q > remainSku) {
      toast.error(`${it.productName} 超出待收（该 SKU 最多还可收 ${remainSku}）`)
      return
    }
    receiveMut.mutate(
      { id: validId, data: { productId: it.productId, qty: q } },
      {
        onSuccess: async (data) => {
          const pj = data.printJobId ? '，已排队打印标签' : '（未配置 INBOUND_LABEL_PRINTER_CODE 则未打印）'
          toast.success(`本包容器 ${data.containerCode}${pj}`)
          setLineQty(p => ({ ...p, [it.id]: '' }))
          await afterMutation()
        },
        onError: (err: unknown) => {
          const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? '收货失败'
          toast.error(msg)
        },
      },
    )
  }

  if (!validId) {
    return <p className="text-sm text-muted-foreground p-6">无效的任务路径</p>
  }

  if (isLoading || !task) {
    return <p className="text-sm text-muted-foreground p-6">加载中…</p>
  }

  const canReceive = task.status === 1 || task.status === 2
  const canPutaway = task.status === 2 || task.status === 3
  const canCancel = task.status === 1

  return (
    <div className="space-y-5">
      <PageHeader
        title={`收货订单 ${task.taskNo}`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge variant={INBOUND_STATUS_VARIANT[task.status]}>{INBOUND_STATUS_LABEL[task.status]}</Badge>
            <span className="text-muted-foreground">采购单 {task.purchaseOrderNo ?? '—'}</span>
          </span>
        }
        actions={
          <div className="flex gap-2 flex-wrap">
            {canCancel && (
              <Button
                variant="destructive"
                size="sm"
                disabled={cancelMut.isPending}
                onClick={() => setCancelConfirmOpen(true)}
              >
                取消任务
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={closeTab}>关闭</Button>
          </div>
        }
      />

      <Section title="任务明细（应到 / 已收 / 已上架）">
        {canReceive && (
          <p className="text-xs text-muted-foreground">
            逐包收货：每行填写「本包数量」后点「提交本包」，每次生成一个待上架容器并尝试打印条码；不可一次提交多行合并数量。
          </p>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-xs text-muted-foreground">
                <th className="text-left py-2">商品</th>
                <th className="text-right py-2 w-24">应到</th>
                <th className="text-right py-2 w-24">已收</th>
                <th className="text-right py-2 w-20">本行剩余</th>
                <th className="text-right py-2 w-24">已上架</th>
                {canReceive && <th className="text-right py-2 min-w-[200px]">本包收货</th>}
              </tr>
            </thead>
            <tbody className="divide-y">
              {(task.items ?? []).map((it: InboundTaskItem) => {
                const lineRemain = Math.max(0, it.orderedQty - it.receivedQty)
                const skuRemain = skuRemainToReceive(task.items, it.productId)
                return (
                  <tr key={it.id}>
                    <td className="py-2">
                      <div className="font-medium">{it.productName}</div>
                      <div className="text-xs font-mono text-muted-foreground">{it.productCode}</div>
                    </td>
                    <td className="text-right">{it.orderedQty}</td>
                    <td className="text-right">{it.receivedQty}</td>
                    <td className="text-right text-muted-foreground">{lineRemain}</td>
                    <td className="text-right">{it.putawayQty}</td>
                    {canReceive && (
                      <td className="py-2 text-right">
                        <div className="flex flex-col items-end gap-1 sm:flex-row sm:justify-end sm:items-center">
                          <span className="text-[10px] text-muted-foreground whitespace-nowrap sm:mr-1">
                            SKU 还可收 {skuRemain}
                          </span>
                          <Input
                            className="h-8 w-24 text-right"
                            placeholder="本包"
                            value={lineQty[it.id] ?? ''}
                            onChange={e => setLineQty(p => ({ ...p, [it.id]: e.target.value }))}
                            disabled={skuRemain <= 0 || receiveMut.isPending}
                          />
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            disabled={skuRemain <= 0 || receiveMut.isPending}
                            onClick={() => submitOnePackage(it)}
                          >
                            提交本包
                          </Button>
                        </div>
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Section>

      {canPutaway && (
        <Section title="待上架容器">
          <div className="rounded-lg border border-sky-500/35 bg-sky-500/[0.08] px-4 py-3 text-sm space-y-1.5">
            <p className="font-medium text-sky-950 dark:text-sky-100">请使用 PDA 扫码完成上架</p>
            <p className="text-muted-foreground">
              在 PDA「上架作业」进入本任务，依次扫描容器条码（CNT）与库位条码（LOC）。电脑端仅可查看待上架列表，无法在此提交上架。
            </p>
          </div>

          {!containers?.waiting?.length ? (
            <p className="text-sm text-muted-foreground pt-1">暂无待上架容器</p>
          ) : (
            <div className="overflow-x-auto pt-2">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-xs text-muted-foreground">
                    <th className="text-left py-2 pr-2">容器条码</th>
                    <th className="text-left py-2">商品</th>
                    <th className="text-right py-2 w-24">数量</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {containers.waiting.map((c: InboundContainerRow) => (
                    <tr key={c.id}>
                      <td className="py-2.5 font-mono text-xs whitespace-nowrap">{c.barcode}</td>
                      <td className="py-2.5">
                        <span className="font-medium">{c.productName ?? '—'}</span>
                        {c.productCode && (
                          <span className="block text-xs text-muted-foreground font-mono">{c.productCode}</span>
                        )}
                      </td>
                      <td className="py-2.5 text-right tabular-nums">
                        {c.qty}{c.unit ? ` ${c.unit}` : ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      )}

      <Section title="容器：已上架">
        {!containers?.stored?.length ? (
          <p className="text-sm text-muted-foreground">暂无</p>
        ) : (
          <ul className="text-sm space-y-2">
            {containers.stored.map(c => (
              <li key={c.id} className="flex flex-wrap justify-between gap-2 border rounded-lg px-3 py-2">
                <span className="font-mono">{c.barcode}</span>
                <span>{c.productName} × {c.qty}</span>
                <span className="text-muted-foreground">{c.locationCode ?? '—'}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <ConfirmDialog
        open={cancelConfirmOpen}
        title="取消收货订单"
        description="确定取消该收货订单？取消后需重新创建收货订单才能继续收货。"
        variant="destructive"
        confirmText="确定取消"
        loading={cancelMut.isPending}
        onConfirm={() => {
          if (!validId) return
          cancelMut.mutate(validId, {
            onSuccess: () => {
              setCancelConfirmOpen(false)
              toast.success('已取消')
              closeTab()
            },
            onError: () => toast.error('取消失败'),
          })
        }}
        onCancel={() => setCancelConfirmOpen(false)}
      />
    </div>
  )
}
