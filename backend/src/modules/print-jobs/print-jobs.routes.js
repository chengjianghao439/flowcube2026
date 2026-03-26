const { Router } = require('express')
const { z } = require('zod')
const ctrl = require('./print-jobs.controller')
const { authMiddleware, permissionMiddleware } = require('../../middleware/auth')
const { loadRolePermissions } = require('../../middleware/loadRolePermissions')
const {
  validateListenStationClientId,
  validateListenPrinterCode,
  validateJobPrinterHeader,
} = require('./print-jobs.middleware')

const router = Router()

function validateBody(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body)
    if (!result.success) {
      const message = result.error.errors.map((e) => e.message).join('；')
      return res.status(400).json({ success: false, message, data: null })
    }
    req.body = result.data
    next()
  }
}

const nullableInt = z.union([z.coerce.number().int().min(1).max(10_000_000), z.null()])
const rate01 = z.union([z.coerce.number().min(0).max(1), z.null()])
const coeff = z.union([z.coerce.number().min(0).max(20), z.null()])
const tenantSettingsPutSchema = z.object({
  tenantId: z.coerce.number().int().min(0).optional(),
  maxQueueJobs: nullableInt.optional(),
  maxConcurrentPrinting: nullableInt.optional(),
  explorationMode: z.enum(['adaptive', 'fixed']).optional(),
  explorationRate: rate01.optional(),
  explorationMin: rate01.optional(),
  explorationMax: rate01.optional(),
  explorationBase: rate01.optional(),
  explorationKErr: coeff.optional(),
  explorationKLat: coeff.optional(),
  explorationLatNormMs: z.union([z.coerce.number().int().min(1000).max(3_600_000), z.null()]).optional(),
  weightErr: coeff.optional(),
  weightLat: coeff.optional(),
  weightHb: coeff.optional(),
  latScoreScaleMs: z.union([z.coerce.number().int().min(1000).max(3_600_000), z.null()]).optional(),
  monthlyPrintQuota: nullableInt.optional(),
  policyTemplate: z.union([z.string().max(32), z.null()]).optional(),
})

const applyTemplateSchema = z.object({
  template: z.enum(['stable', 'speed', 'balanced']),
  tenantId: z.coerce.number().int().min(0).optional(),
})

const printClientPerm = permissionMiddleware('print:client', { superAdminRoleIds: [1] })

// SSE（推荐）：工作站 X-Client-Id，与 printers.client_id 一致，无需 URL 里写打印机编码
router.get(
  '/listen/station',
  authMiddleware,
  loadRolePermissions,
  printClientPerm,
  validateListenStationClientId,
  ctrl.listenStation,
)

// SSE（兼容）：按打印机编码订阅
router.get(
  '/listen/:printerCode',
  authMiddleware,
  loadRolePermissions,
  printClientPerm,
  validateListenPrinterCode,
  ctrl.listen,
)

router.use(authMiddleware)
router.get('/policy-templates', ctrl.policyTemplatesList)
router.post(
  '/tenant-settings/apply-template',
  validateBody(applyTemplateSchema),
  ctrl.tenantSettingsApplyTemplate,
)
router.get('/tenant-billing', ctrl.tenantBilling)
router.get('/alerts', ctrl.alertsList)
router.post('/alerts/:id/ack', ctrl.alertAck)
router.get('/tenant-dashboard', ctrl.tenantDashboard)
router.get('/tenants-overview', ctrl.tenantsOverview)
router.get('/tenant-settings', ctrl.tenantSettingsGet)
router.put('/tenant-settings', validateBody(tenantSettingsPutSchema), ctrl.tenantSettingsPut)
router.get('/', ctrl.list)
router.get('/stats', ctrl.stats)
router.get('/printer-health', ctrl.printerHealth)
router.get('/:id', ctrl.detail)
router.post('/', ctrl.create)
router.post(
  '/:id/complete',
  loadRolePermissions,
  printClientPerm,
  validateJobPrinterHeader,
  ctrl.complete,
)
router.post(
  '/:id/fail',
  loadRolePermissions,
  printClientPerm,
  validateJobPrinterHeader,
  ctrl.fail,
)
router.post('/:id/retry', ctrl.retry)

module.exports = router
