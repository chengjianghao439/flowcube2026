const { successResponse } = require('../../utils/response')
const searchService = require('./search.service')

async function searchGlobal(req, res, next) {
  try {
    const result = await searchService.searchGlobal(req.query.q)
    return successResponse(res, result.data, result.message)
  } catch (error) {
    next(error)
  }
}

module.exports = {
  searchGlobal,
}
