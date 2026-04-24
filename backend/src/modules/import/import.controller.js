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
    })
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
}
