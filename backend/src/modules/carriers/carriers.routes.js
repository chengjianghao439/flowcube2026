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
  shippingProduct: optStr(32),
  shippingDeliveryType: optStr(8),
})

const updateSchema = createSchema.extend({
  isActive: z.boolean(),
})

const bindingSchema = z.union([z.object({ action: z.enum(['pause', 'unbind']), revision: z.string().regex(/^[a-f0-9]{64}$/) }).strict(), z.object({
  platformCode: z.enum(['sf', 'deppon']),
  monthlyAccount: z.string().trim().max(32).regex(/^[A-Za-z0-9_-]*$/, '请填写月结账号，不要填写手机号或密码'),
  shippingProduct: z.string().trim().max(32),
  shippingDeliveryType: z.enum(['', '1', '3', '4']),
  enabled: z.boolean(),
  revision: z.string().regex(/^[a-f0-9]{64}$/),
}).strict()])
const newAccountSchema = z.object({
  name: z.string().trim().min(1).max(10, '账号名称最多10个字符'),
  platformCode: z.enum(['sf', 'deppon']),
  monthlyAccount: z.string().trim().min(1).max(32).regex(/^[A-Za-z0-9_-]+$/, '请填写月结账号'),
}).strict()
router.use(authMiddleware)
router.post('/account-bindings', requirePermission(PERMISSIONS.CARRIER_CREATE), validateBody(newAccountSchema), ctrl.createAccountBinding)
router.get('/:id/account-binding', requirePermission(PERMISSIONS.CARRIER_VIEW), ctrl.accountBinding)
router.put('/:id/account-binding', requirePermission(PERMISSIONS.CARRIER_UPDATE), validateBody(bindingSchema), ctrl.saveAccountBinding)

router.get('/active', requirePermission(PERMISSIONS.CARRIER_VIEW), ctrl.listActive)
router.get('/',        requirePermission(PERMISSIONS.CARRIER_VIEW), ctrl.list)
router.get('/:id',     requirePermission(PERMISSIONS.CARRIER_VIEW), ctrl.detail)
router.post('/',       requirePermission(PERMISSIONS.CARRIER_CREATE), validateBody(createSchema), ctrl.create)
router.put('/:id',     requirePermission(PERMISSIONS.CARRIER_UPDATE), validateBody(updateSchema), ctrl.update)
router.delete('/:id',  requirePermission(PERMISSIONS.CARRIER_DELETE), ctrl.remove)

module.exports = router
