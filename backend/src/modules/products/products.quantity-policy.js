'use strict'

const AppError = require('../../utils/AppError')
const { assertQtyPrecisionWith } = require('../../utils/qtyPrecision')

const fraction = (...fields) => fields.map(field => `MOD(COALESCE(${field},0),1)<>0`).join(' OR ')
// These are live quantities and actionable balances, never price/amount fields
// or immutable completed history. Every lookup is bounded to this product.
const CHECKS = [
  ['库存条码', `SELECT 1 FROM inventory_containers WHERE product_id=? AND deleted_at IS NULL AND status IN (1,4,5,6) AND (${fraction('remaining_qty')}) LIMIT 1`],
  ['库存余额', `SELECT 1 FROM inventory_stock WHERE product_id=? AND (${fraction('quantity','reserved')}) LIMIT 1`],
  ['预占', `SELECT 1 FROM stock_reservations WHERE product_id=? AND status=1 AND (${fraction('qty')}) LIMIT 1`],
  ['在途绑定', `SELECT 1 FROM sale_order_expected_bindings WHERE product_id=? AND released_at IS NULL AND (${fraction('qty')}) LIMIT 1`],
  ['待处理采购', `SELECT 1 FROM purchase_order_items i JOIN purchase_orders o ON o.id=i.order_id WHERE i.product_id=? AND o.deleted_at IS NULL AND o.status IN (1,2,5) AND (${fraction('i.quantity','i.entry_qty')}) LIMIT 1`],
  ['未完成入库', `SELECT 1 FROM inbound_task_items i JOIN inbound_tasks t ON t.id=i.task_id WHERE i.product_id=? AND t.deleted_at IS NULL AND t.status IN (1,2,3) AND (${fraction('i.ordered_qty','i.received_qty','i.putaway_qty')}) LIMIT 1`],
  ['未完成销售', `SELECT 1 FROM sale_order_items i JOIN sale_orders o ON o.id=i.order_id WHERE i.product_id=? AND o.deleted_at IS NULL AND o.status IN (1,2,3,6) AND (${fraction('i.quantity','i.entry_qty','i.reserved_qty','i.dispatched_qty','i.shipped_qty')}) LIMIT 1`],
  ['仓库任务', `SELECT 1 FROM warehouse_task_items i JOIN warehouse_tasks t ON t.id=i.task_id WHERE i.product_id=? AND t.deleted_at IS NULL AND t.status NOT IN (7,8) AND (${fraction('i.required_qty','i.picked_qty','i.sorted_qty','i.checked_qty')}) LIMIT 1`],
  ['销售退货', `SELECT 1 FROM sale_return_items i JOIN sale_returns r ON r.id=i.return_id WHERE i.product_id=? AND r.deleted_at IS NULL AND r.status IN (1,2) AND (${fraction('i.quantity','i.entry_qty')}) LIMIT 1`],
  ['采购退货', `SELECT 1 FROM purchase_return_items i JOIN purchase_returns r ON r.id=i.return_id WHERE i.product_id=? AND r.deleted_at IS NULL AND r.status IN (1,2) AND (${fraction('i.quantity','i.entry_qty')}) LIMIT 1`],
  ['退货任务', `SELECT 1 FROM return_task_items i JOIN return_tasks t ON t.id=i.task_id WHERE i.product_id=? AND t.deleted_at IS NULL AND t.status NOT IN (5,6) AND (${fraction('i.expected_qty','i.received_qty','i.checked_qty','i.rejected_qty','i.putaway_qty')}) LIMIT 1`],
  ['调拨', `SELECT 1 FROM transfer_order_items i JOIN transfer_orders o ON o.id=i.order_id WHERE i.product_id=? AND o.deleted_at IS NULL AND o.status IN (1,2,3) AND (${fraction('i.quantity','i.deducted_qty','i.received_qty')}) LIMIT 1`],
  ['盘点', `SELECT 1 FROM inventory_check_items i JOIN inventory_checks c ON c.id=i.check_id WHERE i.product_id=? AND c.deleted_at IS NULL AND c.status=1 AND (${fraction('i.book_qty','i.actual_qty','i.diff_qty')}) LIMIT 1`],
  ['盘点条码', `SELECT 1 FROM inventory_check_item_containers s JOIN inventory_check_items i ON i.id=s.check_item_id JOIN inventory_checks c ON c.id=i.check_id WHERE i.product_id=? AND c.deleted_at IS NULL AND c.status=1 AND (${fraction('s.counted_qty')}) LIMIT 1`],
  ['处置', `SELECT 1 FROM inventory_disposal_items i JOIN inventory_disposal_orders o ON o.id=i.disposal_id WHERE i.product_id=? AND o.deleted_at IS NULL AND o.status NOT IN (4,6) AND (${fraction('i.quantity')}) LIMIT 1`],
  ['采购计划', `SELECT 1 FROM procurement_plan_items i JOIN procurement_plans p ON p.id=i.plan_id WHERE i.product_id=? AND p.deleted_at IS NULL AND p.status IN (1,2) AND i.status=1 AND (${fraction('i.adjusted_qty')}) LIMIT 1`],
  ['采购包装策略', `SELECT 1 FROM supplier_product_purchase_policies WHERE product_id=? AND (${fraction('pack_multiple','minimum_order_qty')}) LIMIT 1`],
  ['当前套件组成', `SELECT 1 FROM kit_definition_components c JOIN kit_definitions k ON k.current_version_id=c.version_id WHERE c.product_id=? AND k.deleted_at IS NULL AND k.is_active=1 AND (${fraction('c.base_qty')}) LIMIT 1`],
  ['原销售剩余可退量', `SELECT 1 FROM sale_order_items i JOIN sale_orders o ON o.id=i.order_id WHERE i.product_id=? AND o.deleted_at IS NULL AND o.commercial_model IS NULL AND MOD(GREATEST(0,i.shipped_qty-COALESCE((SELECT SUM(r.quantity) FROM sale_return_items r JOIN sale_returns h ON h.id=r.return_id WHERE r.sale_item_id=i.id AND h.deleted_at IS NULL AND h.status<>4),0)),1)<>0 LIMIT 1`],
  ['原成交批次剩余可退量', `SELECT 1 FROM sale_dispatch_component_money m JOIN sale_commercial_components c ON c.id=m.component_id JOIN sale_dispatch_groups d ON d.id=m.dispatch_group_id JOIN warehouse_tasks t ON t.id=d.task_id WHERE c.product_id=? AND t.deleted_at IS NULL AND t.status=7 AND d.confirmed_at IS NOT NULL AND MOD(GREATEST(0,m.source_qty-COALESCE((SELECT SUM(r.quantity) FROM sale_return_items r JOIN sale_returns h ON h.id=r.return_id WHERE r.dispatch_component_id=m.id AND h.deleted_at IS NULL AND h.status<>4),0)),1)<>0 LIMIT 1`],
  ['原采购剩余可退量', `SELECT 1 FROM purchase_order_items i JOIN purchase_orders o ON o.id=i.order_id WHERE i.product_id=? AND o.deleted_at IS NULL AND o.status<>4 AND MOD(GREATEST(0,COALESCE((SELECT SUM(a.received_qty) FROM inbound_task_items a JOIN inbound_tasks t ON t.id=a.task_id WHERE a.purchase_item_id=i.id AND t.deleted_at IS NULL AND t.status IN (3,4)),0)-COALESCE((SELECT SUM(r.quantity) FROM purchase_return_items r JOIN purchase_returns h ON h.id=r.return_id WHERE r.purchase_item_id=i.id AND h.deleted_at IS NULL AND h.status<>4),0)),1)<>0 LIMIT 1`],
]

