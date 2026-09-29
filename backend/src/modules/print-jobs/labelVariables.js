const { pool } = require('../../config/db')
const { scopeFilter } = require('../../utils/warehouseScope')
const { CONTAINER_STATUS } = require('../../engine/containerEngine')

const WAREHOUSE_SELECT = 'w.name AS warehouse_name, w.code AS warehouse_code'
const WAREHOUSE_JOIN = 'LEFT JOIN inventory_warehouses w ON w.id=d.warehouse_id'

// These are internal query fragments, never supplied by a request or a template.
const SOURCES = {
  5: {
    select: `d.id, d.barcode, d.code, d.zone, d.name, d.warehouse_id, d.max_levels, d.max_positions, d.remark, ${WAREHOUSE_SELECT}`,
    from: `warehouse_racks d ${WAREHOUSE_JOIN}`,
  },
  6: {
    select: `d.id, d.barcode, d.remaining_qty, d.warehouse_id, p.name AS product_name,
      p.code AS product_code, p.article_number, p.spec, p.color, COALESCE(NULLIF(d.unit, ''), p.unit) AS unit, ${WAREHOUSE_SELECT},
      l.code AS location_code, d.batch_no,
      DATE_FORMAT(d.mfg_date, '%Y-%m-%d') AS mfg_date, DATE_FORMAT(d.exp_date, '%Y-%m-%d') AS exp_date`,
    from: `inventory_containers d LEFT JOIN product_items p ON p.id=d.product_id
      ${WAREHOUSE_JOIN} LEFT JOIN warehouse_locations l ON l.id=d.location_id AND l.warehouse_id=d.warehouse_id`,
  },
  7: {
    select: `d.id, d.barcode, d.remark, wt.task_no, wt.customer_name, wt.warehouse_id, wt.sale_order_no,
      so.freight_type, c.name AS carrier_name, ${WAREHOUSE_SELECT},
      (SELECT COUNT(*) FROM package_items pi WHERE pi.package_id=d.id) AS line_count,
      (SELECT COALESCE(SUM(pi.qty),0) FROM package_items pi WHERE pi.package_id=d.id) AS total_qty`,
    from: `packages d JOIN warehouse_tasks wt ON wt.id=d.warehouse_task_id
      LEFT JOIN sale_orders so ON so.id=wt.sale_order_id LEFT JOIN carriers c ON c.id=so.carrier_id
      LEFT JOIN inventory_warehouses w ON w.id=wt.warehouse_id`,
  },
  8: {
    select: 'd.id, d.code, d.name, d.spec, d.unit, d.sale_price, d.article_number, d.color',
    from: 'product_items d',
  },
  10: {
    select: `d.id, d.barcode, d.code, d.zone, d.name, d.warehouse_id, d.aisle, d.rack, d.level, d.position, d.remark, ${WAREHOUSE_SELECT}`,
    from: `warehouse_locations d ${WAREHOUSE_JOIN}`,
  },
  // 取货标签（批 B2 type 11）：变量取自**真实 PICK 扫码行**（数量、任务、销售单），
  // **不是**容器的 `remaining_qty`——发货/减量后余量会归 0，按余量取会把标签补打成「0 个」。
  11: {
    // `d.barcode` 保留原名：latest 取样分支的 `sourceLabel` 读的是 `row.barcode`，
    // 只别名成 container_code 会让它在预览里变空。
    select: `d.id, d.barcode, d.barcode AS container_code, sl.qty AS qty, sl.task_id,
      wt.sale_order_no, wt.customer_name, wt.warehouse_id,
      p.name AS product_name, p.code AS product_code,
      COALESCE(NULLIF(d.unit, ''), p.unit) AS unit, ${WAREHOUSE_SELECT}`,
    from: `scan_logs sl
      JOIN inventory_containers d ON d.id = sl.container_id
      LEFT JOIN warehouse_tasks wt ON wt.id = sl.task_id
      LEFT JOIN product_items p ON p.id = d.product_id
      ${WAREHOUSE_JOIN}`,
  },
}

function pick(row, keys) {
  return Object.fromEntries(keys.map(key => [key, row[key] ?? '']))
}

// The empty form also covers callers that only have core print data and no saved row.
function containerLabelVariables(row = {}) {
  return { container_code: row.barcode ?? '', qty: row.remaining_qty ?? '',
    ...pick(row, ['product_name', 'product_code', 'article_number', 'spec', 'color', 'unit',
      'warehouse_name', 'warehouse_code', 'location_code', 'batch_no', 'mfg_date', 'exp_date']) }
}

/**
 * One reader for real previews and queued labels. Preview selection and warehouse
 * filtering stay in the same query. A caller transaction sees newly created rows.
 * By-id package reads retain the established reprint behavior, including void boxes.
 */
