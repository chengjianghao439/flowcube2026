const { Router } = require('express')
const svc = require('./reports.service')
const { successResponse } = require('../../utils/response')
const { authMiddleware } = require('../../middleware/auth')
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

router.get('/purchase',        async (req, res, next) => { try { return successResponse(res, await svc.purchaseStats(parseQuery(req.query)),        '查询成功') } catch (e) { next(e) } })
router.get('/sale',            async (req, res, next) => { try { return successResponse(res, await svc.saleStats(parseQuery(req.query)),            '查询成功') } catch (e) { next(e) } })
router.get('/inventory',       async (req, res, next) => { try { return successResponse(res, await svc.inventoryStats(parseQuery(req.query)),       '查询成功') } catch (e) { next(e) } })
router.get('/pda-performance',  async (req, res, next) => { try { return successResponse(res, await svc.pdaPerformance(),                            '查询成功') } catch (e) { next(e) } })
router.get('/wave-performance', async (req, res, next) => { try { return successResponse(res, await svc.wavePerformance(parseQuery(req.query)),  '查询成功') } catch (e) { next(e) } })
router.get('/warehouse-ops',    async (req, res, next) => { try { return successResponse(res, await svc.warehouseOps(),                             '查询成功') } catch (e) { next(e) } })
router.get('/role-workbench',   async (req, res, next) => { try { return successResponse(res, await svc.roleWorkbench(),                            '查询成功') } catch (e) { next(e) } })
router.get('/reconciliation',   async (req, res, next) => { try { return successResponse(res, await svc.reconciliationReport(parseReconciliationQuery(req.query)), '查询成功') } catch (e) { next(e) } })
router.get('/profit-analysis',  async (req, res, next) => { try { return successResponse(res, await svc.profitAnalysis(parseQuery(req.query)), '查询成功') } catch (e) { next(e) } })

module.exports = router
