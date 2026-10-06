'use strict'
const { z } = require('zod')
const AppError = require('../../utils/AppError')
const rules = require('./disposal.handling.rules')
const disposalSourceSchema = z.object({
  sourceId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  expectedRevision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  operationUuid: z.string().regex(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i),
}).strict()
function validateReference(value) {
  const parsed = disposalSourceSchema.safeParse(value)
  if (!parsed.success) throw new AppError('处理来源身份必须完整且不可夹带其他字段', 400, 'DISPOSAL_HANDLING_INPUT_INVALID')
  return { ...parsed.data, operationUuid: rules.uuid(parsed.data.operationUuid) }
}
function assertNoSource(body) {
  if (body && Object.hasOwn(body, 'disposalSource')) throw new AppError('处理来源只允许在普通目标创建时绑定，不能编辑或改单重绑', 400, 'DISPOSAL_HANDLING_INPUT_INVALID')
}
function rejectSource(req, _res, next) {
  try { assertNoSource(req.body); next() } catch (error) { next(error) }
}
module.exports = { disposalSourceSchema, validateReference, assertNoSource, rejectSource }
