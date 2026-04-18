const { Router } = require('express')
const multer = require('multer')
const { authMiddleware, requirePermission } = require('../../middleware/auth')
const { PERMISSIONS } = require('../../constants/permissions')
const controller = require('./import.controller')

const router = Router()
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } })

router.use(authMiddleware)

router.get('/products/template', requirePermission(PERMISSIONS.IMPORT_PRODUCT_EXECUTE), controller.downloadProductTemplate)
router.post('/products', requirePermission(PERMISSIONS.IMPORT_PRODUCT_EXECUTE), upload.single('file'), controller.importProducts)
router.get('/stock/template', requirePermission(PERMISSIONS.IMPORT_STOCK_EXECUTE), controller.downloadStockTemplate)
router.post('/stock', requirePermission(PERMISSIONS.IMPORT_STOCK_EXECUTE), upload.single('file'), controller.importStock)

module.exports = router
