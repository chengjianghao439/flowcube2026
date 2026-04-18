const { Router } = require('express')
const ctrl = require('./locations.controller')
const { authMiddleware, requirePermission } = require('../../middleware/auth')
const { PERMISSIONS } = require('../../constants/permissions')

const router = Router()
router.use(authMiddleware)

router.get('/code/:code', requirePermission(PERMISSIONS.LOCATION_VIEW), ctrl.findByCode)  // 按编码查库位（PDA 扫码用）
router.get('/by-warehouse/:warehouseId', requirePermission(PERMISSIONS.LOCATION_VIEW), ctrl.listByWarehouse)  // 入库任务上架等：按仓库拉库位列表
router.get('/',      requirePermission(PERMISSIONS.LOCATION_VIEW), ctrl.list)
router.get('/:id',   requirePermission(PERMISSIONS.LOCATION_VIEW), ctrl.detail)
router.post('/',     requirePermission(PERMISSIONS.LOCATION_CREATE), ctrl.create)
router.put('/:id',   requirePermission(PERMISSIONS.LOCATION_UPDATE), ctrl.update)
router.delete('/:id', requirePermission(PERMISSIONS.LOCATION_DELETE), ctrl.remove)

module.exports = router
