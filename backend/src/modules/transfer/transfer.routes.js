const {Router}=require('express'); const {z}=require('zod')
const svc=require('./transfer.service'); const {successResponse}=require('../../utils/response')
const {authMiddleware, requirePermission}=require('../../middleware/auth')
const { PERMISSIONS } = require('../../constants/permissions')
const { getOperatorFromRequest } = require('../../utils/operator')
const router=Router(); router.use(authMiddleware)
const vBody=s=>(req,res,next)=>{const r=s.safeParse(req.body);if(!r.success)return res.status(400).json({success:false,message:r.error.errors.map(e=>e.message).join('；'),data:null});req.body=r.data;next()}
const vParams=s=>(req,res,next)=>{const r=s.safeParse(req.params);if(!r.success)return res.status(400).json({success:false,message:r.error.errors.map(e=>e.message).join('；'),data:null});req.params=r.data;next()}
const idParam=z.object({id:z.coerce.number().int().positive('id 必须为正整数')})
const itemSchema=z.object({productId:z.number().int().positive(),productCode:z.string(),productName:z.string(),unit:z.string(),quantity:z.number().positive('数量必须大于0'),remark:z.string().optional()})
const createSchema=z.object({fromWarehouseId:z.number().int().positive('请选择源仓库'),fromWarehouseName:z.string(),toWarehouseId:z.number().int().positive('请选择目标仓库'),toWarehouseName:z.string(),remark:z.string().optional(),items:z.array(itemSchema).min(1,'至少添加一条明细')})
router.get('/',              requirePermission(PERMISSIONS.TRANSFER_ORDER_VIEW), async(req,res,next)=>{try{return successResponse(res,await svc.findAll({page:+req.query.page||1,pageSize:+req.query.pageSize||20,keyword:req.query.keyword||'',status:req.query.status?+req.query.status:null}),'查询成功')}catch(e){next(e)}})
router.get('/:id',           requirePermission(PERMISSIONS.TRANSFER_ORDER_VIEW), vParams(idParam),async(req,res,next)=>{try{return successResponse(res,await svc.findById(req.params.id),'查询成功')}catch(e){next(e)}})
router.post('/',             requirePermission(PERMISSIONS.TRANSFER_ORDER_CREATE), vBody(createSchema),async(req,res,next)=>{try{const op=getOperatorFromRequest(req);return successResponse(res,await svc.create({...req.body,operator:op}),'创建成功',201)}catch(e){next(e)}})
router.post('/:id/confirm',  requirePermission(PERMISSIONS.TRANSFER_ORDER_CONFIRM), vParams(idParam),async(req,res,next)=>{try{await svc.confirm(req.params.id, getOperatorFromRequest(req));return successResponse(res,null,'确认成功')}catch(e){next(e)}})
router.post('/:id/execute',  requirePermission(PERMISSIONS.TRANSFER_ORDER_EXECUTE), vParams(idParam),async(req,res,next)=>{try{await svc.execute(req.params.id,getOperatorFromRequest(req));return successResponse(res,null,'调拨执行成功，库存已同步')}catch(e){next(e)}})
router.post('/:id/cancel',   requirePermission(PERMISSIONS.TRANSFER_ORDER_CANCEL), vParams(idParam),async(req,res,next)=>{try{await svc.cancel(req.params.id, getOperatorFromRequest(req));return successResponse(res,null,'已取消')}catch(e){next(e)}})
module.exports=router