async function assertCanDisableDecimals(conn, productId, proposed = {}) {
  const conflicts = []
  for (const [label, sql] of CHECKS) {
    const [rows] = await conn.query(sql, [productId])
    if (rows.length) conflicts.push(label)
  }
  // The default warehouse policy is editable in this same product transaction.
  // Evaluate the proposed values instead of making an old setting impossible to fix.
  const [policies] = await conn.query('SELECT warehouse_id,safety_stock,reorder_point,target_stock FROM product_stock_policies WHERE product_id=?', [productId])
  for (const policy of policies) {
    const values = [
      Number(policy.warehouse_id) === 0 && proposed.safetyStock !== undefined ? proposed.safetyStock : policy.safety_stock,
      Number(policy.warehouse_id) === 0 && proposed.reorderPoint !== undefined ? proposed.reorderPoint : policy.reorder_point,
      policy.target_stock,
    ]
    try { for (const qty of values) if (qty != null) assertQtyPrecisionWith({ allowDecimal: false }, qty, '库存策略数量') }
    catch (error) { if (error.code !== 'QTY_INTEGER_REQUIRED') throw error; conflicts.push('库存策略'); break }
  }
  if (conflicts.length) throw new AppError(`不能关闭“允许小数数量”：仍有含小数的${[...new Set(conflicts)].join('、')}。请先核对并完成相关业务；历史事实不自动取整，需继续处理小数时保留开启。`, 409, 'PRODUCT_QTY_POLICY_CONFLICT')
}

module.exports = { assertCanDisableDecimals, CHECKS }
