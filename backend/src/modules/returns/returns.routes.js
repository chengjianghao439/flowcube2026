const { Router }=require('express'); const {z}=require('zod')
const ctrl=require('./returns.controller')
const {authMiddleware, requirePermission}=require('../../middleware/auth')
const { PERMISSIONS } = require('../../constants/permissions')
const router=Router(); router.use(authMiddleware)
const vBody=s=>(req,res,next)=>{const r=s.safeParse(req.body);if(!r.success)return res.status(400).json({success:false,message:r.error.errors.map(e=>e.message).join('；'),data:null});req.body=r.data;next()}
const vParams=s=>(req,res,next)=>{const r=s.safeParse(req.params);if(!r.success)return res.status(400).json({success:false,message:r.error.errors.map(e=>e.message).join('；'),data:null});req.params=r.data;next()}
const vQuery=s=>(req,res,next)=>{const r=s.safeParse(req.query);if(!r.success)return res.status(400).json({success:false,message:r.error.errors.map(e=>e.message).join('；'),data:null});req.query=r.data;next()}
const idParam=z.object({id:z.coerce.number().int().positive('id 必须为正整数')})
const sourceOrderQuery=z.object({orderNo:z.string().trim().min(1,'原单号不能为空')})
const itemSchema=z.object({sourceItemId:z.number().int().positive().optional(),productId:z.number().int().positive(),productCode:z.string(),productName:z.string(),unit:z.string(),quantity:z.number().positive(),unitPrice:z.number().nonnegative()})
const prSchema=z.object({supplierId:z.number().int().positive(),supplierName:z.string(),warehouseId:z.number().int().positive(),warehouseName:z.string(),purchaseOrderId:z.number().int().positive().optional(),purchaseOrderNo:z.string().optional(),remark:z.string().optional(),items:z.array(itemSchema).min(1)})
const srSchema=z.object({customerId:z.number().int().positive(),customerName:z.string(),warehouseId:z.number().int().positive(),warehouseName:z.string(),saleOrderId:z.number().int().positive().optional(),saleOrderNo:z.string().optional(),remark:z.string().optional(),items:z.array(itemSchema).min(1)})

// 采购退货
router.get('/purchase',              requirePermission(PERMISSIONS.RETURN_ORDER_VIEW), ctrl.listPR)
router.get('/purchase/source-order', requirePermission(PERMISSIONS.RETURN_ORDER_CREATE), vQuery(sourceOrderQuery), ctrl.loadPRSourceOrder)
router.get('/purchase/:id',          requirePermission(PERMISSIONS.RETURN_ORDER_VIEW), vParams(idParam),ctrl.detailPR)
router.post('/purchase',             requirePermission(PERMISSIONS.RETURN_ORDER_CREATE), vBody(prSchema),ctrl.createPR)
router.post('/purchase/:id/confirm', requirePermission(PERMISSIONS.RETURN_ORDER_CONFIRM), vParams(idParam),ctrl.confirmPR)
router.post('/purchase/:id/execute', requirePermission(PERMISSIONS.RETURN_ORDER_EXECUTE), vParams(idParam),ctrl.executePR)
router.post('/purchase/:id/cancel',  requirePermission(PERMISSIONS.RETURN_ORDER_CANCEL), vParams(idParam),ctrl.cancelPR)

// 销售退货
router.get('/sale',              requirePermission(PERMISSIONS.RETURN_ORDER_VIEW), ctrl.listSR)
router.get('/sale/source-order', requirePermission(PERMISSIONS.RETURN_ORDER_CREATE), vQuery(sourceOrderQuery), ctrl.loadSRSsourceOrder)
router.get('/sale/:id',          requirePermission(PERMISSIONS.RETURN_ORDER_VIEW), vParams(idParam),ctrl.detailSR)
router.post('/sale',             requirePermission(PERMISSIONS.RETURN_ORDER_CREATE), vBody(srSchema),ctrl.createSR)
router.post('/sale/:id/confirm', requirePermission(PERMISSIONS.RETURN_ORDER_CONFIRM), vParams(idParam),ctrl.confirmSR)
router.post('/sale/:id/execute', requirePermission(PERMISSIONS.RETURN_ORDER_EXECUTE), vParams(idParam),ctrl.executeSR)
router.post('/sale/:id/cancel',  requirePermission(PERMISSIONS.RETURN_ORDER_CANCEL), vParams(idParam),ctrl.cancelSR)

module.exports=router
