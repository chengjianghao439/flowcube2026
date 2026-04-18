const { Router } = require('express')
const svc = require('./reports.service')
const { successResponse } = require('../../utils/response')
const { authMiddleware, requirePermission } = require('../../middleware/auth')
const { PERMISSIONS } = require('../../constants/permissions')
const router = Router()
router.use(authMiddleware)

const parseQuery = (q) => ({ startDate: q.startDate || null, endDate: q.endDate || null })
const parseReconciliationQuery = (q) => ({
  type: q.type || '1',
  startDate: q.startDate || null,
  endDate: q.endDate || null,
  keyword: q.keyword || '',
  status: q.status || null,
})

router.get('/purchase',        requirePermission(PERMISSIONS.REPORT_VIEW), async (req, res, next) => { try { return successResponse(res, await svc.purchaseStats(parseQuery(req.query)),        '查询成功') } catch (e) { next(e) } })
router.get('/sale',            requirePermission(PERMISSIONS.REPORT_VIEW), async (req, res, next) => { try { return successResponse(res, await svc.saleStats(parseQuery(req.query)),            '查询成功') } catch (e) { next(e) } })
router.get('/inventory',       requirePermission(PERMISSIONS.REPORT_VIEW), async (req, res, next) => { try { return successResponse(res, await svc.inventoryStats(parseQuery(req.query)),       '查询成功') } catch (e) { next(e) } })
router.get('/pda-performance', requirePermission(PERMISSIONS.REPORT_VIEW), async (req, res, next) => { try { return successResponse(res, await svc.pdaPerformance(),                           '查询成功') } catch (e) { next(e) } })
router.get('/wave-performance', requirePermission(PERMISSIONS.REPORT_VIEW), async (req, res, next) => { try { return successResponse(res, await svc.wavePerformance(parseQuery(req.query)),  '查询成功') } catch (e) { next(e) } })
router.get('/warehouse-ops',   requirePermission(PERMISSIONS.REPORT_VIEW), async (req, res, next) => { try { return successResponse(res, await svc.warehouseOps(),                            '查询成功') } catch (e) { next(e) } })
router.get('/role-workbench',  requirePermission(PERMISSIONS.REPORT_VIEW), async (req, res, next) => { try { return successResponse(res, await svc.roleWorkbench(),                           '查询成功') } catch (e) { next(e) } })
router.get('/reconciliation',  requirePermission(PERMISSIONS.REPORT_VIEW), async (req, res, next) => { try { return successResponse(res, await svc.reconciliationReport(parseReconciliationQuery(req.query)), '查询成功') } catch (e) { next(e) } })
router.get('/profit-analysis', requirePermission(PERMISSIONS.REPORT_VIEW), async (req, res, next) => { try { return successResponse(res, await svc.profitAnalysis(parseQuery(req.query)), '查询成功') } catch (e) { next(e) } })

module.exports = router
