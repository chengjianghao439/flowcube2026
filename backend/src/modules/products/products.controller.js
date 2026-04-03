const svc = require('./products.service')
const { successResponse } = require('../../utils/response')
const { getTenantId } = require('../../utils/tenantScope')

// 商品选择中心
const finder = async (req,res,next) => { try { return successResponse(res, await svc.findForFinder({ page:+req.query.page||1, pageSize:+req.query.pageSize||15, keyword:req.query.keyword||'', categoryId:req.query.categoryId?+req.query.categoryId:null, warehouseId:req.query.warehouseId?+req.query.warehouseId:null }), '查询成功') } catch(e){next(e)} }

// 商品
const list       = async (req,res,next) => { try { return successResponse(res, await svc.findAll({ page:+req.query.page||1, pageSize:+req.query.pageSize||20, keyword:req.query.keyword||'', categoryId:req.query.categoryId?+req.query.categoryId:null }), '查询成功') } catch(e){next(e)} }
const listActive = async (req,res,next) => { try { return successResponse(res, await svc.findAllActive(), '查询成功') } catch(e){next(e)} }
const detail     = async (req,res,next) => { try { return successResponse(res, await svc.findById(+req.params.id), '查询成功') } catch(e){next(e)} }
const create     = async (req,res,next) => { try { return successResponse(res, await svc.create(req.body), '创建成功', 201) } catch(e){next(e)} }
const update     = async (req,res,next) => { try { await svc.update(+req.params.id, req.body); return successResponse(res,null,'更新成功') } catch(e){next(e)} }
const remove     = async (req,res,next) => { try { await svc.softDelete(+req.params.id); return successResponse(res,null,'删除成功') } catch(e){next(e)} }
const printLabel = async (req,res,next) => {
  try {
    const job = await svc.enqueueLabel(+req.params.id, {
      tenantId: getTenantId(req),
      createdBy: req.user?.userId ?? req.user?.id ?? null,
    })
    return successResponse(
      res,
      job
        ? {
            queued: true,
            jobId: job.id,
            printerCode: job.printerCode,
            printerName: job.printerName,
            dispatchHint: job.dispatchHint,
            contentType: job.contentType,
            content: job.content,
          }
        : {
            queued: false,
            jobId: null,
            printerCode: null,
            printerName: null,
          },
      job ? '已加入打印队列' : '未配置标签机，未创建打印任务',
    )
  } catch (e) { next(e) }
}

module.exports = { finder, list, listActive, detail, create, update, remove, printLabel }
