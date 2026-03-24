const svc = require('./products.service')
const { successResponse } = require('../../utils/response')

// 分类
const catList   = async (req,res,next) => { try { return successResponse(res, await svc.getCategoryList(), '查询成功') } catch(e){next(e)} }
const catCreate = async (req,res,next) => { try { return successResponse(res, await svc.createCategory(req.body), '创建成功', 201) } catch(e){next(e)} }
const catUpdate = async (req,res,next) => { try { await svc.updateCategory(+req.params.id, req.body); return successResponse(res,null,'更新成功') } catch(e){next(e)} }
const catDelete = async (req,res,next) => { try { await svc.deleteCategory(+req.params.id); return successResponse(res,null,'删除成功') } catch(e){next(e)} }

// 商品选择中心
const finder = async (req,res,next) => { try { return successResponse(res, await svc.findForFinder({ page:+req.query.page||1, pageSize:+req.query.pageSize||15, keyword:req.query.keyword||'', categoryId:req.query.categoryId?+req.query.categoryId:null, warehouseId:req.query.warehouseId?+req.query.warehouseId:null }), '查询成功') } catch(e){next(e)} }

// 商品
const list       = async (req,res,next) => { try { return successResponse(res, await svc.findAll({ page:+req.query.page||1, pageSize:+req.query.pageSize||20, keyword:req.query.keyword||'', categoryId:req.query.categoryId?+req.query.categoryId:null }), '查询成功') } catch(e){next(e)} }
const listActive = async (req,res,next) => { try { return successResponse(res, await svc.findAllActive(), '查询成功') } catch(e){next(e)} }
const detail     = async (req,res,next) => { try { return successResponse(res, await svc.findById(+req.params.id), '查询成功') } catch(e){next(e)} }
const create     = async (req,res,next) => { try { return successResponse(res, await svc.create(req.body), '创建成功', 201) } catch(e){next(e)} }
const update     = async (req,res,next) => { try { await svc.update(+req.params.id, req.body); return successResponse(res,null,'更新成功') } catch(e){next(e)} }
const remove     = async (req,res,next) => { try { await svc.softDelete(+req.params.id); return successResponse(res,null,'删除成功') } catch(e){next(e)} }

module.exports = { catList, catCreate, catUpdate, catDelete, finder, list, listActive, detail, create, update, remove }
