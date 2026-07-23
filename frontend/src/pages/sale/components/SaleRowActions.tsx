import { useState } from 'react'
import TableActionsMenu from '@/components/shared/TableActionsMenu'
import type { SaleOrder } from '@/types/sale'
import ShortageResolveDialog from './ShortageResolveDialog'

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
  // 已发往仓库执行（有关联仓库任务）且没有取消/改单挂起中时，才允许修改订单——
  // 与详情页 canAdjust 的判断口径一致（sale/form/index.tsx）。
  const canAdjust = !!row.taskId && !row.warehouseTaskCancelRequestedAt && !row.warehouseTaskAdjustmentRequestedAt
  const hasShortage = !!row.warehouseTaskShortageReportedAt
  const [shortageOpen, setShortageOpen] = useState(false)

  if (row.status === 1) {
    return (
      <TableActionsMenu
        primaryLabel="占用"
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
          ...(canAdjust ? [{ label: '修改订单', onClick: onDetail, disabled: anyPending }] : []),
          { label: '取消占库', onClick: () => onAsk('取消占库', '将释放已预占的库存并将订单恢复为草稿状态，是否继续？', () => onReleaseSale(row.id)), separatorBefore: true, disabled: anyPending },
          { label: '取消订单', onClick: () => onAsk('取消订单', '将释放已占用库存并取消销售单，是否继续？', () => onCancelSale(row.id)), destructive: true, disabled: anyPending },
        ]}
      />
    )
  }

  if (row.status === 3) {
    return (
      <>
      <TableActionsMenu
        primaryLabel={hasShortage ? '缺货处理' : '查看'}
        onPrimaryClick={hasShortage ? () => setShortageOpen(true) : onViewTask}
        primaryVariant={hasShortage ? 'destructive' : 'outline'}
        items={[
          ...(hasShortage ? [{ label: '查看任务', onClick: onViewTask }] : []),
          ...(canAdjust ? [{ label: '修改订单', onClick: onDetail, disabled: anyPending }] : []),
          { label: '取消订单', onClick: () => onAsk('取消订单', '将同步取消关联仓库任务并释放锁定资源，是否继续？', () => onCancelSale(row.id)), destructive: true, disabled: anyPending, separatorBefore: canAdjust || hasShortage },
        ]}
      />
      <ShortageResolveDialog open={shortageOpen} onClose={() => setShortageOpen(false)} taskId={row.taskId ?? null} taskNo={row.taskNo} />
      </>
    )
  }

  if (row.status === 4) {
    return (
      <TableActionsMenu
        primaryLabel="详情"
        onPrimaryClick={onDetail}
        primaryVariant="outline"
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
      primaryVariant="outline"
      items={[
        { label: '删除订单', onClick: () => onAsk('确认删除订单', '删除后订单将无法恢复。', () => onDeleteSale(row.id)), destructive: true, separatorBefore: true, disabled: anyPending },
      ]}
    />
  )
}
