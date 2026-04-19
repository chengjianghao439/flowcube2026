/**
 * 展示 / 统计 projection：
 * - quantity 基于 ACTIVE 容器事实层汇总
 * - reserved 基于 inventory_stock.reserved 受控 projection
 *
 * 注意：
 * - 仅用于 overview / dashboard / reports / finder / notifications 等展示读取
 * - 不得用于 reserve / execute / available check 等关键业务判定
 */

function getInventoryDisplayProjectionSql() {
  return `(
    SELECT dims.product_id,
           dims.warehouse_id,
           COALESCE(c.quantity, 0) AS quantity,
           COALESCE(s.reserved, 0) AS reserved
    FROM (
      SELECT product_id, warehouse_id FROM inventory_stock
      UNION
      SELECT product_id, warehouse_id
      FROM inventory_containers
      WHERE status = 1 AND deleted_at IS NULL
    ) dims
    LEFT JOIN (
      SELECT product_id, warehouse_id, SUM(remaining_qty) AS quantity
      FROM inventory_containers
      WHERE status = 1 AND deleted_at IS NULL
      GROUP BY product_id, warehouse_id
    ) c ON c.product_id = dims.product_id AND c.warehouse_id = dims.warehouse_id
    LEFT JOIN inventory_stock s ON s.product_id = dims.product_id AND s.warehouse_id = dims.warehouse_id
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
