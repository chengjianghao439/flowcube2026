const { Router } = require('express')
const { z }      = require('zod')
const ctrl       = require('./carriers.controller')
const { authMiddleware, requirePermission } = require('../../middleware/auth')
const { PERMISSIONS } = require('../../constants/permissions')
const { validateBody } = require('../../utils/route')

const router = Router()

const phoneRule = z.string().max(11).regex(/^1\d{10}$/, '请输入正确的手机号').optional().or(z.literal(''))

const optStr = max => z.string().max(max).optional().or(z.literal(''))

const createSchema = z.object({
  code:    z.string().min(1,'编码不能为空').max(30).optional(),
  name:    z.string().min(1,'名称不能为空').max(10,'承运商名称最多 10 个字符'),
  contact: z.string().max(5,'联系人最多 5 个字符').optional(),
  phone:   phoneRule,
  remark:  z.string().max(30,'备注最多 30 个字符').optional(),
  // 电子面单平台对接（文档 06）——全部非敏感项。密钥不经此接口。
  platformCode:    optStr(30),
  platformCarrier: optStr(30),
  monthlyAccount:  optStr(60),
  netSiteCode:     optStr(60),
  credentialRef:   optStr(60),
  waybillEnabled:  z.boolean().optional(),
})

const updateSchema = createSchema.extend({
  isActive: z.boolean(),
})

router.use(authMiddleware)

router.get('/active', requirePermission(PERMISSIONS.CARRIER_VIEW), ctrl.listActive)
router.get('/',        requirePermission(PERMISSIONS.CARRIER_VIEW), ctrl.list)
router.get('/:id',     requirePermission(PERMISSIONS.CARRIER_VIEW), ctrl.detail)
router.post('/',       requirePermission(PERMISSIONS.CARRIER_CREATE), validateBody(createSchema), ctrl.create)
router.put('/:id',     requirePermission(PERMISSIONS.CARRIER_UPDATE), validateBody(updateSchema), ctrl.update)
router.delete('/:id',  requirePermission(PERMISSIONS.CARRIER_DELETE), ctrl.remove)

module.exports = router
