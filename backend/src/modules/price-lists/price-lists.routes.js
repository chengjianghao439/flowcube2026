const { Router } = require('express')
const { z } = require('zod')
const { pool } = require('../../config/db')
const { successResponse } = require('../../utils/response')
const { authMiddleware } = require('../../middleware/auth')
const AppError = require('../../utils/AppError')
const router = Router()
router.use(authMiddleware)

const vBody = s => (req,res,next) => { const r=s.safeParse(req.body); if(!r.success) return res.status(400).json({success:false,message:r.error.errors.map(e=>e.message).join('；'),data:null}); req.body=r.data; next() }

// 价格表列表
router.get('/', async (req, res, next) => {
  try {
    const [rows] = await pool.query(`SELECT id,name,remark,is_active,created_at FROM price_lists WHERE deleted_at IS NULL ORDER BY created_at DESC`)
    return successResponse(res, rows.map(r => ({ id:r.id, name:r.name, remark:r.remark, isActive:r.is_active, createdAt:r.created_at })), '查询成功')
  } catch (e) { next(e) }
})

// 价格表明细（含商品价格）
router.get('/:id/items', async (req, res, next) => {
  try {
    const [rows] = await pool.query(`SELECT id,list_id,product_id,product_code,product_name,unit,sale_price FROM price_list_items WHERE list_id=? ORDER BY product_code`, [+req.params.id])
    return successResponse(res, rows.map(r => ({ id:r.id, productId:r.product_id, productCode:r.product_code, productName:r.product_name, unit:r.unit, salePrice:Number(r.sale_price) })), '查询成功')
  } catch (e) { next(e) }
})

// 查询某客户对某商品的定价（下销售单时调用）
router.get('/customer-price', async (req, res, next) => {
  try {
    const { customerId, productId } = req.query
    if (!customerId || !productId) return successResponse(res, null, '缺少参数')
    const [[cust]] = await pool.query('SELECT price_list_id FROM sale_customers WHERE id=?', [+customerId])
    if (!cust?.price_list_id) return successResponse(res, null, '客户未设置价格表')
    const [[item]] = await pool.query('SELECT sale_price FROM price_list_items WHERE list_id=? AND product_id=?', [cust.price_list_id, +productId])
    return successResponse(res, item ? { salePrice: Number(item.sale_price) } : null, item ? '找到定价' : '未设置该商品价格')
  } catch (e) { next(e) }
})

// 创建价格表
router.post('/', vBody(z.object({ name:z.string().min(1), remark:z.string().optional() })), async (req, res, next) => {
  try {
    const [r] = await pool.query('INSERT INTO price_lists (name,remark) VALUES (?,?)', [req.body.name, req.body.remark||null])
    return successResponse(res, { id:r.insertId }, '创建成功', 201)
  } catch (e) { next(e) }
})

// 批量更新价格表明细（覆盖写入）
router.put('/:id/items', async (req, res, next) => {
  try {
    const listId = +req.params.id
    const [[list]] = await pool.query('SELECT id FROM price_lists WHERE id=? AND deleted_at IS NULL', [listId])
    if (!list) throw new AppError('价格表不存在', 404)
    const items = req.body.items
    if (!Array.isArray(items)) return res.status(400).json({ success:false, message:'items 格式错误', data:null })
    const conn = await pool.getConnection()
    try {
      await conn.beginTransaction()
      await conn.query('DELETE FROM price_list_items WHERE list_id=?', [listId])
      for (const item of items) {
        if (!item.productId || !item.salePrice) continue
        await conn.query(`INSERT INTO price_list_items (list_id,product_id,product_code,product_name,unit,sale_price) VALUES (?,?,?,?,?,?)`,
          [listId, item.productId, item.productCode||'', item.productName||'', item.unit||'', item.salePrice])
      }
      await conn.commit()
    } catch (e) { await conn.rollback(); throw e } finally { conn.release() }
    return successResponse(res, null, '价格表已更新')
  } catch (e) { next(e) }
})

// 更新价格表基本信息
router.put('/:id', vBody(z.object({ name:z.string().min(1).optional(), remark:z.string().optional(), isActive:z.boolean().optional() })), async (req, res, next) => {
  try {
    const sets = []; const params = []
    if (req.body.name !== undefined) { sets.push('name=?'); params.push(req.body.name) }
    if (req.body.remark !== undefined) { sets.push('remark=?'); params.push(req.body.remark) }
    if (req.body.isActive !== undefined) { sets.push('is_active=?'); params.push(req.body.isActive?1:0) }
    if (sets.length) await pool.query(`UPDATE price_lists SET ${sets.join(',')} WHERE id=?`, [...params, +req.params.id])
    return successResponse(res, null, '更新成功')
  } catch (e) { next(e) }
})

// 删除价格表
router.delete('/:id', async (req, res, next) => {
  try {
    await pool.query('UPDATE price_lists SET deleted_at=NOW() WHERE id=?', [+req.params.id])
    return successResponse(res, null, '已删除')
  } catch (e) { next(e) }
})

// 更新客户关联的价格表
router.put('/bind-customer', async (req, res, next) => {
  try {
    const { customerId, priceListId } = req.body
    if (!customerId) return res.status(400).json({ success:false, message:'缺少 customerId', data:null })
    if (priceListId) {
      const [[list]] = await pool.query('SELECT name FROM price_lists WHERE id=? AND deleted_at IS NULL', [priceListId])
      if (!list) throw new AppError('价格表不存在', 404)
      await pool.query('UPDATE sale_customers SET price_list_id=?, price_list_name=? WHERE id=?', [priceListId, list.name, customerId])
    } else {
      await pool.query('UPDATE sale_customers SET price_list_id=NULL, price_list_name=NULL WHERE id=?', [customerId])
    }
    return successResponse(res, null, '绑定成功')
  } catch (e) { next(e) }
})

module.exports = router
