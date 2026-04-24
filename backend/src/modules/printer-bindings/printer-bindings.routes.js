/**
 * printer-bindings.routes.js
 * GET  /api/printer-bindings       — 获取所有绑定
 * PUT  /api/printer-bindings/:type — 设置某类型绑定
 * DELETE /api/printer-bindings/:type — 解除绑定
 */
const { Router } = require('express')
const { authMiddleware, requirePermission } = require('../../middleware/auth')
const { pool } = require('../../config/db')
const { PERMISSIONS } = require('../../constants/permissions')
const { successResponse } = require('../../utils/response')
const router = Router()

const VALID_TYPES = [
  'waybill',
  'product_label',
  'inventory_label',
  'rack_label',
  'container_label',
]

router.use(authMiddleware)

// 获取所有绑定（默认绑定和完整绑定列表都放在 data 内，避免私有顶层字段漂移）
router.get('/', requirePermission(PERMISSIONS.PRINT_PRINTER_VIEW), async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT b.*, p.name AS printer_name, p.type AS printer_type FROM printer_bindings b
       LEFT JOIN printers p ON p.id = b.printer_id
       ORDER BY b.warehouse_id, b.print_type`,
    )
    const map = {}
    for (const r of rows) {
      if (Number(r.warehouse_id) !== 0) continue
      const k = r.print_type
      if (!map[k]) map[k] = r
    }
    return successResponse(res, {
      defaultBindings: map,
      routes: rows,
    })
  } catch (e) {
    next(e)
  }
})

// 设置绑定
router.put('/:type', requirePermission(PERMISSIONS.PRINT_PRINTER_MANAGE), async (req, res, next) => {
  try {
    const { type } = req.params
    if (!VALID_TYPES.includes(type)) return res.status(400).json({ success: false, message: '无效的打印类型' })
    const { printerId, warehouseId: whRaw } = req.body
    if (!printerId) return res.status(400).json({ success: false, message: 'printerId 必填' })
    const warehouseId = whRaw != null && whRaw !== '' ? Number(whRaw) : 0
    if (!Number.isFinite(warehouseId) || warehouseId < 0) {
      return res.status(400).json({ success: false, message: 'warehouseId 无效' })
    }
    const [[printer]] = await pool.query(
      'SELECT id, code FROM printers WHERE id=?',
      [printerId],
    )
    if (!printer) return res.status(404).json({ success: false, message: '打印机不存在' })
    await pool.query(
      `INSERT INTO printer_bindings (warehouse_id, print_type, printer_id, printer_code)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE printer_id=VALUES(printer_id), printer_code=VALUES(printer_code)`,
      [warehouseId, type, printer.id, printer.code],
    )
    return successResponse(res, {
      warehouse_id: warehouseId,
      print_type: type,
      printer_id: printer.id,
      printer_code: printer.code,
    })
  } catch (e) { next(e) }
})

// 解除绑定
router.delete('/:type', requirePermission(PERMISSIONS.PRINT_PRINTER_MANAGE), async (req, res, next) => {
  try {
    const { type } = req.params
    if (!VALID_TYPES.includes(type)) {
      return res.status(400).json({ success: false, message: '无效的打印类型' })
    }
    const whQ = req.query.warehouseId
    const warehouseId = whQ != null && whQ !== '' ? Number(whQ) : 0
    await pool.query(
      'DELETE FROM printer_bindings WHERE print_type=? AND warehouse_id=?',
      [type, warehouseId],
    )
    return successResponse(res, null)
  } catch (e) { next(e) }
})

module.exports = router
