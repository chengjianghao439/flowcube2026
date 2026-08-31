const { Router } = require('express')
const multer = require('multer')
const { authMiddleware, requirePermission } = require('../../middleware/auth')
const { PERMISSIONS } = require('../../constants/permissions')
const controller = require('./import.controller')

const router = Router()
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
      'text/csv',
    ]
    if (allowed.includes(file.mimetype)) {
      cb(null, true)
    } else {
      cb(new Error('仅支持 Excel (.xlsx/.xls) 或 CSV 文件'))
    }
  },
})

router.use(authMiddleware)

router.get('/products/template', requirePermission(PERMISSIONS.IMPORT_PRODUCT_EXECUTE), controller.downloadProductTemplate)
router.post('/products', requirePermission(PERMISSIONS.IMPORT_PRODUCT_EXECUTE), upload.single('file'), controller.importProducts)
router.get('/stock/template', requirePermission(PERMISSIONS.IMPORT_STOCK_EXECUTE), controller.downloadStockTemplate)
router.post('/stock', requirePermission(PERMISSIONS.IMPORT_STOCK_EXECUTE), upload.single('file'), controller.importStock)
// 客户导入：复用客户创建权限；价格表明细导入：复用价格表更新权限（均为写操作，语义一致）
router.get('/customers/template', requirePermission(PERMISSIONS.CUSTOMER_CREATE), controller.downloadCustomerTemplate)
router.post('/customers', requirePermission(PERMISSIONS.CUSTOMER_CREATE), upload.single('file'), controller.importCustomers)
router.get('/price-list-items/template', requirePermission(PERMISSIONS.PRICE_LIST_UPDATE), controller.downloadPriceListTemplate)
router.post('/price-list-items', requirePermission(PERMISSIONS.PRICE_LIST_UPDATE), upload.single('file'), controller.importPriceListItems)
// 供应商导入：复用供应商创建权限
router.get('/suppliers/template', requirePermission(PERMISSIONS.SUPPLIER_CREATE), controller.downloadSupplierTemplate)
router.post('/suppliers', requirePermission(PERMISSIONS.SUPPLIER_CREATE), upload.single('file'), controller.importSuppliers)

module.exports = router
