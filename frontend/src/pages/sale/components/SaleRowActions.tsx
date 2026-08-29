import TableActionsMenu from '@/components/shared/TableActionsMenu'
import type { SaleOrder } from '@/types/sale'

interface SaleRowActionsProps {
  row: SaleOrder
  anyPending: boolean
  onAsk: (title: string, desc: string, onConfirm: () => void) => void
  onReserveSale: (id: number) => void
  onReleaseSale: (id: number) => void
  onShipSale: (id: number) => void
  onCancelSale: (id: number) => void
  onDeleteSale: (id: number) => void
  onViewTask: () => void
  onDetail: () => void
  onPrint: () => void
}

export function SaleRowActions({
  row, anyPending,
  onAsk, onReserveSale, onReleaseSale, onShipSale, onCancelSale, onDeleteSale,
  onViewTask, onDetail, onPrint,
}: SaleRowActionsProps) {
  // 占库期（状态2/6，无 taskId 也可改单）与执行期（状态3，需 taskId）都可改单；
  // 没有取消/改单挂起中、且非多仓、零出库才允许——与详情页 canAdjust 口径一致。
  const canAdjust = (row.status === 2 || row.status === 3 || row.status === 6)
    && !row.warehouseTaskCancelRequestedAt && !row.warehouseTaskAdjustmentRequestedAt
    && !row.isMultiWarehouse && (row.shippedTotalQty ?? 0) === 0

  // 打印与订单状态无关（模板只依赖订单基础信息 + 明细），每个状态都可打印，与采购单一致
  const printItem = { label: '打印订单', onClick: onPrint }

  if (row.status === 1) {
    // 待占用（草稿）：动作未发生，用描边弱化 + 动态标签，避免实心按钮看起来像已占用
    return (
      <TableActionsMenu
        primaryLabel="占库"
        primaryVariant="outline"
        primaryDisabled={anyPending}
        onPrimaryClick={() => onReserveSale(row.id)}
        items={[
          { label: '编辑订单', onClick: onDetail },
          printItem,
          { label: '取消订单', onClick: () => onAsk('取消订单', '取消后订单将变为已取消状态，是否继续？', () => onCancelSale(row.id)), destructive: true, separatorBefore: true, disabled: anyPending },
        ]}
      />
    )
  }

  if (row.status === 2) {
    return (
      <TableActionsMenu
        primaryLabel="发货"
        primaryDisabled={anyPending}
        onPrimaryClick={() => onAsk('发起出库', '将创建仓库出库任务，由仓库人员执行拣货后完成出库，是否继续？', () => onShipSale(row.id))}
        items={[
          { label: '查看详情', onClick: onDetail },
          { label: '占库', onClick: () => onReserveSale(row.id) },
          ...(canAdjust ? [{ label: '修改订单', onClick: onDetail, disabled: anyPending }] : []),
          printItem,
          { label: '取消占库', onClick: () => onAsk('取消占库', '将释放已预占的库存并将订单恢复为草稿状态，是否继续？', () => onReleaseSale(row.id)), separatorBefore: true, disabled: anyPending },
          { label: '取消订单', onClick: () => onAsk('取消订单', '将释放已占用库存并取消销售单，是否继续？', () => onCancelSale(row.id)), destructive: true, disabled: anyPending },
        ]}
      />
    )
  }

  if (row.status === 6) {
    // 部分占库：可补占（占满剩余）、发货（只发已占）、改单、取消占库、取消订单
    return (
      <TableActionsMenu
        primaryLabel="补占"
        primaryDisabled={anyPending}
        onPrimaryClick={() => onReserveSale(row.id)}
        items={[
          { label: '发货', onClick: () => onAsk('发起出库', '仅对已占库的数量创建出库任务，未占部分不会发货，是否继续？', () => onShipSale(row.id)), disabled: anyPending },
          { label: '查看详情', onClick: onDetail },
          ...(canAdjust ? [{ label: '修改订单', onClick: onDetail, disabled: anyPending }] : []),
          printItem,
          { label: '取消占库', onClick: () => onAsk('取消占库', '将释放已预占的库存，是否继续？', () => onReleaseSale(row.id)), separatorBefore: true, disabled: anyPending },
          { label: '取消订单', onClick: () => onAsk('取消订单', '将释放已占用库存并取消销售单，是否继续？', () => onCancelSale(row.id)), destructive: true, disabled: anyPending },
        ]}
      />
    )
  }

  if (row.status === 3) {
    // 分批：仍有未派发行时，「继续发货」是本状态下最主要的下一步操作
    const canContinueShip = !!row.hasUndispatchedItems
    return (
      <TableActionsMenu
        primaryLabel={canContinueShip ? '继续发货' : '查看'}
        onPrimaryClick={canContinueShip ? onDetail : onViewTask}
        primaryVariant="outline"
        items={[
          ...(canContinueShip ? [{ label: '查看详情', onClick: onViewTask }] : []),
          ...(canAdjust ? [{ label: '修改订单', onClick: onDetail, disabled: anyPending }] : []),
          printItem,
          {
            label: '取消订单',
            onClick: () => onAsk(
              '取消订单',
              (row.shippedTotalQty ?? 0) > 0
                ? '该订单已有部分商品出库：未发货的商品明细将被删除，已出库部分保留，订单直接变为已出库状态，是否继续？'
                : '将同步取消关联仓库任务并释放锁定资源，是否继续？',
              () => onCancelSale(row.id),
            ),
            destructive: true, disabled: anyPending, separatorBefore: true,
          },
        ]}
      />
    )
  }

  if (row.status === 4) {
    return (
      <TableActionsMenu
        primaryLabel="详情"
        onPrimaryClick={onDetail}
        primaryVariant="outline"
        items={[printItem]}
      />
    )
  }

  return (
    <TableActionsMenu
      primaryLabel="详情"
      onPrimaryClick={onDetail}
      primaryVariant="outline"
      items={[
        printItem,
        { label: '删除订单', onClick: () => onAsk('确认删除订单', '删除后订单将无法恢复。', () => onDeleteSale(row.id)), destructive: true, separatorBefore: true, disabled: anyPending },
      ]}
    />
  )
}
