/**
 * 上架推荐库位（定向上架第一阶段：推荐 + 偏离留痕，不做硬约束）
 *
 * 推荐逻辑：
 *  1. 优先推荐该仓库中已存放同商品 ACTIVE 容器的库位（按容器数降序）——同品聚集；
 *  2. 若该商品在库内没有落位容器，退回推荐空库位（该仓启用库位中当前无任何
 *     ACTIVE 容器挂靠的）——避免新品无从下手。
 * PDA 扫到非推荐库位时前端二次确认后照常上架，并在 putaway 事件里记录偏离
 * （putaway.js 的 deviatedFromSuggestion），供后续制定硬性上架规则时参考实际动线。
 *
 * 注：handler 就地放在本文件（而非 inbound-tasks.controller.js），因 controller
 * 文件当前有另一会话的在途改动，避让编辑冲突；结构上与模块内多文件拆分风格一致。
 */
const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const { successResponse } = require('../../utils/response')
const { CONTAINER_STATUS } = require('../../engine/containerEngine')

const SUGGEST_LIMIT = 5

async function getPutawaySuggestion(taskId, containerId) {
  const cid = Number(containerId)
  if (!Number.isFinite(cid) || cid <= 0) throw new AppError('容器无效', 400)

  const [[container]] = await pool.query(
    `SELECT id, inbound_task_id, product_id, warehouse_id, status
     FROM inventory_containers WHERE id=? AND deleted_at IS NULL`,
    [cid],
  )
  if (!container) throw new AppError('容器不存在', 404)
  if (Number(container.inbound_task_id) !== Number(taskId)) throw new AppError('容器不属于该收货订单', 400)

  // 同商品已落位库位（按容器数降序）
  const [sameProductLocs] = await pool.query(
    `SELECT l.id AS locationId, l.code AS locationCode, COUNT(c.id) AS containerCount
     FROM inventory_containers c
     JOIN warehouse_locations l ON l.id = c.location_id AND l.deleted_at IS NULL AND l.status = 1
     WHERE c.product_id=? AND c.warehouse_id=? AND c.status=? AND c.deleted_at IS NULL
       AND c.location_id IS NOT NULL
     GROUP BY l.id, l.code
     ORDER BY containerCount DESC, l.code ASC
     LIMIT ?`,
    [container.product_id, container.warehouse_id, CONTAINER_STATUS.ACTIVE, SUGGEST_LIMIT],
  )

  if (sameProductLocs.length) {
    return {
      strategy: 'same_product',
      suggestions: sameProductLocs.map(r => ({
        locationId: Number(r.locationId),
        locationCode: r.locationCode,
        containerCount: Number(r.containerCount),
      })),
    }
  }

  // 空库位（该仓启用库位中当前无 ACTIVE 容器挂靠的）
  const [emptyLocs] = await pool.query(
    `SELECT l.id AS locationId, l.code AS locationCode
     FROM warehouse_locations l
     WHERE l.warehouse_id=? AND l.deleted_at IS NULL AND l.status = 1
       AND NOT EXISTS (
         SELECT 1 FROM inventory_containers c
         WHERE c.location_id = l.id AND c.status=? AND c.deleted_at IS NULL
       )
     ORDER BY l.code ASC
     LIMIT ?`,
    [container.warehouse_id, CONTAINER_STATUS.ACTIVE, SUGGEST_LIMIT],
  )

  return {
    strategy: 'empty_location',
    suggestions: emptyLocs.map(r => ({
      locationId: Number(r.locationId),
      locationCode: r.locationCode,
      containerCount: 0,
    })),
  }
}

const putawaySuggestionHandler = async (req, res, next) => {
  try {
    const data = await getPutawaySuggestion(+req.params.id, +req.query.containerId)
    return successResponse(res, data, '查询成功')
  } catch (e) { next(e) }
}

module.exports = { getPutawaySuggestion, putawaySuggestionHandler }
