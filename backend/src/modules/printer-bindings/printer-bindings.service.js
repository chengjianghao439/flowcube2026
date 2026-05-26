const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')

const findAll = async () => {
  const [rows] = await pool.query(
    `SELECT b.*, p.name AS printer_name, p.type AS printer_type FROM printer_bindings b
       LEFT JOIN printers p ON p.id = b.printer_id
       ORDER BY b.warehouse_id, b.print_type`)
  const map = {}
  for (const r of rows) {
    if (Number(r.warehouse_id) !== 0) continue
    const k = r.print_type
    if (!map[k]) map[k] = r
  }
  return { defaultBindings: map, routes: rows }
}

const bind = async (type, printerId, warehouseId) => {
  const [[printer]] = await pool.query('SELECT id, code FROM printers WHERE id=?', [printerId])
  if (!printer) throw new AppError('打印机不存在', 404, 'NOT_FOUND')
  await pool.query(
    `INSERT INTO printer_bindings (warehouse_id, print_type, printer_id, printer_code)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE printer_id=VALUES(printer_id), printer_code=VALUES(printer_code)`,
    [warehouseId, type, printer.id, printer.code])
  return { warehouse_id: warehouseId, print_type: type, printer_id: printer.id, printer_code: printer.code }
}

const unbind = async (type, warehouseId) => {
  await pool.query('DELETE FROM printer_bindings WHERE print_type=? AND warehouse_id=?', [type, warehouseId])
}

module.exports = { findAll, bind, unbind }
