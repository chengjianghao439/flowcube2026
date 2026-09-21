#!/usr/bin/env node
'use strict'

/**
 * 生成「数量列精度 4 → 2」的迁移（一次性工具，2026-09-20）。
 *
 * 为什么必须查 information_schema 而不是静态扫 SQL 文件：`inventory_containers`
 * 的 `remaining_qty` / `initial_qty` 是 `017_alter_inventory_containers.sql` 用
 * 动态 SQL 加的，静态提取完全抓不到——而它恰恰是库存事实源，漏了它这个迁移就白做。
 *
 * 用法（对目标库执行）：
 *   set -a; source ~/.config/flowcube/operations20260912-test.env; set +a
 *   NODE_ENV=test node scripts/gen-qty-precision-migration.cjs
 *
 * 只改**数量**列：列名白名单见 QTY_COLUMNS。金额、单价、授信额度、税率一律不动——
 * 它们同样是 DECIMAL(_,4)，但那是有意的精度（如单价 8.3333 元/个）。
 */

const fs = require('node:fs')
const path = require('node:path')

const QTY_COLUMNS = new Set([
  'quantity', 'qty', 'entry_qty', 'base_qty',
  'remaining_qty', 'initial_qty', 'reserved', 'reserved_qty',
  'dispatched_qty', 'shipped_qty', 'received_qty', 'putaway_qty',
  'picked_qty', 'sorted_qty', 'checked_qty', 'counted_qty', 'rejected_qty',
  'required_qty', 'ordered_qty', 'expected_qty', 'deducted_qty', 'converted_qty',
  'bound_qty', 'pending_return_qty', 'pending_pick_qty',
  'old_required_qty', 'new_required_qty', 'diff_qty',
  'book_qty', 'actual_qty', 'before_qty', 'after_qty', 'change_qty',
  'safety_stock', 'reorder_point', 'pack_multiple',
  'minimum_order_qty', 'min_order_qty', 'shortage_qty', 'over_qty',
  'available_qty', 'allocated_qty', 'scanned_qty', 'total_qty',
  'in_transit_qty', 'pending_qty', 'closed_qty',
  // 需求预测与采购计划的快照量（核对过 information_schema 的列注释：都是数量，不是金额）
  'adu', 'actual_sold', 'forecast_demand', 'adjusted_qty', 'suggested_qty',
  'available', 'in_transit', 'target_stock',
])

// 明确排除（同为 DECIMAL(_,4) 但不能动）
const NEVER = new Set([
  'total_amount', 'amount', 'unit_price', 'cost_price', 'sale_price',
  'sale_price_a', 'sale_price_b', 'sale_price_c', 'sale_price_d',
  'settled_amount', 'paid_amount', 'unit_value', 'total_value',
  'old_price', 'new_price', 'credit_limit', 'estimated_price',
  'discount_amount', 'freight_amount', 'tax_amount', 'amount_with_tax',
  'amount_no_tax', 'gross_amount', 'net_amount', 'balance', 'debit', 'credit',
])

