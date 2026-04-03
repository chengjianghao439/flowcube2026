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
  if (row.status === 1) {
    return (
      <TableActionsMenu
        primaryLabel="占用库存"
        primaryDisabled={anyPending}
        onPrimaryClick={() => onAsk('占用库存', '将预占该销售单所需库存，库存可用量减少，是否继续？', () => onReserveSale(row.id))}
        items={[
          { label: '编辑订单', onClick: onDetail },
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
          { label: '取消占库', onClick: () => onAsk('取消占库', '将释放已预占的库存并将订单恢复为草稿状态，是否继续？', () => onReleaseSale(row.id)), separatorBefore: true, disabled: anyPending },
          { label: '取消订单', onClick: () => onAsk('取消订单', '将释放已占用库存并取消销售单，是否继续？', () => onCancelSale(row.id)), destructive: true, disabled: anyPending },
        ]}
      />
    )
  }

  if (row.status === 3) {
    return (
      <TableActionsMenu
        primaryLabel="查看任务"
        onPrimaryClick={onViewTask}
        primaryVariant="outline"
        items={[
          { label: '查看详情', onClick: onDetail },
          { label: '取消订单', onClick: () => onAsk('取消订单', '将同步取消关联仓库任务并释放锁定资源，是否继续？', () => onCancelSale(row.id)), destructive: true, separatorBefore: true, disabled: anyPending },
        ]}
      />
    )
  }

  if (row.status === 4) {
    return (
      <TableActionsMenu
        primaryLabel="详情"
        onPrimaryClick={onDetail}
        items={[
          { label: '打印订单', onClick: onPrint },
        ]}
      />
    )
  }

  return (
    <TableActionsMenu
      primaryLabel="详情"
      onPrimaryClick={onDetail}
      items={[
        { label: '删除订单', onClick: () => onAsk('确认删除订单', '删除后订单将无法恢复。', () => onDeleteSale(row.id)), destructive: true, separatorBefore: true, disabled: anyPending },
      ]}
    />
  )
}
