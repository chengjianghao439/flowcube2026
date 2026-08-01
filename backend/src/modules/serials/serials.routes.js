const { Router } = require('express')
const { z } = require('zod')
const ctrl = require('./serials.controller')
const { authMiddleware, requirePermission } = require('../../middleware/auth')
const { PERMISSIONS } = require('../../constants/permissions')

const router = Router()
router.use(authMiddleware)

function vBody(schema) {
  return (req, res, next) => {
    const r = schema.safeParse(req.body)
    if (!r.success) return res.status(400).json({ success: false, message: r.error.errors.map(e => e.message).join('；'), data: null })
    req.body = r.data; next()
  }
}

// 历史序列号导入（文档04 Phase2）：为每个在库 ACTIVE 容器逐台补齐 SN，商品级全覆盖
const importSchema = z.object({
  productId: z.number().int().positive('请选择商品'),
  containers: z.array(z.object({
    containerId: z.number().int().positive('容器无效'),
    serialNos: z.array(z.string().trim().min(1, '序列号不能为空')).default([]),
  })).min(1, '请为每个在库容器补齐序列号'),
})

// 固定路径先注册（本模块暂无 /:id 动态路由，但保持约定：固定段在前）
router.get('/trace', requirePermission(PERMISSIONS.SERIAL_VIEW), ctrl.trace)
router.get('/check-consistency', requirePermission(PERMISSIONS.SERIAL_MANAGE), ctrl.checkConsistency)
// 历史导入（一致性修复类接口，用 serial.manage，与 check-consistency 同级）
router.get('/import-candidates', requirePermission(PERMISSIONS.SERIAL_MANAGE), ctrl.importCandidates)
router.post('/import', requirePermission(PERMISSIONS.SERIAL_MANAGE), vBody(importSchema), ctrl.importSerials)
router.get('/', requirePermission(PERMISSIONS.SERIAL_VIEW), ctrl.list)

module.exports = router
