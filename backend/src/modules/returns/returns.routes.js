const { Router }=require('express'); const {z}=require('zod')
const svc=require('./returns.service'); const {successResponse}=require('../../utils/response')
const {authMiddleware, requirePermission}=require('../../middleware/auth'); const {pool}=require('../../config/db')
const { PERMISSIONS } = require('../../constants/permissions')
const router=Router(); router.use(authMiddleware)
const vBody=s=>(req,res,next)=>{const r=s.safeParse(req.body);if(!r.success)return res.status(400).json({success:false,message:r.error.errors.map(e=>e.message).join('；'),data:null});req.body=r.data;next()}
const vParams=s=>(req,res,next)=>{const r=s.safeParse(req.params);if(!r.success)return res.status(400).json({success:false,message:r.error.errors.map(e=>e.message).join('；'),data:null});req.params=r.data;next()}
const idParam=z.object({id:z.coerce.number().int().positive('id 必须为正整数')})
const itemSchema=z.object({productId:z.number().int().positive(),productCode:z.string(),productName:z.string(),unit:z.string(),quantity:z.number().positive(),unitPrice:z.number().nonnegative()})
const prSchema=z.object({supplierId:z.number().int().positive(),supplierName:z.string(),warehouseId:z.number().int().positive(),warehouseName:z.string(),purchaseOrderNo:z.string().optional(),remark:z.string().optional(),items:z.array(itemSchema).min(1)})
const srSchema=z.object({customerId:z.number().int().positive(),customerName:z.string(),warehouseId:z.number().int().positive(),warehouseName:z.string(),saleOrderNo:z.string().optional(),remark:z.string().optional(),items:z.array(itemSchema).min(1)})
async function getOp(userId){const [[u]]=await pool.query('SELECT real_name FROM sys_users WHERE id=?',[userId]);return{userId,realName:u?.real_name||'未知'}}

// 采购退货
router.get('/purchase',              requirePermission(PERMISSIONS.RETURN_ORDER_VIEW), async(req,res,next)=>{try{return successResponse(res,await svc.findAllPR({page:+req.query.page||1,pageSize:+req.query.pageSize||20,keyword:req.query.keyword||'',status:req.query.status?+req.query.status:null}),'查询成功')}catch(e){next(e)}})
router.get('/purchase/:id',          requirePermission(PERMISSIONS.RETURN_ORDER_VIEW), vParams(idParam),async(req,res,next)=>{try{return successResponse(res,await svc.findByIdPR(req.params.id),'查询成功')}catch(e){next(e)}})
router.post('/purchase',             requirePermission(PERMISSIONS.RETURN_ORDER_CREATE), vBody(prSchema),async(req,res,next)=>{try{const op=await getOp(req.user.userId);return successResponse(res,await svc.createPR({...req.body,operator:op}),'创建成功',201)}catch(e){next(e)}})
router.post('/purchase/:id/confirm', requirePermission(PERMISSIONS.RETURN_ORDER_CONFIRM), vParams(idParam),async(req,res,next)=>{try{const [rows]=await pool.query('UPDATE purchase_returns SET status=2 WHERE id=? AND status=1',[req.params.id]);if(!rows.affectedRows)throw new Error('状态错误');return successResponse(res,null,'已确认')}catch(e){next(e)}})
router.post('/purchase/:id/execute', requirePermission(PERMISSIONS.RETURN_ORDER_EXECUTE), vParams(idParam),async(req,res,next)=>{try{await svc.executePR(req.params.id,await getOp(req.user.userId));return successResponse(res,null,'退货执行成功，库存已扣减')}catch(e){next(e)}})
router.post('/purchase/:id/cancel',  requirePermission(PERMISSIONS.RETURN_ORDER_CANCEL), vParams(idParam),async(req,res,next)=>{try{await svc.cancelPR(req.params.id);return successResponse(res,null,'已取消')}catch(e){next(e)}})

// 销售退货
router.get('/sale',              requirePermission(PERMISSIONS.RETURN_ORDER_VIEW), async(req,res,next)=>{try{return successResponse(res,await svc.findAllSR({page:+req.query.page||1,pageSize:+req.query.pageSize||20,keyword:req.query.keyword||'',status:req.query.status?+req.query.status:null}),'查询成功')}catch(e){next(e)}})
router.get('/sale/:id',          requirePermission(PERMISSIONS.RETURN_ORDER_VIEW), vParams(idParam),async(req,res,next)=>{try{return successResponse(res,await svc.findByIdSR(req.params.id),'查询成功')}catch(e){next(e)}})
router.post('/sale',             requirePermission(PERMISSIONS.RETURN_ORDER_CREATE), vBody(srSchema),async(req,res,next)=>{try{const op=await getOp(req.user.userId);return successResponse(res,await svc.createSR({...req.body,operator:op}),'创建成功',201)}catch(e){next(e)}})
router.post('/sale/:id/confirm', requirePermission(PERMISSIONS.RETURN_ORDER_CONFIRM), vParams(idParam),async(req,res,next)=>{try{const [rows]=await pool.query('UPDATE sale_returns SET status=2 WHERE id=? AND status=1',[req.params.id]);if(!rows.affectedRows)throw new Error('状态错误');return successResponse(res,null,'已确认')}catch(e){next(e)}})
router.post('/sale/:id/execute', requirePermission(PERMISSIONS.RETURN_ORDER_EXECUTE), vParams(idParam),async(req,res,next)=>{try{await svc.executeSR(req.params.id,await getOp(req.user.userId));return successResponse(res,null,'退货入库成功，库存已增加')}catch(e){next(e)}})
router.post('/sale/:id/cancel',  requirePermission(PERMISSIONS.RETURN_ORDER_CANCEL), vParams(idParam),async(req,res,next)=>{try{await svc.cancelSR(req.params.id);return successResponse(res,null,'已取消')}catch(e){next(e)}})

module.exports=router
