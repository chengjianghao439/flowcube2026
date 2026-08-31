const { successResponse } = require('../../utils/response')
const AppError = require('../../utils/AppError')
const importService = require('./import.service')
const { getOperatorFromRequest } = require('../../utils/operator')

function sendWorkbook(res, { filename, buffer }) {
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`)
  res.send(buffer)
}

async function downloadProductTemplate(req, res, next) {
  try {
    const workbook = await importService.buildProductTemplate()
    sendWorkbook(res, workbook)
  } catch (error) {
    next(error)
  }
}

async function importProducts(req, res, next) {
  try {
    if (!req.file) throw new AppError('请上传文件', 400)
    const result = await importService.importProducts({ fileBuffer: req.file.buffer })
    return successResponse(res, result.data, result.message)
  } catch (error) {
    next(error)
  }
}

async function downloadStockTemplate(req, res, next) {
  try {
    const workbook = await importService.buildStockTemplate()
    sendWorkbook(res, workbook)
  } catch (error) {
    next(error)
  }
}

async function importStock(req, res, next) {
  try {
    if (!req.file) throw new AppError('请上传文件', 400)
    const result = await importService.importStock({
      fileBuffer: req.file.buffer,
      originalName: req.file.originalname,
      operator: getOperatorFromRequest(req),
      scopeWarehouseIds: req.user?.warehouseIds ?? null,
    })
    return successResponse(res, result.data, result.message)
  } catch (error) {
    next(error)
  }
}

async function downloadCustomerTemplate(req, res, next) {
  try {
    const workbook = await importService.buildCustomerTemplate()
    sendWorkbook(res, workbook)
  } catch (error) {
    next(error)
  }
}

async function importCustomers(req, res, next) {
  try {
    if (!req.file) throw new AppError('请上传文件', 400)
    const result = await importService.importCustomers({ fileBuffer: req.file.buffer })
    return successResponse(res, result.data, result.message)
  } catch (error) {
    next(error)
  }
}

async function downloadPriceListTemplate(req, res, next) {
  try {
    const workbook = await importService.buildPriceListTemplate()
    sendWorkbook(res, workbook)
  } catch (error) {
    next(error)
  }
}

async function importPriceListItems(req, res, next) {
  try {
    if (!req.file) throw new AppError('请上传文件', 400)
    const result = await importService.importPriceListItems({ fileBuffer: req.file.buffer })
    return successResponse(res, result.data, result.message)
  } catch (error) {
    next(error)
  }
}

async function downloadSupplierTemplate(req, res, next) {
  try {
    const workbook = await importService.buildSupplierTemplate()
    sendWorkbook(res, workbook)
  } catch (error) {
    next(error)
  }
}

async function importSuppliers(req, res, next) {
  try {
    if (!req.file) throw new AppError('请上传文件', 400)
    const result = await importService.importSuppliers({ fileBuffer: req.file.buffer })
    return successResponse(res, result.data, result.message)
  } catch (error) {
    next(error)
  }
}

module.exports = {
  downloadProductTemplate,
  importProducts,
  downloadStockTemplate,
  importStock,
  downloadCustomerTemplate,
  importCustomers,
  downloadSupplierTemplate,
  importSuppliers,
  downloadPriceListTemplate,
  importPriceListItems,
}
