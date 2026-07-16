#!/usr/bin/env node
/**
 * 一次性把 inventory_stock.quantity 与 inventory_containers 的 ACTIVE 汇总强制对齐。
 *
 * 背景：inventory_stock.quantity 一直是靠各业务路径在末尾调用 syncStockFromContainers()
 * 维护的"按需缓存"，理论上应该已经和容器事实层一致；但在把展示层（dashboard/报表/通知）
 * 从"每次现算聚合"切到"直接读 inventory_stock"之前，先跑一遍全量重算兜底，
 * 消除任何历史遗留的漂移（比如早期某次代码遗漏调用、或数据修复时绕过了应用层）。
 *
 * 用法：node scripts/resync-inventory-stock.js
 * 幂等、可重复执行，不会产生副作用；建议在部署"读缓存表"这个改动之前手动跑一次。
 */
require('dotenv').config()

const { pool } = require('../src/config/db')
const { syncStockFromContainers } = require('../src/engine/containerEngine')

async function main() {
  const [pairs] = await pool.query(`
    SELECT product_id, warehouse_id FROM inventory_stock
    UNION
    SELECT product_id, warehouse_id FROM inventory_containers WHERE status = 1 AND deleted_at IS NULL
  `)

  console.log(`[Resync] 共 ${pairs.length} 个 product_id+warehouse_id 组合待校准`)

  let changed = 0
  for (const { product_id, warehouse_id } of pairs) {
    const [[before]] = await pool.query(
      'SELECT quantity FROM inventory_stock WHERE product_id=? AND warehouse_id=?',
      [product_id, warehouse_id],
    )
    const after = await syncStockFromContainers(pool, product_id, warehouse_id)
    const beforeQty = before ? Number(before.quantity) : 0
    if (Math.abs(beforeQty - after) > 0.0001) {
      changed++
      console.log(`[Resync] product=${product_id} warehouse=${warehouse_id}: ${beforeQty} → ${after}`)
    }
  }

  console.log(`[Resync] 完成，共校准 ${changed} 条存在漂移的记录（其余已一致）`)
}

main()
  .catch((error) => {
    console.error(error.message || error)
    process.exit(1)
  })
  .finally(async () => {
    try {
      await pool.end()
    } catch {
      // ignore
    }
  })
