import { ReturnSourceButton } from '@/pages/returns/ReturnSourceButton'
import { ReorderSourceButton } from '../ReorderSourceButton'
import { useSaleReorderSource } from '@/hooks/useSaleReorderSource'
import { useRepeatSaleCreate } from '@/hooks/useRepeatSaleCreate'
import { commercialWarehouseName } from './warehouseName'
import { commercialUnit } from './commercialDraft'
import { useEffect, useRef, useState } from 'react'
import { Pencil, Warehouse, X } from 'lucide-react'
import KeepAliveSection from '@/components/shared/KeepAliveSection'
import { SaleOrderDetailTabs, type SaleDetailTab } from '../form/components/SaleOrderDetailTabs'
import { DocumentActivityPanel } from '@/components/shared/DocumentActivityPanel'
import { SaleOrderScanDetails, SaleOrderPackingDetails, SaleOrderPickingProgress } from '../form/components/SaleOrderWarehouseViews'
import { SaleOrderInfoCard } from '../form/components/SaleOrderInfoCard'
import { CommercialOrderItems } from './CommercialOrderItems'
import type { SaleOrder } from '@/types/sale'
import type { CommercialAction, CommercialOperation, CommercialWriteConfirmation } from '@/types/sale-commercial'
import type { KitReadOwner } from '@/api/kits'
import { useCommercialWrite, readCommercialSaleOwned } from '@/hooks/useCommercialSale'
import { assertKitReadOwner, captureKitReadOwner, useKitBackup } from '@/hooks/useKits'
import { usePermission } from '@/hooks/usePermission'
import { useDirtyGuard } from '@/hooks/useDirtyGuard'
import { useWorkspaceTabTitle } from '@/hooks/useWorkspaceTabTitle'
import { PERMISSIONS } from '@/lib/permission-codes'
import { getSaleWorkflowStatus } from '@/lib/saleWorkflowStatus'
import { WT_STATUS_NAME } from '@/generated/status'
import { toast } from '@/lib/toast'
import { ActionBar } from '@/components/shared/ActionBar'
import { Button } from '@/components/ui/button'
import DataTable from '@/components/shared/DataTable'
import { SoftStatusLabel } from '@/components/shared/StatusBadge'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import CommercialFulfillmentSummary from './CommercialFulfillmentSummary'
import { PrintPreviewOverlay } from '@/components/print/SaleOrderPrintTemplate'
import { FulfillmentProgressCard } from '../form/components/FulfillmentProgressCard'
import { SaleOrderOverview } from '../form/components/SaleOrderOverview'
import { readSaleHandoff } from '../form/handoff'
import CommercialEditor from './CommercialEditor'
import { useSaleEditEntry } from '../form/useSaleEditEntry'
import CommercialShipDialog from './CommercialShipDialog'
import { buildWorkspaceTabRegistrationFromPath } from '@/router/workspaceRouteMeta'
const permission = {
  ship: PERMISSIONS.SALE_ORDER_SHIP,
  cancel: PERMISSIONS.SALE_ORDER_CANCEL,
  reserve: PERMISSIONS.SALE_ORDER_RESERVE,
  release: PERMISSIONS.SALE_ORDER_RELEASE,
  delete: PERMISSIONS.SALE_ORDER_DELETE
}
export function NewCommercialSale({ tabPath, onDone, sourceId, sourceModel = 'kit-v1', ordinaryOnlySave = false }: { tabPath: string; onDone: (id?: number) => void; sourceId?: number; sourceModel?: 'ordinary' | 'kit-v1'; ordinaryOnlySave?: boolean }) {
  const [owner] = useState(captureKitReadOwner)
  if (sourceId) return <RepeatCommercialCreate sourceId={sourceId} sourceModel={sourceModel} ordinaryOnlySave={ordinaryOnlySave} tabPath={tabPath} onDone={onDone} />
  return <CommercialEditor owner={owner} ordinaryOnlySave={ordinaryOnlySave} tabPath={tabPath} onDone={onDone} />
}
function RepeatCommercialCreate({ sourceId, sourceModel, ordinaryOnlySave, tabPath, onDone }: { sourceId: number; sourceModel: 'ordinary' | 'kit-v1'; ordinaryOnlySave: boolean; tabPath: string; onDone: (id?: number) => void }) {
  const source = useSaleReorderSource(sourceId, sourceModel)
  const write = useRepeatSaleCreate(sourceId, sourceModel, source.owner, buildWorkspaceTabRegistrationFromPath(tabPath).key)
  return <CommercialEditor owner={source.owner} ordinaryOnlySave={ordinaryOnlySave} tabPath={tabPath} onDone={onDone} reorder={{ source, write }} />
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
  const [detailTab, setDetailTab] = useState<SaleDetailTab>(() => {
    const context = readSaleHandoff(tabPath, initial.id)
    return context && context !== 'invalid' ? context.focus : 'info'
  })
  useEffect(() => {
    const context = readSaleHandoff(tabPath, order.id)
    if (context === 'invalid') setDetailTab('info')
    else if (context) setDetailTab(context.focus)
  }, [tabPath, order.id])
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
  const returning =
    !!order.warehouseTaskCancelRequestedAt ||
    !!order.warehouseTaskAdjustmentRequestedAt ||
    !!order.tasks?.some((t) => t.cancelRequestedAt || t.adjustmentRequestedAt)
  useSaleEditEntry(tabPath, true, () => {
    if (order.status === 1 && can(PERMISSIONS.SALE_ORDER_UPDATE) && !locked && !returning) {
      setEditor(current => current ?? { baseline: order, adjust: false })
    }
  })
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
  const workflow = getSaleWorkflowStatus(order)
  const confirmed = order.commercialGroups?.some((g) => (g.dispatch?.confirmedShippedQty ?? 0) > 0)
  const canAdjust =
    [2, 3, 6].includes(order.status) &&
    !returning &&
    !order.executionAdjustmentBlocked &&
    !order.isMultiWarehouse &&
    !confirmed
  return (
    <div className="flex flex-col gap-2.5">
      <ActionBar
        title={order.orderNo}
        subtitle={<SoftStatusLabel label={workflow.label} tone={workflow.tone} />}
        rightActions={
          <>
            <ReturnSourceButton kind="sale" sourceId={order.id} sourceNo={order.orderNo} disabled={locked} />
            <ReorderSourceButton sourceId={order.id} model="kit-v1" disabled={locked} />
            {can(permission.cancel) && [1, 2, 3, 6].includes(order.status) && (
              <Button variant="outline" className="text-destructive-ink border-destructive/30 hover:bg-destructive/5" disabled={locked || returning} onClick={() => setConfirm('cancel')}>
                <X className="mr-1 h-4 w-4" />{confirmed ? '关闭剩余未发' : '取消订单'}
              </Button>
            )}
            {can(permission.delete) && order.status === 5 && (
              <Button variant="outline" className="text-destructive-ink border-destructive/30 hover:bg-destructive/5" disabled={locked} onClick={() => setConfirm('delete')}>
                <X className="mr-1 h-4 w-4" />删除订单
              </Button>
            )}
            {can(permission.reserve) && [1, 6].includes(order.status) && (
              <Button variant="outline" disabled={locked || returning} onClick={() => setConfirm('reserve')}>
                <Warehouse className="mr-1 h-4 w-4" />{order.status === 6 ? '补占库存' : '占用库存'}
              </Button>
            )}
            {can(permission.release) && [2, 6].includes(order.status) && (
              <Button variant="outline" disabled={locked || returning} onClick={() => setConfirm('release')}>
                <Warehouse className="mr-1 h-4 w-4" />取消占库
              </Button>
            )}
            <Button variant="outline" disabled={!ownerCurrent} onClick={() => setPrintOpen(true)}>
              打印订单
            </Button>
            {can(permission.ship) && [2, 3, 6].includes(order.status) && (
              <Button disabled={locked || returning} onClick={() => setShipOpen(true)}>
                {order.status === 3 ? '继续发货' : '发起出库'}
              </Button>
            )}
            {can(PERMISSIONS.SALE_ORDER_UPDATE) && (order.status === 1 || canAdjust) && (
              <Button
                variant="outline"
                disabled={locked || returning}
                onClick={() => setEditor({ baseline: order, adjust: order.status !== 1 })}
              >
                <Pencil className="mr-1 h-4 w-4" />{order.status === 1 ? '编辑' : '修改订单'}
              </Button>
            )}
          </>
        }
      />
      <SaleOrderOverview order={order} />
      {(error || write.error || backup.error) && (
        <p role="alert" className="text-destructive-ink">
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
      {handoff === 'invalid' && <p role="alert">交接参数无效，请从原事项重新打开。</p>}
      <SaleOrderDetailTabs value={detailTab} onChange={setDetailTab} />
      <KeepAliveSection active={detailTab === 'info'} className="space-y-3">
        <SaleOrderInfoCard order={order} />
        <CommercialOrderItems order={order} />
      </KeepAliveSection>
      <KeepAliveSection active={detailTab === 'fulfillment'} className="space-y-3">
        <CommercialFulfillmentSummary key={order.id} id={order.id} owner={owner} groups={order.commercialGroups ?? []} />
      </KeepAliveSection>
      <KeepAliveSection active={detailTab === 'progress'} className="space-y-3"><div className="card-base space-y-4 p-4">
        {!ownerCurrent ? (
          <p role="alert">读取来源已变化，原任务资料保留；请回原服务器核对后办理交接。</p>
        ) : handoff === 'invalid' ? (
          <p role="alert">交接参数无效，请从原事项重新打开。</p>
        ) : (
          <FulfillmentProgressCard order={order} targetTaskId={handoff ? handoff.taskId : undefined} />
        )}
        <SaleOrderPickingProgress order={order} />
        {!!order.commercialDispatches?.length && <div data-sale-batches className="space-y-2">
          <h3 className="text-sm font-semibold">发货批次</h3>
          <DataTable virtualized rowKey="id" columns={[
            { key: 'taskNo', title: '任务', width: 150 },
            { key: 'productName', title: '商品', width: 260, render: value => <span className="whitespace-normal break-words">{String(value)}</span> },
            { key: 'quantity', title: '数量', width: 100, align: 'right' },
            { key: 'warehouse', title: '发货仓库', width: 130 },
            { key: 'status', title: '状态', width: 100 },
            { key: 'result', title: '发货记录', width: 220 },
          ]} data={order.commercialDispatches.map(f => {
            const group = order.commercialGroups?.find(g => g.id === f.groupId)
            return { id: f.dispatchGroupId, taskNo: f.taskNo, productName: group?.kitName ?? group?.components[0]?.productName ?? `原成交行 #${f.groupId}`,
              quantity: `${f.quantity}${commercialUnit(group)}`, warehouse: commercialWarehouseName(order, f.warehouseId),
              status: WT_STATUS_NAME[String(f.taskStatus) as keyof typeof WT_STATUS_NAME] ?? '未知状态',
              result: [f.confirmedShipped ? '已确认实发' : f.outstanding ? '待完成' : '原批次（未确认）', !f.active && '已撤销批次', f.taskDeletedAt && '任务已删除'].filter(Boolean).join(' · ') }
          })} />
        </div>}
        {!order.taskNo && !order.tasks?.length && !order.commercialDispatches?.length && <p className="py-8 text-center text-sm text-muted-foreground">尚未创建仓库任务，订单状态为 {workflow.label}</p>}

            </div></KeepAliveSection>
      <KeepAliveSection active={detailTab === 'scan'} className="space-y-3"><p className="text-xs text-muted-foreground">订单金额以成交明细为准。</p><SaleOrderScanDetails order={order} /></KeepAliveSection>
      <KeepAliveSection active={detailTab === 'pack'} className="space-y-3"><SaleOrderPackingDetails order={order} /></KeepAliveSection>
      <KeepAliveSection active={detailTab === 'log'} className="space-y-3"><DocumentActivityPanel type="sale" id={order.id} view="log" readOwner={owner} /></KeepAliveSection>
      <ConfirmDialog
        open={!!confirm}
        cancelText="返回订单"
        variant={confirm === 'cancel' || confirm === 'delete' ? 'destructive' : 'default'}
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
