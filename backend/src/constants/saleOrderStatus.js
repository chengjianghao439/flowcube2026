/**
 * 销售单状态常量 — 统一定义，状态值与数据库 sale_orders.status 保持一致。
 *
 * 业务流程：
 *   草稿(1) → 已占库(2) → 拣货中(3) → 已出库(4)
 *   草稿/已占库/拣货中 → 已取消(5)
 */

const SALE_STATUS = Object.freeze({
  /** 草稿 — 单据可编辑，尚未预占库存 */
  DRAFT: 1,
  /** 已占库 — 库存已预占，尚未进入仓库任务 */
  RESERVED: 2,
  /** 拣货中 — 已创建/进入仓库任务主链 */
  PICKING: 3,
  /** 已出库 — 仓库出库完成 */
  SHIPPED: 4,
  /** 已取消 — 单据已取消 */
  CANCELLED: 5,
})

const SALE_STATUS_NAME = Object.freeze({
  [SALE_STATUS.DRAFT]: '草稿',
  [SALE_STATUS.RESERVED]: '已占库',
  [SALE_STATUS.PICKING]: '拣货中',
  [SALE_STATUS.SHIPPED]: '已出库',
  [SALE_STATUS.CANCELLED]: '已取消',
})

const SALE_STATUS_TONE = Object.freeze({
  [SALE_STATUS.DRAFT]: 'draft',
  [SALE_STATUS.RESERVED]: 'active',
  [SALE_STATUS.PICKING]: 'active',
  [SALE_STATUS.SHIPPED]: 'success',
  [SALE_STATUS.CANCELLED]: 'danger',
})

const SALE_STATUS_ACTIVE = [
  SALE_STATUS.DRAFT,
  SALE_STATUS.RESERVED,
  SALE_STATUS.PICKING,
]

const SALE_STATUS_TERMINAL = [
  SALE_STATUS.SHIPPED,
  SALE_STATUS.CANCELLED,
]

module.exports = {
  SALE_STATUS,
  SALE_STATUS_NAME,
  SALE_STATUS_TONE,
  SALE_STATUS_ACTIVE,
  SALE_STATUS_TERMINAL,
}
