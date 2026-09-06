const { successResponse } = require('../../utils/response')
const service = require('./document-activity.service')
async function detail(req, res, next) {
  try { return successResponse(res, await service.getActivity(req.params.type, Number(req.params.id), req.user), '查询成功') }
  catch (error) { next(error) }
}
module.exports = { detail }
