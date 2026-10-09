const { z } = require('zod')
const AppError = require('../../utils/AppError')

const { hasTooManyDecimals } = require('../../utils/qtyPrecision')

const positiveQty = z.number()
  .positive('数量必须大于0')
  .refine(value => !hasTooManyDecimals(value), '数量最多保留 2 位小数')

const saleItemSchema = z.object({
  productId: z.number().int().positive(),
  productCode: z.string(),
  productName: z.string(),
  articleNumber: z.string().optional().nullable(),
  spec: z.string().optional().nullable(),
  color: z.string().optional().nullable(),
  unit: z.string(),
  entryUnit: z.string().max(20).optional().nullable(),
  quantity: positiveQty,
  unitPrice: z.number().positive('单价必须大于0'),
  warehouseId: z.number().int().positive().optional().nullable(),
  warehouseName: z.string().optional().nullable(),
  remark: z.string().max(200).optional(),
  priceSource: z.enum(['list', 'default', 'manual']).optional(),
  resolvedPrice: z.number().positive('成交价必须大于0').optional().nullable(),
  resolvedPriceLevel: z.string().max(10).optional().nullable(),
  costPrice: z.number().nonnegative().optional().nullable(),
})

const salePhoneRule = z.string()
  .max(30, '联系电话最多 30 个字符')
  .regex(/^(?:|[0-9+()\-\s]{3,30})$/, '联系电话格式不正确')
  .optional()
  .or(z.literal(''))

const ordinaryCreateSaleSchema = z.object({
  expectedEditFingerprint: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  customerId: z.number().int().positive('请选择客户'),
  customerName: z.string(),
  warehouseId: z.number().int().positive('请选择仓库'),
  warehouseName: z.string(),
  discountAmount: z.number().nonnegative('折扣金额不能为负').optional(),
  remark: z.string().max(200).optional(),
  carrierId: z.number().int().positive().optional().nullable(),
  carrier: z.string().optional(),
  shippingProduct: z.string().max(32).optional().nullable(),
  freightType: z.number().int().min(1).max(3).optional().nullable(),
  receiverName: z.string().max(30, '收货人最多 30 个字符').optional(),
  receiverPhone: salePhoneRule,
  receiverAddress: z.string().max(200, '收货地址最多 200 个字符').optional(),
  items: z.array(saleItemSchema).min(1, '至少添加一条明细').max(200, '销售单最多 200 条明细'),
})

const ordinaryReserveSaleSchema = z.object({
  confirmCreditOverride: z.boolean().optional(),
  items: z.array(z.object({
    id: z.number().int().positive(),
    warehouseId: z.number().int().positive(),
    warehouseName: z.string(),
    qty: positiveQty,
  })).optional(),
})

const ordinaryReleaseSaleSchema = z.object({
  items: z.array(z.object({
    id: z.number().int().positive(),
    qty: positiveQty,
  })).optional(),
})

const ordinaryShipSaleSchema = z.object({
  items: z.array(z.object({ id: z.number().int().positive(), qty: positiveQty })).optional(),
  itemIds: z.array(z.number().int().positive()).optional(),
}).refine(value => !(value.items?.length && value.itemIds?.length), {
  message: 'items 与 itemIds 不能同时提交',
})

const commercialGroupSchema=z.discriminatedUnion('kind',[
  z.object({kind:z.literal('kit'),lineKey:z.string().min(1).max(80),warehouseId:z.number().int().positive().optional(),kitVersionId:z.number().int().positive(),quantity:positiveQty.refine(Number.isSafeInteger,'套数须为整数'),unitPrice:z.number().nonnegative().optional(),priceSource:z.enum(['kit_default','manual']),remark:z.string().max(200).optional()}).strict(),
  z.object({kind:z.literal('ordinary'),lineKey:z.string().min(1).max(80),warehouseId:z.number().int().positive().optional(),productId:z.number().int().positive(),entryUnit:z.string().max(20).optional().nullable(),quantity:positiveQty,unitPrice:z.number().positive().optional(),priceSource:z.enum(['default','list','manual']),remark:z.string().max(200).optional()}).strict(),
])
const commercialCreateSaleSchema=ordinaryCreateSaleSchema.omit({items:true}).extend({customerName:z.string().optional(),warehouseName:z.string().optional(),commercialModel:z.literal('kit-v1'),expectedRevision:z.number().int().nonnegative().optional(),commercialGroups:z.array(commercialGroupSchema).min(1).max(200)}).strict()
const commercialPreviewSchema=commercialCreateSaleSchema.extend({expectedRevision:z.number().int().nonnegative()})
const commercialMarker={commercialModel:z.literal('kit-v1'),expectedRevision:z.number().int().positive()}
// Inspect the raw marker before an ordinary object schema can strip it.
function modelSchema(ordinary,commercial){return z.any().transform((raw,ctx)=>{if(raw?.commercialModel===undefined&&(raw?.commercialGroups!==undefined||raw?.groups!==undefined)){ctx.addIssue({code:z.ZodIssueCode.custom,message:'当前客户端暂不能处理套单，请先保留输入并更新客户端'});return z.NEVER}const schema=raw?.commercialModel===undefined?ordinary:commercial;const parsed=schema.safeParse(raw);if(!parsed.success){for(const e of parsed.error.issues)ctx.addIssue(e);return z.NEVER}return parsed.data})}
const createSaleSchema=modelSchema(ordinaryCreateSaleSchema.extend({disposalSource:require('../disposal/disposal.handling.contracts').disposalSourceSchema.optional()}),commercialCreateSaleSchema)
const reserveSaleSchema=modelSchema(ordinaryReserveSaleSchema,ordinaryReserveSaleSchema.extend(commercialMarker).strict())
const releaseSaleSchema=modelSchema(ordinaryReleaseSaleSchema,ordinaryReleaseSaleSchema.extend(commercialMarker).strict())
const shipSaleSchema=modelSchema(ordinaryShipSaleSchema,z.object({...commercialMarker,groups:z.array(z.object({groupId:z.number().int().positive(),qty:positiveQty}).strict()).min(1).max(200)}).strict())
const commercialActionSchema=modelSchema(z.object({}).default({}),z.object(commercialMarker).strict())

