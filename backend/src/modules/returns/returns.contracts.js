'use strict'
const {z}=require('zod')
const {modelSchema}=require('../sale/sale.contracts')
const {hasTooManyDecimals}=require('../../utils/qtyPrecision')
const returnItemSchema=z.object({sourceItemId:z.number().int().positive().optional(),productId:z.number().int().positive(),productCode:z.string(),productName:z.string(),articleNumber:z.string().optional().nullable(),spec:z.string().optional().nullable(),color:z.string().optional().nullable(),unit:z.string(),entryUnit:z.string().optional(),quantity:z.number().positive(),unitPrice:z.number().nonnegative()})
const ordinarySaleReturnSchema=z.object({customerId:z.number().int().positive(),customerName:z.string(),warehouseId:z.number().int().positive(),warehouseName:z.string(),saleOrderId:z.number().int().positive().optional(),saleOrderNo:z.string().optional(),remark:z.string().optional(),items:z.array(returnItemSchema).min(1)})
const sourceReturnItemSchema=returnItemSchema.extend({sourceItemId:z.number().int().positive(),commercialComponentId:z.number().int().positive(),dispatchComponentId:z.number().int().positive(),quantity:z.number().positive().refine(q=>!hasTooManyDecimals(q),'退货数量最多保留两位小数')}).strict()
const commercialSaleReturnSchema=ordinarySaleReturnSchema.extend({commercialModel:z.literal('kit-v1'),expectedRevision:z.number().int().positive(),saleOrderId:z.number().int().positive(),items:z.array(sourceReturnItemSchema).min(1).max(200)}).strict()
const saleReturnSchema=modelSchema(ordinarySaleReturnSchema,commercialSaleReturnSchema)
module.exports={returnItemSchema,ordinarySaleReturnSchema,saleReturnSchema}
