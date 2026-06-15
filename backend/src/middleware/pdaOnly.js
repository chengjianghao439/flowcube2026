const AppError = require('../utils/AppError')

function pdaOnly(req, res, next) {
  const client = (req.headers['x-client'] || '').toLowerCase()
  if (client !== 'pda') {
    return next(new AppError('此操作仅允许 PDA 扫码完成', 403, 'PDA_ONLY'))
  }
  next()
}

module.exports = { pdaOnly }