function getNetOrderAmount(totalAmount, discountAmount) {
  const gross = Math.max(0, Number(totalAmount) || 0)
  const discount = Math.max(0, Number(discountAmount) || 0)
  return Math.round(Math.max(0, gross - discount) * 10000) / 10000
}

function assertDiscountWithinTotal(discountAmount, totalAmount) {
  if (Number(discountAmount || 0) > Number(totalAmount) + 1e-6) {
    throw new AppError('折扣金额不能超过订单合计', 400, 'SALE_DISCOUNT_EXCEEDS_TOTAL')
  }
}

function saleOperationAction(action, saleOrderId) {
  const id = Number(saleOrderId)
  if (!Number.isInteger(id) || id <= 0) throw new AppError('销售单 ID 无效', 400)
  return `sale.${action}:${id}`
}

function isApprovedOverrideApplicable(approved, current) {
  if (!approved || !current) return false
  const sameMoney = (left, right) => Math.abs(Number(left) - Number(right)) <= 0.005
  return Number(approved.customer_id) === Number(current.customerId)
    && sameMoney(approved.credit_limit, current.creditLimit)
    && sameMoney(approved.this_amount, current.thisAmount)
    && Number(approved.over_amount) + 0.005 >= Number(current.overAmount)
}

function getOutstandingOrderAmount(totalAmount, discountAmount, paidAmount) {
  const net = getNetOrderAmount(totalAmount, discountAmount)
  const paid = Math.max(0, Number(paidAmount) || 0)
  return Math.round(Math.max(0, net - paid) * 10000) / 10000
}

function calculateDiscountApplied({ discount, shippedGross, orderGross }) {
  const d = Math.max(0, Number(discount) || 0)
  const shipped = Math.max(0, Number(shippedGross) || 0)
  const ordered = Math.max(0, Number(orderGross) || 0)
  if (!d || !shipped || !ordered) return 0
  return Math.round(Math.min(d, d * shipped / ordered) * 10000) / 10000
}

function scansForSaleItem(scans, tasks, item) {
  const taskIds = new Set(tasks
    .filter(task => Number(task.warehouseId) === Number(item.warehouseId))
    .map(task => Number(task.taskId)))
  return scans.filter(scan => taskIds.has(Number(scan.task_id)) && Number(scan.product_id) === Number(item.productId))
}

function selectDispatchRows(allRows, { items = null, itemIds = null } = {}) {
  let rows = [...allRows]
  if (Array.isArray(items) && items.length) {
    const requestedById = new Map()
    for (const item of items) {
      const id = Number(item.id)
      if (requestedById.has(id)) throw new AppError(`明细行 ${id} 重复提交`, 400)
      requestedById.set(id, Number(item.qty))
    }
    rows = rows.filter(row => requestedById.has(Number(row.id)))
    if (rows.length !== requestedById.size) throw new AppError('部分明细不存在或不可发货，请刷新订单后重试', 409)
    if (!rows.length) throw new AppError('选中的明细行均已发货，无可发货项', 400)
    return rows.map(row => {
      const available = Number(row.reserved_qty) - Number(row.dispatched_qty)
      const qty = requestedById.get(Number(row.id))
      if (!(qty > 0) || qty > available + 1e-6) {
        throw new AppError(`商品「${row.product_name}」本次发货量不能超过已占未发量 ${available}`, 400)
      }
      return { ...row, requested_ship_qty: qty }
    })
  }
  if (Array.isArray(itemIds) && itemIds.length) {
    const wanted = new Set(itemIds.map(Number))
    rows = rows.filter(row => wanted.has(Number(row.id)))
    if (rows.length !== wanted.size) throw new AppError('部分明细不存在或不可发货，请刷新订单后重试', 409)
    if (!rows.length) throw new AppError('选中的明细行均已发货，无可发货项', 400)
  }
  return rows.map(row => ({
    ...row,
    requested_ship_qty: Number(row.reserved_qty) - Number(row.dispatched_qty),
  }))
}

module.exports = {
  modelSchema,
  ordinaryCreateSaleSchema, ordinaryReserveSaleSchema, ordinaryReleaseSaleSchema, ordinaryShipSaleSchema,
  commercialActionSchema,
  commercialCreateSaleSchema,
  commercialPreviewSchema,
  saleItemSchema,
  createSaleSchema,
  reserveSaleSchema,
  releaseSaleSchema,
  shipSaleSchema,
  getNetOrderAmount,
  assertDiscountWithinTotal,
  saleOperationAction,
  isApprovedOverrideApplicable,
  getOutstandingOrderAmount,
  calculateDiscountApplied,
  scansForSaleItem,
  selectDispatchRows,
}
