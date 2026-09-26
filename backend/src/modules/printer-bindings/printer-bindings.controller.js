const svc = require('./printer-bindings.service')
const { successResponse } = require('../../utils/response')
const { assertBoundWarehouseInScope } = require('../../utils/warehouseScope')

// 与 printers.controller 同款：warehouseIds 为 null 表示不限仓（超管或未配 scope）
const scopeOf = (req) => req.user?.warehouseIds ?? null

const list = async (req, res, next) => { try { return successResponse(res, await svc.findAll(scopeOf(req)), '查询成功') } catch (e) { next(e) } }

const bind = async (req, res, next) => {
  try {
    const { type } = req.params
    // schema 已把缺省/空值归一成 0；0 在库里就是「公司级绑定」，全仓生效。
    // 必须原样传 0 下去：写成 `warehouseId || null` 会把公司级变成 NULL——
    // NULL 不参与 (warehouse_id, print_type) 唯一键去重，会插出重复行，
    // 且 unbind 的 `WHERE warehouse_id = NULL` 永远删不掉。
    const { printerId, warehouseId } = req.body
    // 公司级绑定对所有仓库生效，只允许不限仓用户设置；限仓用户只能绑自己范围内的仓库。
    // 此前两条路径都不校验，限仓用户可改全局绑定或替别的仓库绑打印机
    // （2026-09-26 一致性审查 · 任务 6）。
    assertBoundWarehouseInScope(scopeOf(req), warehouseId, '打印机绑定')
    const data = await svc.bind(type, printerId, warehouseId)
    return successResponse(res, data, '绑定成功')
  } catch (e) { next(e) }
}

const unbind = async (req, res, next) => {
  try {
    const { type } = req.params
    const { warehouseId } = req.query
    assertBoundWarehouseInScope(scopeOf(req), warehouseId, '打印机绑定')
    await svc.unbind(type, warehouseId)
    return successResponse(res, null, '已解除绑定')
  } catch (e) { next(e) }
}

module.exports = { list, bind, unbind }
