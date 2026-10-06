const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const { assertBoundWarehouseInScope, scopeFilter } = require('../../utils/warehouseScope')

const findAll = async (scopeWarehouseIds = null) => {
  // 公司级绑定仍参与默认路由；限仓读取还须校验它所指向的打印机仓库。
  // 全局/未知仓打印机不会因为公司级绑定而成为限仓可见资源。
  let whereSql = ''
  let whereParams = []
  if (Array.isArray(scopeWarehouseIds)) {
    whereSql = scopeWarehouseIds.length
      ? 'WHERE (b.warehouse_id IN (?) OR b.warehouse_id = 0)'
      : 'WHERE b.warehouse_id = 0'
    if (scopeWarehouseIds.length) whereParams = [scopeWarehouseIds]
  }
  const printerScope = scopeFilter(scopeWarehouseIds, 'p.warehouse_id')
  whereSql += (whereSql ? '' : 'WHERE 1=1') + printerScope.sql
  whereParams.push(...printerScope.params)
  const [rows] = await pool.query(
    `SELECT b.*, p.name AS printer_name, p.type AS printer_type FROM printer_bindings b
       LEFT JOIN printers p ON p.id = b.printer_id
       ${whereSql}
       ORDER BY b.warehouse_id, b.print_type`,
    whereParams)
  const map = {}
  for (const r of rows) {
    if (Number(r.warehouse_id) !== 0) continue
    const k = r.print_type
    if (!map[k]) map[k] = r
  }
  return { defaultBindings: map, routes: rows }
}

const bind = async (type, printerId, warehouseId, scopeWarehouseIds = null) => {
  assertBoundWarehouseInScope(scopeWarehouseIds, Number(warehouseId) || null, '打印机绑定')
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    // Serialize with printer moves/removal so the authorized warehouse is the one bound.
    const [[printer]] = await conn.query('SELECT id, code, warehouse_id, type AS device_type FROM printers WHERE id=? FOR UPDATE', [printerId])
    if (!printer) throw new AppError('打印机不存在', 404, 'NOT_FOUND')
    assertBoundWarehouseInScope(scopeWarehouseIds, printer.warehouse_id, '打印机')
    // 打印链路统一走 ZPL RAW，A4/文档打印机收到后只会吐乱码。
    // 解析器的 fallback 分支本就按设备类型筛选，绑定路径此前不校验，会绕过这道保护。
    if (Number(printer.device_type) === 3) {
      throw new AppError(
        'A4 / 文档打印机不能绑定打印用途：标签打印统一使用 ZPL 指令，该类设备无法处理',
        400,
        'PRINT_BINDING_DEVICE_TYPE_INVALID',
      )
    }
    await conn.query(
      `INSERT INTO printer_bindings (warehouse_id, print_type, printer_id, printer_code)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE printer_id=VALUES(printer_id), printer_code=VALUES(printer_code)`,
      [warehouseId, type, printer.id, printer.code])
    await conn.commit()
    return { warehouse_id: warehouseId, print_type: type, printer_id: printer.id, printer_code: printer.code }
  } catch (e) { await conn.rollback(); throw e } finally { conn.release() }
}

const unbind = async (type, warehouseId) => {
  await pool.query('DELETE FROM printer_bindings WHERE print_type=? AND warehouse_id=?', [type, warehouseId])
}

module.exports = { findAll, bind, unbind }
