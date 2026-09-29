const svc = require('./packages.service')
const { successResponse } = require('../../utils/response')
const { extractRequestKey } = require('../../utils/requestKey')

async function list(req, res, next) {
  try {
    const taskId = +req.query.taskId
    if (!taskId) return res.status(400).json({ success: false, message: '缺少 taskId', data: null })
    const result = await svc.listByTask(taskId)
    return successResponse(res, result, '查询成功')
  } catch (e) { next(e) }
}

async function create(req, res, next) {
  try {
    const { warehouseTaskId, remark } = req.body
    const result = await svc.createPackage(warehouseTaskId, remark, req.user?.warehouseIds ?? null)
    return successResponse(res, result, '箱子已创建')
  } catch (e) { next(e) }
}

async function addItem(req, res, next) {
  try {
    const packageId = +req.params.id
    const { productCode, labelBarcode, qty } = req.body
    const result = await svc.addItem(packageId, { productCode, labelBarcode, qty }, {
      requestKey: extractRequestKey(req),
      userId: req.user?.userId ?? null,
      scopeWarehouseIds: req.user?.warehouseIds ?? null,
      // 设备仓：票据有效 ≠ 目标仓匹配，服务层据此比对（首次与重放都要过）
      pdaWarehouseId: req.pda?.warehouseId ?? null,
    })
    return successResponse(res, result, '商品已加入箱子')
  } catch (e) { next(e) }
}

async function removeItem(req, res, next) {
  try {
    const packageId = +req.params.id
    const { itemId, qty } = req.body
    const result = await svc.removeItem(packageId, { itemId, qty }, {
      // 稳定键：同一次移出重放**只生效一次**，并按原键取回原回执（明细已被整行删掉也一样）
      requestKey: extractRequestKey(req),
      userId: req.user?.userId ?? null,
      scopeWarehouseIds: req.user?.warehouseIds ?? null,
      pdaWarehouseId: req.pda?.warehouseId ?? null,
    })
    return successResponse(res, result, result.removed ? '商品已移出箱子' : '数量已调整')
  } catch (e) { next(e) }
}

async function voidPackage(req, res, next) {
  try {
    const packageId = +req.params.id
    const result = await svc.voidPackage(packageId, {
      requestKey: extractRequestKey(req),
      userId: req.user?.userId ?? null,
      scopeWarehouseIds: req.user?.warehouseIds ?? null,
      pdaWarehouseId: req.pda?.warehouseId ?? null,
    })
    return successResponse(res, result, '箱子已作废')
  } catch (e) { next(e) }
}

async function finish(req, res, next) {
  try {
    const id = +req.params.id
    // 幂等回执与业务在 service 内**同一个 conn、同一个事务**里完成（范围 / 设备仓校验先于 replay），
    // controller 不再自己 begin / complete —— 否则又会拆出「业务已提交、回执未落」的窗口，
    // 而且 pool 上的 begin 会让重放**先于**范围 / 设备仓校验命中。
    const result = await svc.finishPackage(id, {
      requestKey: extractRequestKey(req),
      userId: req.user?.userId ?? null,
      createdBy: req.user.userId,
      scopeWarehouseIds: req.user?.warehouseIds ?? null,
      pdaWarehouseId: req.pda?.warehouseId ?? null,
    })
    return successResponse(res, result, '箱子已完成并已进入打印链')
  } catch (e) { next(e) }
}

async function printLabel(req, res, next) {
  try {
    const packageId = +req.params.id
    // 与 finish 同口径：范围 / 设备仓校验、幂等 begin/replay、入队、dispatchHint、回执
    // **全部在 service 的同一个 conn、同一个事务**里完成。controller 不再自己 begin/complete ——
    // 原先 pool 上 begin（自动提交）+ 业务另事务 + complete 又一条 pool 连接，会同时留下
    // 「队列已提交、回执未落」的半成功窗口，和「失败留 PENDING 永久挡原键重试」两个缺陷。
    const result = await svc.printPackageLabel(packageId, {
      requestKey: extractRequestKey(req),
      userId: req.user?.userId ?? null,
      scopeWarehouseIds: req.user?.warehouseIds ?? null,
      pdaWarehouseId: req.pda?.warehouseId ?? null,
    })
    return successResponse(res, result.data, result.message || '已加入打印队列')
  } catch (e) { next(e) }
}

async function getByBarcode(req, res, next) {
  try {
    const result = await svc.getByBarcode(req.params.barcode)
    return successResponse(res, result, '查询成功')
  } catch (e) { next(e) }
}

module.exports = { list, create, addItem, removeItem, voidPackage, finish, printLabel, getByBarcode }
