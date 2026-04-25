/**
 * printer-bindings.routes.js
 * GET  /api/printer-bindings       — 获取所有绑定
 * PUT  /api/printer-bindings/:type — 设置某类型绑定
 * DELETE /api/printer-bindings/:type — 解除绑定
 */
const { Router } = require('express')
const { z } = require('zod')
const { authMiddleware, requirePermission } = require('../../middleware/auth')
const { pool } = require('../../config/db')
const { PERMISSIONS } = require('../../constants/permissions')
const AppError = require('../../utils/AppError')
const { successRoute, validateBody, validateParams, validateQuery } = require('../../utils/route')
const router = Router()

const VALID_TYPES = [
  'waybill',
  'product_label',
  'inventory_label',
  'rack_label',
  'container_label',
  'package_label',
]

const typeParamSchema = z.object({
  type: z.enum(VALID_TYPES, { errorMap: () => ({ message: '无效的打印类型' }) }),
})

const bindBodySchema = z.object({
  printerId: z.coerce.number().int().positive('printerId 必填'),
  warehouseId: z.union([z.coerce.number().int().min(0), z.literal(''), z.null(), z.undefined()])
    .transform((value) => (value == null || value === '' ? 0 : Number(value))),
}).passthrough()

const unbindQuerySchema = z.object({
  warehouseId: z.union([z.coerce.number().int().min(0), z.literal(''), z.null(), z.undefined()])
    .transform((value) => (value == null || value === '' ? 0 : Number(value))),
}).passthrough()

router.use(authMiddleware)

// 获取所有绑定（默认绑定和完整绑定列表都放在 data 内，避免私有顶层字段漂移）
router.get('/', requirePermission(PERMISSIONS.PRINT_PRINTER_VIEW), successRoute(async () => {
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
  return {
    defaultBindings: map,
    routes: rows,
  }
}))

// 设置绑定
router.put('/:type', requirePermission(PERMISSIONS.PRINT_PRINTER_MANAGE), validateParams(typeParamSchema), validateBody(bindBodySchema), successRoute(async (req) => {
  const { type } = req.params
  const { printerId, warehouseId } = req.body
  const [[printer]] = await pool.query(
    'SELECT id, code FROM printers WHERE id=?',
    [printerId],
  )
  if (!printer) throw new AppError('打印机不存在', 404, 'NOT_FOUND')
  await pool.query(
    `INSERT INTO printer_bindings (warehouse_id, print_type, printer_id, printer_code)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE printer_id=VALUES(printer_id), printer_code=VALUES(printer_code)`,
    [warehouseId, type, printer.id, printer.code],
  )
  return {
    warehouse_id: warehouseId,
    print_type: type,
    printer_id: printer.id,
    printer_code: printer.code,
  }
}))

// 解除绑定
router.delete('/:type', requirePermission(PERMISSIONS.PRINT_PRINTER_MANAGE), validateParams(typeParamSchema), validateQuery(unbindQuerySchema), successRoute(async (req) => {
  const { type } = req.params
  const warehouseId = req.query.warehouseId
  await pool.query(
    'DELETE FROM printer_bindings WHERE print_type=? AND warehouse_id=?',
    [type, warehouseId],
  )
  return null
}))

module.exports = router
