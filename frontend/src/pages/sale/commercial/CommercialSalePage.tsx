import { ReturnSourceButton } from '@/pages/returns/ReturnSourceButton'
import { ReorderSourceButton } from '../ReorderSourceButton'
import { useSaleReorderSource } from '@/hooks/useSaleReorderSource'
import { useRepeatSaleCreate } from '@/hooks/useRepeatSaleCreate'
import { commercialWarehouseName } from './warehouseName'
import { useEffect, useRef, useState } from 'react'
import type { SaleOrder } from '@/types/sale'
import type { CommercialAction, CommercialOperation, CommercialWriteConfirmation } from '@/types/sale-commercial'
import type { KitReadOwner } from '@/api/kits'
import { useCommercialWrite, readCommercialSaleOwned } from '@/hooks/useCommercialSale'
import { assertKitReadOwner, captureKitReadOwner, useKitBackup } from '@/hooks/useKits'
import { usePermission } from '@/hooks/usePermission'
import { useDirtyGuard } from '@/hooks/useDirtyGuard'
import { useWorkspaceTabTitle } from '@/hooks/useWorkspaceTabTitle'
import { PERMISSIONS } from '@/lib/permission-codes'
import { money } from '@/lib/format'
import { getSaleWorkflowStatus } from '@/lib/saleWorkflowStatus'
import { WT_STATUS_NAME } from '@/generated/status'
import { toast } from '@/lib/toast'
import { ActionBar } from '@/components/shared/ActionBar'
import { Button } from '@/components/ui/button'
import { SectionCard } from '@/components/shared/SectionCard'
import { SoftStatusLabel } from '@/components/shared/StatusBadge'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import CommercialFulfillmentSummary from './CommercialFulfillmentSummary'
import { formatDisplayDateTime } from '@/lib/dateTime'
import { PrintPreviewOverlay } from '@/components/print/SaleOrderPrintTemplate'
import { FulfillmentProgressCard } from '../form/components/FulfillmentProgressCard'
import { SaleOrderOverview } from '../form/components/SaleOrderOverview'
import { readSaleHandoff } from '../form/handoff'
import CommercialEditor from './CommercialEditor'
import CommercialShipDialog from './CommercialShipDialog'
import { buildWorkspaceTabRegistrationFromPath } from '@/router/workspaceRouteMeta'
const permission = {
  ship: PERMISSIONS.SALE_ORDER_SHIP,
  cancel: PERMISSIONS.SALE_ORDER_CANCEL,
  reserve: PERMISSIONS.SALE_ORDER_RESERVE,
  release: PERMISSIONS.SALE_ORDER_RELEASE,
  delete: PERMISSIONS.SALE_ORDER_DELETE
}
export function NewCommercialSale({ tabPath, onDone, sourceId }: { tabPath: string; onDone: (id?: number) => void; sourceId?: number }) {
  const [owner] = useState(captureKitReadOwner)
  if (sourceId) return <RepeatCommercialCreate sourceId={sourceId} tabPath={tabPath} onDone={onDone} />
  return <CommercialEditor owner={owner} tabPath={tabPath} onDone={onDone} />
}
function RepeatCommercialCreate({ sourceId, tabPath, onDone }: { sourceId: number; tabPath: string; onDone: (id?: number) => void }) {
  const source = useSaleReorderSource(sourceId, 'kit-v1')
  const write = useRepeatSaleCreate(sourceId, 'kit-v1', source.owner, buildWorkspaceTabRegistrationFromPath(tabPath).key)
  return <CommercialEditor owner={source.owner} tabPath={tabPath} onDone={onDone} reorder={{ source, write }} />
}
export default function CommercialSalePage({
  initial,
  owner,
  tabPath,
  onClose
}: {
  initial: SaleOrder
  owner: KitReadOwner
  tabPath: string
  onClose: () => void
}) {
  const [order, setOrder] = useState(initial),
    [editor, setEditor] = useState<{ baseline: SaleOrder; adjust: boolean } | null>(null),
    [editorGeneration, setEditorGeneration] = useState(0),
    [shipQuantities, setShipQuantities] = useState<Record<number, string>>({}),
    [shipOpen, setShipOpen] = useState(false),
    [printOpen, setPrintOpen] = useState(false),
    [confirm, setConfirm] = useState<Exclude<CommercialAction, 'create' | 'update' | 'adjust' | 'ship'> | null>(null),
    [error, setError] = useState(''),
    [reloading, setReloading] = useState(false)
  const { can } = usePermission(),
    write = useCommercialWrite(owner, `commercial-detail:${buildWorkspaceTabRegistrationFromPath(tabPath).key}`),
    mounted = useRef(true),
    readGeneration = useRef(0)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  useEffect(() => {
    if (write.pending && !write.busy) {
      setConfirm(null)
      setShipOpen(false)
    }
  }, [write.pending, write.busy])
  useWorkspaceTabTitle(order.orderNo)
  let ownerCurrent = true
  try {
    assertKitReadOwner(owner)
  } catch {
    ownerCurrent = false
  }
  const locked = write.blocked || reloading || !ownerCurrent
  useDirtyGuard(tabPath, locked)
  const backup = useKitBackup(JSON.stringify({ order, owner, shipQuantities, confirm }), owner)
  const handoff = readSaleHandoff(tabPath, order.id)
  async function reload(requireBackup = false, confirmation?: CommercialWriteConfirmation) {
    const confirmedHere = () =>
      !!confirmation &&
      confirmation.plan.operation.id === order.id &&
      confirmation.plan.operation.action !== 'delete' &&
      write.canApplyConfirmation(confirmation)
    if ((confirmation ? !confirmedHere() : locked) || (requireBackup && !backup.canReload())) return
    const generation = ++readGeneration.current
    setReloading(true)
    try {
      const next = await readCommercialSaleOwned(order.id, owner)
      if (
        !mounted.current ||
        generation !== readGeneration.current ||
        (confirmation && !confirmedHere()) ||
        (requireBackup && !backup.canReload())
      )
        return
      assertKitReadOwner(owner)
      setOrder(next)
      setShipQuantities({})
      setShipOpen(false)
      setConfirm(null)
      backup.invalidate()
    } catch (e) {
      if (mounted.current) setError(e instanceof Error ? e.message : '重读失败，原单保留')
    } finally {
      if (mounted.current) setReloading(false)
    }
  }
  async function operation(op: CommercialOperation) {
    setError('')
    const result = await write.submit(op)
    if (result && write.canApplyConfirmation(result)) {
      setConfirm(null)
      setShipOpen(false)
      backup.invalidate()
      if (op.action === 'delete') onClose()
      else {
        toast.success('原单操作已提交，请核对最新状态与仓库归还进度')
        await reload(false, result)
      }
    }
  }
  function marker() {
    return { commercialModel: 'kit-v1' as const, expectedRevision: order.commercialRevision! }
  }
  if (editor)
    return (
      <CommercialEditor
        key={editorGeneration}
        order={editor.baseline}
        owner={owner}
        tabPath={tabPath}
        adjust={editor.adjust}
        onDone={() => {
          setEditor(null)
          void reload()
        }}
        onReload={(next) => {
          setOrder(next)
          setEditor({ baseline: next, adjust: editor.adjust })
          setEditorGeneration((g) => g + 1)
        }}
      />
    )
  const workflow = getSaleWorkflowStatus(order),
    returning =
      !!order.warehouseTaskCancelRequestedAt ||
      !!order.warehouseTaskAdjustmentRequestedAt ||
      !!order.tasks?.some((t) => t.cancelRequestedAt || t.adjustmentRequestedAt)
  const confirmed = order.commercialGroups?.some((g) => (g.dispatch?.confirmedShippedQty ?? 0) > 0)
  const canAdjust =
    [2, 3, 6].includes(order.status) &&
    !returning &&
    !order.executionAdjustmentBlocked &&
    !order.isMultiWarehouse &&
    !confirmed
  return (
    <div className="space-y-3">
      <ActionBar
        title={order.orderNo}
        subtitle={<SoftStatusLabel label={workflow.label} tone={workflow.tone} />}
        rightActions={
          <>
            <ReturnSourceButton kind="sale" sourceId={order.id} sourceNo={order.orderNo} disabled={locked} />
            <ReorderSourceButton sourceId={order.id} model="kit-v1" disabled={locked} />
            <Button variant="outline" disabled={locked || shipOpen || !!confirm} onClick={() => void reload()}>
              读取最新订单
            </Button>
            <Button variant="outline" disabled={!ownerCurrent} onClick={() => setPrintOpen(true)}>
              客户打印
            </Button>
            {can(PERMISSIONS.SALE_ORDER_UPDATE) && (order.status === 1 || canAdjust) && (
              <Button
                variant="outline"
                disabled={locked || returning}
                onClick={() => setEditor({ baseline: order, adjust: order.status !== 1 })}
              >
                {order.status === 1 ? '编辑订单' : '修改订单'}
              </Button>
            )}
            {can(permission.reserve) && [1, 6].includes(order.status) && (
              <Button disabled={locked || returning} onClick={() => setConfirm('reserve')}>
                整单占库
              </Button>
            )}
            {can(permission.release) && [2, 6].includes(order.status) && (
              <Button variant="outline" disabled={locked || returning} onClick={() => setConfirm('release')}>
                释放占库
              </Button>
            )}
            {can(permission.ship) && [2, 3, 6].includes(order.status) && (
              <Button disabled={locked || returning} onClick={() => setShipOpen(true)}>
                安排本次发货
              </Button>
            )}
            {can(permission.cancel) && [1, 2, 3, 6].includes(order.status) && (
              <Button variant="outline" disabled={locked || returning} onClick={() => setConfirm('cancel')}>
                {confirmed ? '关闭剩余未发' : '取消订单'}
              </Button>
            )}
            {can(permission.delete) && order.status === 5 && (
              <Button variant="outline" disabled={locked} onClick={() => setConfirm('delete')}>
                删除订单
              </Button>
            )}
          </>
        }
      />
      <SaleOrderOverview order={order} />
      {(error || write.error || backup.error) && (
        <p role="alert" className="text-destructive">
          {write.pending && (error || write.error || backup.error) === '操作失败，请稍后重试'
            ? '原操作结果待确认，请先查询原操作结果'
            : error || write.error || backup.error}
        </p>
      )}
      {write.pending && (
        <div className="space-y-2 rounded border p-3">
          <p>原操作结果待确认，原单及请求已冻结；刷新不会自动提交，刷新后仅保留查询身份，不保存表单内容。</p>
          <Button disabled={write.busy} onClick={() => void write.queryOriginal().then(answer => {
            if (answer?.queryOnly) toast.success('原操作结果已核实，请自行打开原单；当前草稿未修改')
            else if (answer && write.canApplyConfirmation(answer)) void reload(false, answer)
          })}>查询原操作结果</Button>
          <Button
            disabled={write.busy || !write.canRetry}
            onClick={() =>
              void write.retry().then((answer) => {
                if (answer && write.canApplyConfirmation(answer)) {
                  setShipOpen(false)
                  setConfirm(null)
                  if (answer.plan.operation.action === 'delete') onClose()
                  else void reload(false, answer)
                }
              })
            }
          >
            按原请求重试
          </Button>
        </div>
      )}
      {write.conflict && !write.pending && (
        <div className="space-y-2">
          <p>版本已变化，请先复制原单上下文，再显式重读核对。</p>
          <Button
            variant="outline"
            onClick={() => void backup.copy(JSON.stringify({ order, owner, shipQuantities, confirm }, null, 2))}
          >
            复制原单上下文
          </Button>
          <Button variant="outline" disabled={!backup.copied || locked} onClick={() => void reload(true)}>
            备份后重读订单
          </Button>
          {backup.text && (
            <>
              <textarea readOnly aria-label="原单备份" value={backup.text} className="w-full border p-2" />
              <Button onClick={() => backup.acknowledge(backup.text)}>已备份草稿</Button>
            </>
          )}
        </div>
      )}
      {returning && (
        <p className="rounded border border-warning/30 bg-warning/5 p-3 text-sm">
          待仓库扫码归还或确认改单。已拣货品未扫码归还前，不视为预占释放，不允许再次派发；请沿下面原任务交接入口办理。
        </p>
      )}
      <SectionCard title="成交明细" compact>
        <div className="overflow-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="bg-muted/40">
              <tr>
                <th className="p-3 text-left">商品 / 发货仓</th>
                <th>当前目标</th>
                <th>当前金额</th>
                <th>原数量 / 原金额</th>
                <th>已确认实发</th>
                <th>待完成 / 已分配</th>
              </tr>
            </thead>
            <tbody>
              {order.commercialGroups?.map((g) => (
                <tr key={g.id} className="border-t">
                  <td className="p-3">
                    <p>
                      {g.kind === 'kit'
                        ? `${g.kitCode} ${g.kitName}`
                        : `${g.components[0]?.productCode} ${g.components[0]?.productName}`}{' '}
                      · {commercialWarehouseName(order, g.warehouseId)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {g.kind === 'kit'
                        ? `原订单套组成 · 每套成交 ${Number(g.unitPrice).toFixed(4)}`
                        : g.metadata.entry
                          ? `原成交 ${g.metadata.entry.entryQty}${g.metadata.entry.entryUnit} × ${Number(g.metadata.entry.entryUnitPrice).toFixed(4)}/${g.metadata.entry.entryUnit}；1${g.metadata.entry.entryUnit}=${g.metadata.entry.conversionRate}${g.components[0]?.unit}`
                          : `已存基本单价 ${Number(g.unitPrice).toFixed(8)}`}
                    </p>
                    <details className="mt-1 text-xs">
                      <summary>原组成与分摊依据</summary>
                      {g.components.map((c) => (
                        <p key={c.productId}>
                          {c.productCode} {c.productName} · 当前需求 {c.quantity}
                          {c.unit} · 当前份额 {money(c.amount ?? 0)} · 原份额 {money(c.allocatedAmount ?? 0)}
                        </p>
                      ))}
                    </details>
                  </td>
                  <td className="p-3 text-right">
                    {g.targetQty}
                    {g.kind === 'kit' ? '套' : g.components[0]?.unit}
                  </td>
                  <td className="p-3 text-right">{money(g.amount)}</td>
                  <td className="p-3 text-right">
                    {g.originalQty} / {money(g.originalAmount)}
                  </td>
                  <td className="p-3 text-right">{g.dispatch?.confirmedShippedQty ?? 0}</td>
                  <td className="p-3 text-right">
                    {g.dispatch?.outstandingQty ?? 0} / {g.dispatch?.activeAllocatedQty ?? 0}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="p-3 text-sm">
          成交合计 {money(order.totalAmount)} · 折扣 {money(order.discountAmount ?? 0)}
          。完整套已发量以原发货批次的出库确认为准；组件退货不会改写原完整套发货记录。
        </p>
      </SectionCard>
      <SectionCard title="发货批次" compact>
        <div className="space-y-2 p-3 text-sm">
          {order.commercialDispatches?.map((f) => (
            <p key={f.dispatchGroupId}>
              {f.taskNo} ·{' '}
              {order.commercialGroups?.find((g) => g.id === f.groupId)?.kitName ??
                order.commercialGroups?.find((g) => g.id === f.groupId)?.components[0]?.productName ??
                `原成交行 #${f.groupId}`}{' '}
              · {f.quantity}
              {order.commercialGroups?.find((g) => g.id === f.groupId)?.kind === 'kit'
                ? '套'
                : (order.commercialGroups?.find((g) => g.id === f.groupId)?.components[0]?.unit ?? '')}{' '}
              · {commercialWarehouseName(order, f.warehouseId)} ·{' '}
              {WT_STATUS_NAME[String(f.taskStatus) as keyof typeof WT_STATUS_NAME] ?? '未知状态'} ·{' '}
              {f.confirmedShipped ? '已确认实发' : f.outstanding ? '待完成' : '原批次（未确认）'}
              {!f.active && ' · 已撤销批次'}
              {f.taskDeletedAt && ' · 任务已删除'}
            </p>
          ))}
        </div>
      </SectionCard>
      <SectionCard title="仓库实物明细" compact>
        <div className="space-y-2 p-3 text-sm">
          <p className="text-muted-foreground">
            同款配件已合并，库存预留、扫码、分拣、复核和装箱按下面的真实配件作业。订单金额以成交明细为准。
          </p>
          {order.items?.map((p) => (
            <details key={p.id}>
              <summary>
                {p.productCode} {p.productName} · {p.quantity}
                {p.unit} · 已占 {p.reservedQty ?? 0} · 已派发 {p.dispatchedQty ?? 0} · 已发 {p.shippedQty ?? 0}
              </summary>
              {p.scans?.map((s, i) => (
                <p key={i}>
                  {s.barcode} · {s.qty}
                  {p.unit} · {s.operatorName}
                </p>
              ))}
            </details>
          ))}
        </div>
      </SectionCard>
      <CommercialFulfillmentSummary key={order.id} id={order.id} owner={owner} groups={order.commercialGroups ?? []} />
      {!ownerCurrent ? (
        <p role="alert">读取来源已变化，原任务资料保留；请回原服务器核对后办理交接。</p>
      ) : handoff === 'invalid' ? (
        <p role="alert">交接参数无效，请从原事项重新打开。</p>
      ) : (
        <FulfillmentProgressCard order={order} targetTaskId={handoff ? handoff.taskId : undefined} />
      )}
      <SectionCard title="装箱进度" compact>
        <div className="space-y-2 p-3 text-sm">
          {order.packages?.map((pkg) => (
            <details key={pkg.id}>
              <summary>
                {pkg.barcode} · {pkg.status === 2 ? '已完成' : '未完成'}
              </summary>
              {pkg.items.map((p, i) => (
                <p key={i}>
                  {p.productCode} {p.productName} · {p.qty}
                  {p.unit}
                </p>
              ))}
            </details>
          ))}
        </div>
      </SectionCard>
      <SectionCard title="操作记录" compact>
        <div className="space-y-3 p-3 text-sm">
          {order.timeline?.map((event) => (
            <div key={event.id}>
              <p className="font-medium">{event.title}</p>
              <p>{event.description}</p>
              <p className="text-muted-foreground">
                {formatDisplayDateTime(event.createdAt)} · {event.createdByName ?? '未记录'}
              </p>
            </div>
          ))}
        </div>
      </SectionCard>
      <ConfirmDialog
        open={!!confirm}
        title={
          confirm === 'cancel'
            ? confirmed
              ? '关闭剩余未发'
              : '取消订单'
            : confirm === 'reserve'
              ? '整单占库'
              : confirm === 'release'
                ? '释放整单占库'
                : '删除订单'
        }
        description={
          confirm === 'cancel'
            ? confirmed
              ? '按已确认的本单发货记录结案，保留原成交资料与已发生收入；已拣未发实物须先扫码归还，不能把待归还视为额度释放。'
              : '取消后保留原成交资料；已拣实物仍需仓库在原任务扫码归还，未归还不能再次派发。'
            : confirm === 'reserve'
              ? '同款配件合并占库，系统核对仓库、库存与授信；现货不足须等齐完整套再安排发货。'
              : confirm === 'release'
                ? '释放未执行的整单预占，系统按当前状态独立校验。'
                : '删除已取消订单，历史关联按系统规则保留。'
        }
        loading={write.busy}
        onCancel={() => {
          if (!locked) setConfirm(null)
        }}
        onConfirm={() => {
          if (confirm && !locked) void operation({ action: confirm, id: order.id, body: marker() })
        }}
      />
      {shipOpen && (
        <CommercialShipDialog
          order={order}
          quantities={shipQuantities}
          onChange={setShipQuantities}
          locked={locked}
          onClose={() => setShipOpen(false)}
          onConfirm={(groups) => void operation({ action: 'ship', id: order.id, body: { ...marker(), groups } })}
        />
      )}
      {printOpen && ownerCurrent && <PrintPreviewOverlay order={order} onClose={() => setPrintOpen(false)} />}
    </div>
  )
}
