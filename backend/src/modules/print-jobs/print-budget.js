const AppError = require('../../utils/AppError')
const MAX_CONTENT_BYTES = 1024 * 1024
const MAX_EXPANDED_BYTES = 8 * 1024 * 1024

function assertPrintByteBudget(bytes, copies = 1) {
  if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > MAX_CONTENT_BYTES || bytes * copies > MAX_EXPANDED_BYTES) {
    throw new AppError('打印内容超过单份 1 MiB 或整批 8 MiB 限制，请缩小标签内容或减少份数', 400, 'PRINT_CONTENT_BUDGET_EXCEEDED')
  }
}

function assertPrintBudget(content, copies = 1) {
  if (typeof content !== 'string' || typeof copies !== 'number' || !Number.isInteger(copies) || copies < 1 || copies > 100) {
    throw new AppError('打印内容须为文字，打印份数须为 1–100 的整数', 400, 'PRINT_COPIES_INVALID')
  }
  const bytes = Buffer.byteLength(content, 'utf8')
  assertPrintByteBudget(bytes, copies)
  return bytes
}
module.exports = { MAX_CONTENT_BYTES, MAX_EXPANDED_BYTES, assertPrintBudget, assertPrintByteBudget }
