const svc = require('./portal.service')
const { successResponse } = require('../../utils/response')

const statements = async (req, res, next) => {
  try {
    const data = await svc.listStatements({
      customerId: req.query.customerId,
      page: +req.query.page || 1,
      pageSize: +req.query.pageSize || 20,
    })
    return successResponse(res, data, '查询成功')
  } catch (e) { next(e) }
}

module.exports = { statements }
