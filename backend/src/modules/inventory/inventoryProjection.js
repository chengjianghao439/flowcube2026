/**
 * 展示 / 统计 projection：
 * - quantity / reserved 都直接读 inventory_stock 缓存表
 *
 * inventory_stock.quantity 由 containerEngine.syncStockFromContainers() 在每个改变
 * ACTIVE 容器汇总的写入路径末尾同步维护（createContainer 转正、扣减、拆分、调拨、
 * 盘点调整、退货/收货上架等，见 containerEngine.js 头部注释的不变量说明），
 * 不再需要在展示层现算 SUM(inventory_containers.remaining_qty)。
 *
 * 注意：
 * - 仅用于 overview / dashboard / reports / finder / notifications 等展示读取
 * - 不得用于 reserve / execute / available check 等关键业务判定
 *   （那些走 containerEngine.getStockProjection() 的实时容器聚合 + FOR UPDATE 行锁）
 */

function getInventoryDisplayProjectionSql() {
  return `(
    SELECT product_id, warehouse_id, quantity, reserved
    FROM inventory_stock
  )`
}

function getProductInventoryProjectionSql() {
  return `(
    SELECT ip.product_id,
           SUM(ip.quantity) AS quantity,
           SUM(ip.reserved) AS reserved,
           SUM(GREATEST(0, ip.quantity - ip.reserved)) AS available
    FROM ${getInventoryDisplayProjectionSql()} ip
    GROUP BY ip.product_id
  )`
}

module.exports = {
  getInventoryDisplayProjectionSql,
  getProductInventoryProjectionSql,
}