async function readLabelVariables(type, { id = null, scopeWarehouseIds = null, conn = pool } = {}) {
  const source = SOURCES[type === 9 ? 6 : type]
  if (!source) return null
  const latest = id == null
  const where = [type === 7 ? '1=1' : 'd.deleted_at IS NULL']
  const params = []
  if (latest) {
    if (type === 5 || type === 10) where.push("d.barcode IS NOT NULL AND d.barcode<>''")
    if (type === 6 || type === 9) {
      where.push('d.barcode LIKE ?')
      params.push(type === 6 ? 'I%' : 'B%')
      // latest 取样同样排除作废容器：这条分支供打印模板预览挑「一条样例数据」
      // （print-templates.preview.js 的 latestLabel），不排除就会拿已作废容器（qty=0）
      // 当样例。与下面 by-id 分支保持同口径。
      where.push(`d.status <> ${CONTAINER_STATUS.VOID}`)
    }
    if (type === 7) where.push('wt.deleted_at IS NULL', 'd.status<>3')
  } else {
    // 取货标签（type 11）按 **PICK 扫码行 id** 定位（它承载本次取货数量与来源任务），
    // 其余类型仍按容器/单据 id。
    where.push(type === 11 ? 'sl.id=?' : 'd.id=?')
    params.push(id)
    // 作废容器不参与取变量：与箱贴分支（type=7）排除 `d.status<>3` 同口径，作为「补打入口
    // 已单独拒绝 VOID」之外的第三道防线——任何走这条路的调用方都取不到已作废容器的数据。
    if (type === 6 || type === 9) where.push(`d.status <> ${CONTAINER_STATUS.VOID}`)
  }
  // 取货标签（type 11）只认「扫盒取货」写下的 PICK 行：
  //   · `scan_purpose` 为 PICK（值 1；历史行可能为 NULL，与 scan-logs 同口径用 COALESCE 兜底）
  //   · 来源必须是本功能写入的 `plastic_box_pick` 容器——**排除普通整件 I 的拣货扫码**
  //   · 排除 VOID 容器
  // 少了这层筛选，latest 取样会拿 CHECK 扫码 / 普通 I 扫码当「取货标签」样例。
  if (type === 11) {
    where.push(
      'COALESCE(sl.scan_purpose, 1) = 1',
      "d.source_ref_type = 'plastic_box_pick'",
      `d.status <> ${CONTAINER_STATUS.VOID}`,
    )
  }
  const scope = type === 8 ? { sql: '', params: [] }
    : scopeFilter(scopeWarehouseIds, type === 7 ? 'wt.warehouse_id' : 'd.warehouse_id')
  const [[row]] = await conn.query(
    `SELECT ${source.select} FROM ${source.from} WHERE ${where.join(' AND ')}${scope.sql} ORDER BY ${type === 11 ? 'sl.id' : 'd.id'} DESC LIMIT 1`,
    [...params, ...scope.params],
  )
  if (!row) return null
  let vars
  const warehouse = pick(row, ['warehouse_name', 'warehouse_code'])
  if (type === 5 || type === 10) {
    const prefix = type === 5 ? 'rack' : 'location'
    const extra = type === 5 ? ['max_levels', 'max_positions'] : ['aisle', 'rack', 'level', 'position']
    vars = { [`${prefix}_barcode`]: row.barcode, [`${prefix}_code`]: row.code,
      ...pick(row, ['zone', 'name', 'remark', ...extra]), ...warehouse }
  } else if (type === 6 || type === 9) {
    vars = containerLabelVariables(row)
  } else if (type === 8) {
    vars = { product_code: row.code, product_name: row.name,
      ...pick(row, ['spec', 'unit', 'article_number', 'color']),
      price: row.sale_price != null ? Number(row.sale_price).toFixed(2) : '' }
  } else if (type === 11) {
    // 取货标签（批 B2）：条码即取货码；数量取**本次 PICK 行的 qty**（不用容器余量）
    vars = {
      container_code: row.container_code,
      qty: row.qty != null ? String(row.qty) : '',
      ...pick(row, ['product_name', 'product_code', 'unit', 'sale_order_no', 'customer_name']),
      ...warehouse,
    }
  } else {
    const [items] = await conn.query(
      `SELECT pi.qty, p.name AS product_name FROM package_items pi
       JOIN product_items p ON p.id=pi.product_id WHERE pi.package_id=? ORDER BY pi.id`, [row.id],
    )
    vars = { box_code: row.barcode,
      ...pick(row, ['task_no', 'customer_name', 'carrier_name', 'sale_order_no', 'remark']), ...warehouse,
      freight_type_name: ({ 1: '寄付', 2: '到付', 3: '第三方付' })[row.freight_type] || '',
      piece_count: `${Number(row.total_qty)} 件`, item_list: items.map(i => `${i.product_name}×${i.qty}`).join(', '),
      summary: `${Number(row.line_count)} 行 / ${Number(row.total_qty)} 件` }
  }
  return { row, vars }
}

module.exports = { readLabelVariables, containerLabelVariables }
