const svc = require('./price-lists.service')
const { successResponse } = require('../../utils/response')

const list = async(req,res,next)=>{ try{return successResponse(res,await svc.findAll(),'查询成功')}catch(e){next(e)} }
const listItems = async(req,res,next)=>{ try{return successResponse(res,await svc.findItems(+req.params.id),'查询成功')}catch(e){next(e)} }
const getCustomerPrice = async(req,res,next)=>{ try{const{customerId,productId}=req.query;if(!customerId||!productId)return successResponse(res,null,'缺少参数');const data=await svc.findCustomerPrice(+customerId,+productId);return successResponse(res,data,data?'找到定价':'未设置该商品价格')}catch(e){next(e)} }
const create = async(req,res,next)=>{ try{const data=await svc.create(req.body.name,req.body.remark);return successResponse(res,data,'创建成功',201)}catch(e){next(e)} }
const updateItems = async(req,res,next)=>{ try{const items=req.body.items;if(!Array.isArray(items))return res.status(400).json({success:false,message:'items 格式错误',data:null});await svc.updateItems(+req.params.id,items);return successResponse(res,null,'价格表已更新')}catch(e){next(e)} }
const update = async(req,res,next)=>{ try{await svc.update(+req.params.id,req.body);return successResponse(res,null,'更新成功')}catch(e){next(e)} }
const remove = async(req,res,next)=>{ try{await svc.remove(+req.params.id);return successResponse(res,null,'已删除')}catch(e){next(e)} }
const bindCustomer = async(req,res,next)=>{ try{const{customerId,priceLevel}=req.body;if(!customerId)return res.status(400).json({success:false,message:'缺少 customerId',data:null});await svc.bindCustomer(customerId,priceLevel);return successResponse(res,null,'绑定成功')}catch(e){next(e)} }

module.exports = { list, listItems, getCustomerPrice, create, updateItems, update, remove, bindCustomer }
