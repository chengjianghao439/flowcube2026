import { ChevronDown, Edit2, Eye, Printer, Trash2, Truck, Undo2, Warehouse, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
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

  /** DRAFT（草稿）—— 编辑 / 占库 / 取消订单 */
  if (row.status === 1) {
    return (
      <div className="flex items-center gap-1">
        <Button
          size="sm"
          disabled={anyPending}
          onClick={() => onAsk('占用库存', '将预占该销售单所需库存，库存可用量减少，是否继续？', () => onReserveSale(row.id))}
        >
          <Warehouse className="mr-1 size-3.5" />
          占用库存
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="outline" disabled={anyPending} className="px-2">
              更多<ChevronDown className="ml-0.5 size-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onDetail}>
              <Edit2 className="size-4" />编辑订单
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              disabled={anyPending}
              onClick={() => onAsk('取消订单', '取消后订单将变为已取消状态，是否继续？', () => onCancelSale(row.id))}
            >
              <X className="size-4" />取消订单
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    )
  }

  /** RESERVED（已占库）—— 发货 / 取消占库 */
  if (row.status === 2) {
    return (
      <div className="flex items-center gap-1">
        <Button
          size="sm"
          disabled={anyPending}
          onClick={() => onAsk('发起出库', '将创建仓库出库任务，由仓库人员执行拣货后完成出库，是否继续？', () => onShipSale(row.id))}
        >
          <Truck className="mr-1 size-3.5" />
          发货
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="outline" disabled={anyPending} className="px-2">
              更多<ChevronDown className="ml-0.5 size-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onDetail}>
              <Eye className="size-4" />查看详情
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              disabled={anyPending}
              onClick={() => onAsk('取消占库', '将释放已预占的库存并将订单恢复为草稿状态，是否继续？', () => onReleaseSale(row.id))}
            >
              <Undo2 className="size-4" />取消占库
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    )
  }

  /** PICKING（发货中）—— 查看仓库任务 */
  if (row.status === 3) {
    return (
      <div className="flex items-center gap-1">
        <Button
          size="sm" variant="outline"
          className="border-amber-300 text-amber-700 hover:bg-amber-50 dark:border-amber-700 dark:text-amber-400 dark:hover:bg-amber-950"
          onClick={onViewTask}
        >
          <Warehouse className="mr-1 size-3.5" />查看仓库任务
        </Button>
        <Button size="sm" variant="ghost" onClick={onDetail}>
          <Eye className="size-3.5" />
        </Button>
      </div>
    )
  }

  /** SHIPPED（已出库）—— 查看 / 打印 */
  if (row.status === 4) {
    return (
      <div className="flex items-center gap-1">
        <Button size="sm" variant="outline" onClick={onDetail}>
          <Eye className="mr-1 size-3.5" />查看详情
        </Button>
        <Button size="sm" variant="ghost" onClick={onPrint}>
          <Printer className="size-3.5" />
        </Button>
      </div>
    )
  }

  /** CANCELLED（已取消）—— 删除 */
  return (
    <div className="flex items-center gap-1">
      <Button size="sm" variant="ghost" onClick={onDetail}>
        <Eye className="mr-1 size-3.5" />查看详情
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="text-destructive hover:text-destructive"
        disabled={anyPending}
        onClick={() => onAsk('确认删除订单', '删除后订单将无法恢复。', () => onDeleteSale(row.id))}
      >
        <Trash2 className="size-3.5" />
      </Button>
    </div>
  )
}
