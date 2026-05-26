const { Router } = require('express')
const { z } = require('zod')
const ctrl = require('./price-lists.controller')
const { authMiddleware, requirePermission } = require('../../middleware/auth')
const { PERMISSIONS } = require('../../constants/permissions')
const router = Router()
router.use(authMiddleware)

const vBody = s => (req,res,next) => { const r=s.safeParse(req.body); if(!r.success) return res.status(400).json({success:false,message:r.error.errors.map(e=>e.message).join('；'),data:null}); req.body=r.data; next() }

// 价格表列表
router.get('/', requirePermission(PERMISSIONS.PRICE_LIST_VIEW), ctrl.list)

// 价格表明细（含商品价格）
router.get('/:id/items', requirePermission(PERMISSIONS.PRICE_LIST_VIEW), ctrl.listItems)

// 查询某客户对某商品的定价（下销售单时调用）
router.get('/customer-price', requirePermission(PERMISSIONS.PRICE_LIST_VIEW), ctrl.getCustomerPrice)

// 创建价格表
router.post('/', requirePermission(PERMISSIONS.PRICE_LIST_CREATE), vBody(z.object({ name:z.string().min(1), remark:z.string().optional() })), ctrl.create)

// 批量更新价格表明细（覆盖写入）
router.put('/:id/items', requirePermission(PERMISSIONS.PRICE_LIST_UPDATE), ctrl.updateItems)

// 更新价格表基本信息
router.put('/:id', requirePermission(PERMISSIONS.PRICE_LIST_UPDATE), vBody(z.object({ name:z.string().min(1).optional(), remark:z.string().optional(), isActive:z.boolean().optional() })), ctrl.update)

// 删除价格表
router.delete('/:id', requirePermission(PERMISSIONS.PRICE_LIST_DELETE), ctrl.remove)

// 更新客户关联的价格表
router.put('/bind-customer', requirePermission(PERMISSIONS.PRICE_LIST_UPDATE), ctrl.bindCustomer)

module.exports = router
