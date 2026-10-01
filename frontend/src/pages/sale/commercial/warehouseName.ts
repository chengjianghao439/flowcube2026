import type { SaleOrder } from '@/types/sale'
export function commercialWarehouseName(order: SaleOrder, id: number): string {
  return (
    order.items?.find((item) => item.warehouseId === id && item.warehouseName)?.warehouseName ||
    order.tasks?.find((task) => task.warehouseId === id && task.warehouseName)?.warehouseName ||
    (order.warehouseId === id ? order.warehouseName : '') ||
    `仓库 #${id}`
  )
}
