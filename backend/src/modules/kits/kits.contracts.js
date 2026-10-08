'use strict'
const { z } = require('zod')
const id = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
const component = z.object({ productId: id, baseQty: z.number().finite(), amountWeight: z.number().finite().optional() }).strict()
const optionalPrice = z.number().finite().nullable().optional()
// Profile fields may be omitted by old clients. The new editor requires the full product profile.
const definition = z.object({
  code: z.string().trim().min(1).max(50).optional(),
  name: z.string().trim().min(1).max(150),
  categoryId: id.nullable().optional(), supplierId: id.nullable().optional(),
  unit: z.string().trim().min(1).max(20).optional(),
  spec: z.string().trim().min(1).max(200).optional(),
  color: z.string().trim().min(1).max(60).optional(),
  articleNumber: z.string().trim().max(100).optional(),
  costPrice: z.number().finite().positive().optional(),
  remark: z.string().trim().max(30).optional(),
  isActive: z.boolean().optional(), referenceUnitPrice: z.number().finite().optional(),
  salePriceA: optionalPrice, salePriceB: optionalPrice, salePriceC: optionalPrice, salePriceD: optionalPrice,
  components: z.array(component),
}).strict()
const edit = definition.partial().extend({ revision: id }).strict()
const remove = z.object({ revision: id }).strict()
const common = { lineKey: z.string().trim().min(1).max(100), quantity: z.number().finite(), unitPrice: z.number().finite().optional() }
const kitGroup = z.object({ ...common, kind: z.literal('kit'), kitVersionId: id, priceSource: z.enum(['kit_default', 'manual']) }).strict()
const ordinaryGroup = z.object({ ...common, kind: z.literal('ordinary'), productId: id, entryUnit:z.string().max(20).optional().nullable(),priceSource: z.enum(['default', 'manual']) }).strict()
const preview = z.object({ customerId: id, warehouseId: id, groups: z.array(z.discriminatedUnion('kind', [kitGroup, ordinaryGroup])).min(1).max(200) }).strict()
const queryId = z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER)
const listQuery = z.object({ page: z.coerce.number().finite().int().positive().max(100000).default(1), pageSize: z.coerce.number().int().positive().max(100).default(20), keyword: z.string().max(100).default('') }).strict()
const finderQuery = listQuery.extend({ warehouseId: queryId })
const detailQuery = z.object({ versionId: queryId.optional() }).strict()
const params = z.object({ id: queryId }).strict()
module.exports = { definition, edit, remove, preview, listQuery, finderQuery, detailQuery, params }
