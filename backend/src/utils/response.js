/**
 * 统一成功响应
 * @param {import('express').Response} res
 * @param {unknown} data
 * @param {string} message
 * @param {number} statusCode
 */
function successResponse(res, data = null, message = '操作成功', statusCode = 200) {
  return res.status(statusCode).json({
    success: true,
    message,
    data,
  })
}

/**
 * 统一失败响应（仅在全局错误中间件中使用，业务代码不直接调用）
 * @param {import('express').Response} res
 * @param {string} message
 * @param {number} statusCode
 */
function errorResponse(res, message = '操作失败', statusCode = 400) {
  return res.status(statusCode).json({
    success: false,
    message,
    data: null,
  })
}

module.exports = { successResponse, errorResponse }
