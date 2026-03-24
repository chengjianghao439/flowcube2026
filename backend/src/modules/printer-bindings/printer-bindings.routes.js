/**
 * printer-bindings.routes.js
 * GET  /api/printer-bindings       — 获取所有绑定
 * PUT  /api/printer-bindings/:type — 设置某类型绑定
 * DELETE /api/printer-bindings/:type — 解除绑定
 */
const { Router } = require('express')
const { authMiddleware } = require('../../middleware/auth')
const { pool } = require('../../config/db')
const router = Router()

const VALID_TYPES = ['waybill', 'product_label', 'inventory_label']

router.use(authMiddleware)

// 获取所有绑定
router.get('/', async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      'SELECT b.*, p.name AS printer_name, p.type AS printer_type FROM printer_bindings b LEFT JOIN printers p ON p.id = b.printer_id'
    )
    // 转为 { waybill: {...}, product_label: {...}, ... } 格式
    const map = {}
    for (const r of rows) map[r.print_type] = r
    res.json({ success: true, data: map })
  } catch (e) { next(e) }
})

// 设置绑定
router.put('/:type', async (req, res, next) => {
  try {
    const { type } = req.params
    if (!VALID_TYPES.includes(type)) return res.status(400).json({ success: false, message: '无效的打印类型' })
    const { printerId } = req.body
    if (!printerId) return res.status(400).json({ success: false, message: 'printerId 必填' })
    const [[printer]] = await pool.query('SELECT id, code FROM printers WHERE id=?', [printerId])
    if (!printer) return res.status(404).json({ success: false, message: '打印机不存在' })
    await pool.query(
      `INSERT INTO printer_bindings (print_type, printer_id, printer_code)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE printer_id=VALUES(printer_id), printer_code=VALUES(printer_code)`,
      [type, printer.id, printer.code]
    )
    res.json({ success: true, data: { print_type: type, printer_id: printer.id, printer_code: printer.code } })
  } catch (e) { next(e) }
})

// 解除绑定
router.delete('/:type', async (req, res, next) => {
  try {
    const { type } = req.params
    await pool.query('DELETE FROM printer_bindings WHERE print_type=?', [type])
    res.json({ success: true, data: null })
  } catch (e) { next(e) }
})

module.exports = router