async function main() {
  const { pool } = require('../backend/src/config/db')
  const [rows] = await pool.query(
    `SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, NUMERIC_PRECISION, NUMERIC_SCALE,
            IS_NULLABLE, COLUMN_DEFAULT, COLUMN_COMMENT, EXTRA
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND DATA_TYPE = 'decimal'
        AND NUMERIC_SCALE = 4
      ORDER BY TABLE_NAME, ORDINAL_POSITION`,
  )

  const qty = rows.filter((r) => QTY_COLUMNS.has(r.COLUMN_NAME) && !NEVER.has(r.COLUMN_NAME))
  const skipped = rows.filter((r) => !QTY_COLUMNS.has(r.COLUMN_NAME) || NEVER.has(r.COLUMN_NAME))

  console.log(`扫描到 DECIMAL(_,4) 共 ${rows.length} 列`)
  console.log(`  将改为两位：${qty.length} 列`)
  console.log(`  保持四位（金额/其他）：${skipped.length} 列`)

  if (!qty.length) {
    console.error('✗ 没找到要改的数量列，多半是库不对')
    process.exit(1)
  }

  const lines = []
  lines.push('-- FlowCube ERP - Migration 255')
  lines.push('-- 数量精度统一为两位小数（0.01）：所有**数量**列 DECIMAL(_,4) → DECIMAL(_,2)。')
  lines.push('--')
  lines.push('-- 背景：系统的最小库存精度此前是 0.0001，界面上根本读不出「0.0001 件」这种数量，')
  lines.push('-- 而按重量/长度计量的商品两位小数已经足够。2026-09-20 按用户要求统一收到两位。')
  lines.push('--')
  lines.push('-- **存量数据按四舍五入到两位**（用户 2026-09-20 明确选择）：MySQL 在 MODIFY COLUMN')
  lines.push('-- 时对 DECIMAL 缩小数位会自动四舍五入，0.0001 会变成 0.00。因此执行前请先确认')
  lines.push('-- 生产库里 3~4 位小数的库存数量是可以接受这种处理的历史数据；查询语句见文件末尾。')
  lines.push('--')
  lines.push('-- **金额、单价、授信额度一律不动**：它们同样是 DECIMAL(_,4)，但那是有意的精度')
  lines.push('-- （例如单价 8.3333 元/个），改两位会直接影响金额计算。')
  lines.push('--')
  lines.push('-- 幂等：每列先查 information_schema 确认 scale 仍为 4 才 ALTER；已改过的库重跑无操作。')
  lines.push('-- 生成方式：scripts/gen-qty-precision-migration.cjs（对目标库实查 information_schema）。')
  lines.push('')
  lines.push('SET @db = DATABASE();')
  lines.push('')

  let n = 0
  for (const r of qty) {
    const nullable = r.IS_NULLABLE === 'NO' ? ' NOT NULL' : ' NULL'
    let def = ''
    if (r.COLUMN_DEFAULT !== null && r.COLUMN_DEFAULT !== undefined && r.EXTRA !== 'auto_increment') {
      // 默认值也按新精度格式化：DECIMAL(_,2) 的默认值写成 0.0000 虽然合法，但读起来别扭
      const dv = Number(r.COLUMN_DEFAULT)
      def = ` DEFAULT ${Number.isFinite(dv) ? dv.toFixed(2) : r.COLUMN_DEFAULT}`
    }
    const comment = r.COLUMN_COMMENT ? ` COMMENT '${String(r.COLUMN_COMMENT).replace(/'/g, "''")}'` : ''
    const target = `DECIMAL(${r.NUMERIC_PRECISION},2)${nullable}${def}${comment}`
    // 整条 ALTER 还要作为外层 IF(...) 的字符串参数：其中每个单引号都必须双写，
    // 否则注释里的引号会提前结束字符串（第一版就栽在这里，迁移直接 ER_PARSE_ERROR）。
    const alterSql = `ALTER TABLE \`${r.TABLE_NAME}\` MODIFY COLUMN \`${r.COLUMN_NAME}\` ${target}`.replace(/'/g, "''")
    lines.push(`-- ${r.TABLE_NAME}.${r.COLUMN_NAME}（${r.COLUMN_TYPE} → DECIMAL(${r.NUMERIC_PRECISION},2)）`)
    lines.push(`SET @sql = IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS`)
    lines.push(`  WHERE TABLE_SCHEMA=@db AND TABLE_NAME='${r.TABLE_NAME}' AND COLUMN_NAME='${r.COLUMN_NAME}' AND NUMERIC_SCALE=4),`)
    lines.push(`  '${alterSql}', 'SELECT 1');`)
    lines.push('PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;')
    lines.push('')
    n++
  }

  lines.push('-- 执行后自查：下面这条应返回 0 行（数量列不再有 scale=4 的）')
  lines.push('-- SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.COLUMNS')
  lines.push('--  WHERE TABLE_SCHEMA=DATABASE() AND DATA_TYPE=\'decimal\' AND NUMERIC_SCALE=4')
  lines.push('--    AND COLUMN_NAME IN (' + [...QTY_COLUMNS].map((c) => `'${c}'`).join(',') + ');')
  lines.push('')
  lines.push('-- 执行前核对存量（把 <列> 换成要查的列）：')
  lines.push('-- SELECT COUNT(*) FROM <表> WHERE <列> IS NOT NULL AND ROUND(<列>,4) <> ROUND(<列>,2);')

  const out = path.join(__dirname, '../backend/src/database/255_qty_precision_two_decimals.sql')
  fs.writeFileSync(out, lines.join('\n'))
  console.log(`✓ 已生成 ${path.relative(process.cwd(), out)}（${n} 条 ALTER）`)
  console.log('\n未改动的列（前 20）：')
  skipped.slice(0, 20).forEach((r) => console.log(`  ${r.TABLE_NAME}.${r.COLUMN_NAME} ${r.COLUMN_TYPE}`))
  if (skipped.length > 20) console.log(`  … 另有 ${skipped.length - 20} 列`)
  await pool.end()
}

main().catch((e) => { console.error('✗ ' + (e.stack || e.message)); process.exit(1) })
