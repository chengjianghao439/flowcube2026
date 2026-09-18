const { Router } = require('express')
const { z } = require('zod')
const ctrl = require('./printers.controller')
const { authMiddleware, requirePermission } = require('../../middleware/auth')
const { PERMISSIONS } = require('../../constants/permissions')
const { validateBody } = require('../../utils/route')

const router = Router()

/**
 * PUT /:id 的请求体校验（2026-09-18 审计 [34]）。
 * 原先这个路由**完全没有校验**，`status` 可以是任意值、`code/type`（NOT NULL 列）可以是 undefined。
 * 注意保持非 strict：前端切换启用状态时会把整份 Printer 对象回传
 * （`{...p, status}` 带 id/typeName/createdAt 等展示字段），strict 会把这些全部拒掉。
 * 未知字段由 zod 默认丢弃，不会进 SQL。
 */
const updateSchema = z.object({
  name:        z.string().trim().min(1, '名称不能为空').max(100).optional(),
  code:        z.string().trim().min(1, '编码不能为空').max(50).optional(),
  type:        z.number().int().min(0).max(9).optional(),
  description: z.string().max(200).optional().nullable(),
  status:      z.union([z.literal(0), z.literal(1)]).optional(),
  warehouseId: z.union([z.number().int().positive(), z.string(), z.null()]).optional(),
  clientId:    z.union([z.string().max(200), z.null()]).optional(),
})

router.use(authMiddleware)
router.post('/client-heartbeat', requirePermission(PERMISSIONS.PRINT_CLIENT_CONSUME), ctrl.heartbeatClient)
router.get('/online-clients', requirePermission(PERMISSIONS.PRINT_PRINTER_VIEW), ctrl.listOnlineClients)
router.get('/all-clients', requirePermission(PERMISSIONS.PRINT_PRINTER_VIEW), ctrl.listAllClients)
router.put('/clients/:clientId/alias', requirePermission(PERMISSIONS.PRINT_PRINTER_MANAGE), ctrl.updateClientAlias)
router.get('/', requirePermission(PERMISSIONS.PRINT_PRINTER_VIEW), ctrl.list)
router.get('/:id', requirePermission(PERMISSIONS.PRINT_PRINTER_VIEW), ctrl.detail)
router.post('/', requirePermission(PERMISSIONS.PRINT_PRINTER_MANAGE), ctrl.create)
router.put('/:id', requirePermission(PERMISSIONS.PRINT_PRINTER_MANAGE), validateBody(updateSchema), ctrl.update)
router.delete('/:id', requirePermission(PERMISSIONS.PRINT_PRINTER_MANAGE), ctrl.remove)
module.exports = router
