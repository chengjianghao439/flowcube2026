const { pool } = require('../../config/db')
const { scopeFilter } = require('../../utils/warehouseScope')

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
    }
    if (type === 7) where.push('wt.deleted_at IS NULL', 'd.status<>3')
  } else {
    where.push('d.id=?')
    params.push(id)
  }
  const scope = type === 8 ? { sql: '', params: [] }
    : scopeFilter(scopeWarehouseIds, type === 7 ? 'wt.warehouse_id' : 'd.warehouse_id')
  const [[row]] = await conn.query(
    `SELECT ${source.select} FROM ${source.from} WHERE ${where.join(' AND ')}${scope.sql} ORDER BY d.id DESC LIMIT 1`,
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
