const svc = require('./plastic-boxes.service')
const { successResponse } = require('../../utils/response')
const { extractRequestKey } = require('../../utils/requestKey')

const list = async (req, res, next) => {
  try { return successResponse(res, await svc.findAll({ ...req.query, scopeWarehouseIds: req.user.warehouseIds }), '查询成功') } catch (e) { next(e) }
}
const detail = async (req, res, next) => {
  try { return successResponse(res, await svc.findById(+req.params.id, req.user.warehouseIds), '查询成功') } catch (e) { next(e) }
}
const movements = async (req, res, next) => {
  try { return successResponse(res, await svc.findMovements(+req.params.id, req.user.warehouseIds), '查询成功') } catch (e) { next(e) }
}
const create = async (req, res, next) => {
  try { return successResponse(res, await svc.create(req.body, req.user.warehouseIds), '创建成功', 201) } catch (e) { next(e) }
}
const remove = async (req, res, next) => {
  try { await svc.remove(+req.params.id, req.user.warehouseIds); return successResponse(res, null, '删除成功') } catch (e) { next(e) }
}
/** 重复打印塑料盒条码（塑料盒是固定可复用码，不进补打中心） */
const printLabel = async (req, res, next) => {
  try {
    const job = await svc.printLabel(+req.params.id, {
      userId: req.user?.userId ?? null,
      scopeWarehouseIds: req.user.warehouseIds,
    })
    if (!job) return successResponse(res, { queued: false, jobId: null }, '未绑定打印机，未创建打印任务')
    return successResponse(res, { queued: true, jobId: Number(job.id), printerCode: job.printerCode ?? null, printerName: job.printerName ?? null }, '已加入打印队列')
  } catch (e) { next(e) }
}

/** 放货：把来源整件的全部实存倒入本盒（幂等按目标盒绑定） */
const fill = async (req, res, next) => {
  try {
    const result = await svc.fill(+req.params.id, {
      sourceContainerId: req.body.sourceContainerId,
      expectedSourceQty: req.body.expectedSourceQty ?? null,
      requestKey: extractRequestKey(req),
    }, {
      userId: req.user?.userId ?? null,
      userName: req.user?.realName || req.user?.username || null,
      isPda: Boolean(req.pda),
      pdaWarehouseId: req.pda?.warehouseId ?? null,
    }, req.user.warehouseIds)
    return successResponse(res, result, '放货成功')
  } catch (e) { next(e) }
}

/** 还原整件：人工逐箱 qty，从盒里生成独立整件库存码（幂等按盒绑定） */
const repack = async (req, res, next) => {
  try {
    const result = await svc.repack(+req.params.id, {
      perBoxQty: req.body.perBoxQty ?? null,
      boxCount: req.body.boxCount ?? null,
      items: req.body.items ?? null,
      requestKey: extractRequestKey(req),
    }, {
      userId: req.user?.userId ?? null,
      userName: req.user?.realName || req.user?.username || null,
      isPda: Boolean(req.pda),
      pdaWarehouseId: req.pda?.warehouseId ?? null,
    }, req.user.warehouseIds)
    return successResponse(res, result, '还原整件成功')
  } catch (e) { next(e) }
}

/** 来源贡献：本盒各来源容器及其贡献量（不折算当前剩余、不做 FIFO 分摊） */
const sources = async (req, res, next) => {
  try {
    return successResponse(res, await svc.findSources(+req.params.id, req.user.warehouseIds), '查询成功')
  } catch (e) { next(e) }
}

module.exports = { list, detail, movements, create, remove, printLabel, fill, repack, sources }
