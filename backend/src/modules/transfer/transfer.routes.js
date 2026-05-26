const {Router}=require('express'); const {z}=require('zod')
const ctrl=require('./transfer.controller')
const {authMiddleware, requirePermission}=require('../../middleware/auth')
const { PERMISSIONS } = require('../../constants/permissions')
const router=Router(); router.use(authMiddleware)
const vBody=s=>(req,res,next)=>{const r=s.safeParse(req.body);if(!r.success)return res.status(400).json({success:false,message:r.error.errors.map(e=>e.message).join('；'),data:null});req.body=r.data;next()}
const vParams=s=>(req,res,next)=>{const r=s.safeParse(req.params);if(!r.success)return res.status(400).json({success:false,message:r.error.errors.map(e=>e.message).join('；'),data:null});req.params=r.data;next()}
const idParam=z.object({id:z.coerce.number().int().positive('id 必须为正整数')})
const itemSchema=z.object({productId:z.number().int().positive(),productCode:z.string(),productName:z.string(),unit:z.string(),quantity:z.number().positive('数量必须大于0'),remark:z.string().optional()})
const createSchema=z.object({fromWarehouseId:z.number().int().positive('请选择源仓库'),fromWarehouseName:z.string(),toWarehouseId:z.number().int().positive('请选择目标仓库'),toWarehouseName:z.string(),remark:z.string().optional(),items:z.array(itemSchema).min(1,'至少添加一条明细')})
router.get('/',              requirePermission(PERMISSIONS.TRANSFER_ORDER_VIEW), ctrl.list)
router.get('/:id',           requirePermission(PERMISSIONS.TRANSFER_ORDER_VIEW), vParams(idParam),ctrl.detail)
router.post('/',             requirePermission(PERMISSIONS.TRANSFER_ORDER_CREATE), vBody(createSchema),ctrl.create)
router.post('/:id/confirm',  requirePermission(PERMISSIONS.TRANSFER_ORDER_CONFIRM), vParams(idParam),ctrl.confirm)
router.post('/:id/execute',  requirePermission(PERMISSIONS.TRANSFER_ORDER_EXECUTE), vParams(idParam),ctrl.execute)
router.post('/:id/cancel',   requirePermission(PERMISSIONS.TRANSFER_ORDER_CANCEL), vParams(idParam),ctrl.cancel)
module.exports=router
