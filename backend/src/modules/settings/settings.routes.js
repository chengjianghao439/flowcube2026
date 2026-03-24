const { Router } = require('express')
const svc = require('./settings.service')
const { successResponse } = require('../../utils/response')
const { authMiddleware } = require('../../middleware/auth')
const router = Router()
router.use(authMiddleware)
router.get('/', async (req, res, next) => {
  try { return successResponse(res, await svc.getAll(), '查询成功') } catch (e) { next(e) }
})
router.put('/', async (req, res, next) => {
  try {
    if (req.user.roleId !== 1) return res.status(403).json({ success: false, message: '无权修改系统设置', data: null })
    await svc.updateMany(req.body)
    return successResponse(res, null, '保存成功')
  } catch (e) { next(e) }
})
module.exports = router
