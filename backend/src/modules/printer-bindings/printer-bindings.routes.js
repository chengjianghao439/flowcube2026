/**
 * printer-bindings.routes.js
 * GET  /api/printer-bindings       — 获取所有绑定
 * PUT  /api/printer-bindings/:type — 设置某类型绑定
 * DELETE /api/printer-bindings/:type — 解除绑定
 */
const { Router } = require('express')
const { z } = require('zod')
const ctrl = require('./printer-bindings.controller')
const { authMiddleware, requirePermission } = require('../../middleware/auth')
const { PERMISSIONS } = require('../../constants/permissions')
const { validateBody, validateParams, validateQuery } = require('../../utils/route')
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

router.get('/', requirePermission(PERMISSIONS.PRINT_PRINTER_VIEW), ctrl.list)

router.put('/:type', requirePermission(PERMISSIONS.PRINT_PRINTER_MANAGE), validateParams(typeParamSchema), validateBody(bindBodySchema), ctrl.bind)

router.delete('/:type', requirePermission(PERMISSIONS.PRINT_PRINTER_MANAGE), validateParams(typeParamSchema), validateQuery(unbindQuerySchema), ctrl.unbind)

module.exports = router
