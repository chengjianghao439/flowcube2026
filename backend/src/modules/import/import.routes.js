const { Router } = require('express')
const multer = require('multer')
const XLSX = require('xlsx')
const { pool } = require('../../config/db')
const { authMiddleware } = require('../../middleware/auth')
const { successResponse } = require('../../utils/response')
const AppError = require('../../utils/AppError')

const router = Router()
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } })
router.use(authMiddleware)

// 下载商品导入模板
router.get('/products/template', (req, res) => {
  const XLSX2 = require('xlsx')
  const ws = XLSX2.utils.aoa_to_sheet([
    ['商品编码*', '商品名称*', '单位*', '规格', '条码', '成本价', '销售价', '备注'],
    ['P001', '示例商品', '个', '标准规格', '', '10.00', '15.00', '']
  ])
  ws['!cols'] = [12,22,6,14,14,10,10,20].map(w=>({wch:w}))
  const wb = XLSX2.utils.book_new()
  XLSX2.utils.book_append_sheet(wb, ws, '商品导入')
  const buf = XLSX2.write(wb, { type: 'buffer', bookType: 'xlsx' })
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.setHeader('Content-Disposition', "attachment; filename*=UTF-8''%E5%95%86%E5%93%81%E5%AF%BC%E5%85%A5%E6%A8%A1%E6%9D%BF.xlsx")
  res.send(buf)
})

// 商品批量导入
router.post('/products', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) throw new AppError('请上传文件', 400)
    const wb = XLSX.read(req.file.buffer, { type: 'buffer' })
    const ws = wb.Sheets[wb.SheetNames[0]]
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
    if (rows.length < 2) throw new AppError('文件无数据行', 400)

    const dataRows = rows.slice(1).filter(r => r[0] || r[1]) // 跳过空行
    let success = 0, skip = 0, errors = []

    for (let i = 0; i < dataRows.length; i++) {
      const [code, name, unit, spec, barcode, costPrice, salePrice, remark] = dataRows[i]
      if (!code || !name || !unit) { errors.push(`第${i+2}行：编码、名称、单位为必填`); continue }
      try {
        const [ex] = await pool.query('SELECT id FROM product_items WHERE code=? AND deleted_at IS NULL', [String(code).trim()])
        if (ex.length) { skip++; continue }
        await pool.query(
          `INSERT INTO product_items (code,name,unit,spec,barcode,cost_price,sale_price,remark) VALUES (?,?,?,?,?,?,?,?)`,
          [String(code).trim(), String(name).trim(), String(unit).trim(), spec||null, barcode||null, costPrice||null, salePrice||null, remark||null]
        )
        success++
      } catch (e) { errors.push(`第${i+2}行：${e.message}`) }
    }
    return successResponse(res, { success, skip, errors }, `导入完成：成功${success}条，跳过${skip}条${errors.length?`，失败${errors.length}条`:''}`)
  } catch (e) { next(e) }
})

// 下载库存初始化模板
router.get('/stock/template', async (req, res) => {
  const [products] = await pool.query('SELECT code, name, unit FROM product_items WHERE deleted_at IS NULL ORDER BY code LIMIT 100')
  const [warehouses] = await pool.query('SELECT id, name FROM inventory_warehouses WHERE deleted_at IS NULL AND is_active=1')
  const XLSX2 = require('xlsx')
  const ws = XLSX2.utils.aoa_to_sheet([
    ['商品编码*（需已存在）', '仓库ID*', '库存数量*'],
    ...products.flatMap(p => warehouses.map(w => [p.code, w.id, 0]))
  ])
  const wsWh = XLSX2.utils.aoa_to_sheet([['仓库ID', '仓库名称'], ...warehouses.map(w => [w.id, w.name])])
  const wb = XLSX2.utils.book_new()
  XLSX2.utils.book_append_sheet(wb, ws, '库存初始化')
  XLSX2.utils.book_append_sheet(wb, wsWh, '仓库参考')
  const buf = XLSX2.write(wb, { type: 'buffer', bookType: 'xlsx' })
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.setHeader('Content-Disposition', "attachment; filename*=UTF-8''%E5%BA%93%E5%AD%98%E5%88%9D%E5%A7%8B%E5%8C%96%E6%A8%A1%E6%9D%BF.xlsx")
  res.send(buf)
})

// 库存批量初始化导入
router.post('/stock', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) throw new AppError('请上传文件', 400)
    const wb = XLSX.read(req.file.buffer, { type: 'buffer' })
    const ws = wb.Sheets[wb.SheetNames[0]]
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
    const dataRows = rows.slice(1).filter(r => r[0])
    if (!dataRows.length) throw new AppError('文件无数据行', 400)

    let success = 0, errors = []
    for (let i = 0; i < dataRows.length; i++) {
      const [code, warehouseId, qty] = dataRows[i]
      if (!code || !warehouseId || qty === '') { errors.push(`第${i+2}行：数据不完整`); continue }
      try {
        const [[prod]] = await pool.query('SELECT id FROM product_items WHERE code=? AND deleted_at IS NULL', [String(code).trim()])
        if (!prod) { errors.push(`第${i+2}行：商品编码"${code}"不存在`); continue }
        await pool.query(
          `INSERT INTO inventory_stock (product_id, warehouse_id, quantity) VALUES (?,?,?) ON DUPLICATE KEY UPDATE quantity=VALUES(quantity)`,
          [prod.id, +warehouseId, +qty || 0]
        )
        success++
      } catch (e) { errors.push(`第${i+2}行：${e.message}`) }
    }
    return successResponse(res, { success, errors }, `导入完成：成功${success}条${errors.length?`，失败${errors.length}条`:''}`)
  } catch (e) { next(e) }
})

module.exports = router
