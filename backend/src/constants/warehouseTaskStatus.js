const AppError = require('../utils/AppError')

/**
 * 仓库任务状态常量 — 统一定义，所有模块引用此文件
 *
 * 业务流程：
 *   拣货中(2) → 待分拣(3) → 待复核(4) → 待打包(5) → 待出库(6) → 已出库(7)
 *   任意阶段 → 已取消(8)
 *
 * 注意：status=1「待拣货」已保留但当前跳过，
 *       createForSaleOrder 直接以 status=2 创建任务。
 */

const WT_STATUS = Object.freeze({
  /** 待拣货 — 已创建但尚未开始拣货（当前跳过，直接进入 PICKING） */
  PENDING:    1,
  /** 拣货中 — PDA 正在执行拣货作业 */
  PICKING:    2,
  /** 待分拣 — 拣货完成，等待 Put Wall 分拣 */
  SORTING:    3,
  /** 待复核 — 分拣完成，等待人工复核商品数量 */
  CHECKING:   4,
  /** 待打包 — 复核通过，等待装箱打包 */
  PACKING:    5,
  /** 待出库 — 打包完成，等待出库发货确认 */
  SHIPPING:   6,
  /** 已出库 — 出库完成，库存已扣减，应收账款已生成 */
  SHIPPED:    7,
  /** 已取消 — 任务已取消，关联销售单状态同步为已取消 */
  CANCELLED:  8,
})

/** 状态名称映射 */
const WT_STATUS_NAME = Object.freeze({
  [WT_STATUS.PENDING]:   '待拣货',
  [WT_STATUS.PICKING]:   '拣货中',
  [WT_STATUS.SORTING]:   '待分拣',
  [WT_STATUS.CHECKING]:  '待复核',
  [WT_STATUS.PACKING]:   '待打包',
  [WT_STATUS.SHIPPING]:  '待出库',
  [WT_STATUS.SHIPPED]:   '已出库',
  [WT_STATUS.CANCELLED]: '已取消',
})

const WT_STATUS_TONE = Object.freeze({
  [WT_STATUS.PENDING]:   'draft',
  [WT_STATUS.PICKING]:   'active',
  [WT_STATUS.SORTING]:   'active',
  [WT_STATUS.CHECKING]:  'active',
  [WT_STATUS.PACKING]:   'active',
  [WT_STATUS.SHIPPING]:  'active',
  [WT_STATUS.SHIPPED]:   'success',
  [WT_STATUS.CANCELLED]: 'danger',
})

/** 进行中的状态（未完成且未取消）*/
const WT_STATUS_ACTIVE = [
  WT_STATUS.PENDING,
  WT_STATUS.PICKING,
  WT_STATUS.SORTING,
  WT_STATUS.CHECKING,
  WT_STATUS.PACKING,
  WT_STATUS.SHIPPING,
]

/** PDA 拣货任务池状态 */
const WT_STATUS_PICK_POOL = [WT_STATUS.PENDING, WT_STATUS.PICKING]

/** 终态（不可再修改）*/
const WT_STATUS_TERMINAL = [WT_STATUS.SHIPPED, WT_STATUS.CANCELLED]

/**
 * 状态进入行为表（文档性，说明进入每个状态时系统执行的业务动作）
 *
 * 这些动作由对应的 service 函数负责执行，此处仅作集中记录供维护参考。
 *
 * ┌──────────────┬──────────────────────────────────────────────────────────────┐
 * │ 进入状态      │ 触发的业务动作                                                │
 * ├──────────────┼──────────────────────────────────────────────────────────────┤
 * │ PICKING(2)   │ 1. 自动分配空闲分拣格（assignToTask）                         │
 * │              │ 2. 清除孤立容器锁（startPicking 兼容路径）                    │
 * ├──────────────┼──────────────────────────────────────────────────────────────┤
 * │ SORTING(3)   │ 1. 同步销售单状态 → 3（待出库/分拣中）                        │
 * │              │    sale_orders.status = 3                                    │
 * ├──────────────┼──────────────────────────────────────────────────────────────┤
 * │ CHECKING(4)  │ 1. 释放分拣格（releaseByTask）                                │
 * │              │ 2. 清空 warehouse_tasks.sorting_bin_id / sorting_bin_code    │
 * │              │ 3. 更新 warehouse_task_items.sorted_qty（逐件或整批）         │
 * ├──────────────┼──────────────────────────────────────────────────────────────┤
 * │ PACKING(5)   │ （无额外动作，复核通过即可进入打包）                           │
 * ├──────────────┼──────────────────────────────────────────────────────────────┤
 * │ SHIPPING(6)  │ 1. 所有箱子完成打包（packages.status 全部 = 2）后自动触发     │
 * │              │    由 finishPackage 在事务内校验并推进                        │
 * ├──────────────┼──────────────────────────────────────────────────────────────┤
 * │ SHIPPED(7)   │ 1. FIFO 扣减库存容器（moveStock / deductFromContainers）      │
 * │              │ 2. 释放容器锁（unlockContainersByTask）                       │
 * │              │ 3. 同步销售单状态 → 4（已出库）                               │
 * │              │    sale_orders.status = 4                                    │
 * │              │ 4. 写入应收账款记录（INSERT IGNORE payment_records）          │
 * │              │ 5. 写入 warehouse_tasks.shipped_at = NOW()                   │
 * ├──────────────┼──────────────────────────────────────────────────────────────┤
 * │ CANCELLED(8) │ 1. 释放容器锁（unlockContainersByTask）                       │
 * │              │ 2. 释放分拣格（releaseByTask）                                │
 * │              │ 3. 清空 warehouse_tasks.sorting_bin_id / sorting_bin_code    │
 * │              │ 4. 同步销售单状态 → 5（已取消）                               │
 * │              │    sale_orders.status = 5                                    │
 * └──────────────┴──────────────────────────────────────────────────────────────┘
 */
const WT_ON_ENTER_ACTIONS = Object.freeze({
  [WT_STATUS.PENDING]:   [],  // 待拣货：创建后直接跳过，无额外动作（当前系统以 PICKING 创建）
  [WT_STATUS.PICKING]:   ['assignSortingBin', 'clearOrphanedContainerLocks'],
  [WT_STATUS.SORTING]:   ['syncSaleOrderStatus:3'],
  [WT_STATUS.CHECKING]:  ['releaseSortingBin', 'clearSortingBinFields', 'updateSortedQty'],
  [WT_STATUS.PACKING]:   [],
  [WT_STATUS.SHIPPING]:  ['autoTriggerByFinishPackage'],
  [WT_STATUS.SHIPPED]:   ['deductStock', 'unlockContainers', 'syncSaleOrderStatus:4', 'createPaymentRecord', 'setShippedAt'],
  [WT_STATUS.CANCELLED]: ['unlockContainers', 'releaseSortingBin', 'clearSortingBinFields', 'syncSaleOrderStatus:5'],
})

/**
 * 状态退出行为表（文档性，说明离开某个状态前系统执行的业务动作）
 *
 * 退出行为 = 状态变化前的「前置校验」+ 「资源释放」
 * 进入行为 = 状态变化后的「资源初始化」+ 「副作用写入」
 *
 * ┌──────────────┬──────────────────────────────────────────────────────────────┐
 * │ 离开状态      │ 触发的业务动作（在 UPDATE status 之前执行）                    │
 * ├──────────────┼──────────────────────────────────────────────────────────────┤
 * │ PENDING(1)   │ （无，startPicking 直接推进）                                 │
 * ├──────────────┼──────────────────────────────────────────────────────────────┤
 * │ PICKING(2)   │ （无前置操作，readyToShip 直接推进）                           │
 * │              │  注：picked_qty 校验由前端负责，后端不做强制验证               │
 * ├──────────────┼──────────────────────────────────────────────────────────────┤
 * │ SORTING(3)   │ 1. 校验所有 item 的 sorted_qty >= picked_qty                  │
 * │              │    （sortTask 内部查询 warehouse_task_items）                 │
 * │              │    不满足则返回进度，不推进状态                                │
 * ├──────────────┼──────────────────────────────────────────────────────────────┤
 * │ CHECKING(4)  │ 1. 逐件更新 checked_qty                                      │
 * │              │ 2. 校验所有 item 的 checked_qty >= required_qty               │
 * │              │    （checkItems 内部查询 warehouse_task_items）               │
 * │              │    不满足则仅更新明细，不推进状态                              │
 * ├──────────────┼──────────────────────────────────────────────────────────────┤
 * │ PACKING(5)   │ 1. 校验箱子内有商品（package_items.cnt > 0）                  │
 * │              │ 2. 校验该任务剩余未完成箱子数量（packages.status=1 remaining）  │
 * │              │    仍有未完成箱子则仅完成当前箱，不推进任务状态                 │
 * ├──────────────┼──────────────────────────────────────────────────────────────┤
 * │ SHIPPING(6)  │ 1. FIFO 扣减库存容器（moveStock / deductFromContainers）      │
 * │              │    扣减在 UPDATE status 之前执行，失败则整个事务回滚           │
 * │              │ 2. 释放容器锁（unlockContainersByTask）                       │
 * │              │    在 status 推进到 SHIPPED 之后执行（同一事务内）             │
 * ├──────────────┬──────────────────────────────────────────────────────────────┤
 * │ 任意进行中    │ （cancel 路径）                                               │
 * │ →CANCELLED   │ 1. 释放容器锁（unlockContainersByTask）                       │
 * │              │ 2. 释放分拣格（sortingBinSvc.releaseByTask）                  │
 * │              │ 3. 清空 sorting_bin_id / sorting_bin_code                    │
 * └──────────────┴──────────────────────────────────────────────────────────────┘
 */
const WT_ON_EXIT_ACTIONS = Object.freeze({
  [WT_STATUS.PENDING]:   [],
  [WT_STATUS.PICKING]:   [],  // picked_qty 由前端校验
  [WT_STATUS.SORTING]:   ['validateSortedQty'],           // 不满足则中止推进
  [WT_STATUS.CHECKING]:  ['updateCheckedQty', 'validateCheckedQty'],  // 不满足则中止推进
  [WT_STATUS.PACKING]:   ['validatePackageHasItems', 'validateAllPackagesDone'],  // 不满足则中止推进
  [WT_STATUS.SHIPPING]:  ['deductStock'],                 // 失败则整个事务回滚
  [WT_STATUS.SHIPPED]:   [],
  [WT_STATUS.CANCELLED]: ['unlockContainers', 'releaseSortingBin', 'clearSortingBinFields'],
})

/**
 * 合法状态迁移表
 * key   = 当前状态
 * value = 允许进入的下一状态列表
 *
 * 完整迁移图：
 *   PENDING(1)  → PICKING(2)   startPicking
 *   PICKING(2)  → SORTING(3)   readyToShip
 *   SORTING(3)  → CHECKING(4)  sortTask
 *   CHECKING(4) → PACKING(5)   checkDone / checkItems
 *   PACKING(5)  → SHIPPING(6)  packDone / finishPackage
 *   SHIPPING(6) → SHIPPED(7)   ship
 *   任意进行中   → CANCELLED(8) cancel
 *
 * 注意：取消（→CANCELLED）由 cancel() 函数独立处理，
 *       因为它允许从任意进行中状态触发，不在此表中列举。
 */
const WT_TRANSITIONS = Object.freeze({
  [WT_STATUS.PENDING]:  [WT_STATUS.PICKING],
  [WT_STATUS.PICKING]:  [WT_STATUS.SORTING,   WT_STATUS.CANCELLED],
  [WT_STATUS.SORTING]:  [WT_STATUS.CHECKING,  WT_STATUS.CANCELLED],
  [WT_STATUS.CHECKING]: [WT_STATUS.PACKING,   WT_STATUS.CANCELLED],
  [WT_STATUS.PACKING]:  [WT_STATUS.SHIPPING,  WT_STATUS.CANCELLED],
  [WT_STATUS.SHIPPING]: [WT_STATUS.SHIPPED,   WT_STATUS.CANCELLED],
  [WT_STATUS.SHIPPED]:  [],
  [WT_STATUS.CANCELLED]: [],
})

const WT_ACTION_RULES = Object.freeze({
  assign: {
    allowed: WT_STATUS_ACTIVE,
    blocked: {
      [WT_STATUS.SHIPPED]: '已出库的任务不能修改',
      [WT_STATUS.CANCELLED]: '已取消的任务不能修改',
    },
  },
  startPicking: {
    allowed: [WT_STATUS.PENDING, WT_STATUS.PICKING],
    message: '只有"待拣货"或"拣货中"状态可以开始拣货',
  },
  readyToShip: {
    allowed: [WT_STATUS.PICKING],
    toStatus: WT_STATUS.SORTING,
    message: '只有"拣货中"状态可以标记拣货完成',
  },
  sortTask: {
    allowed: [WT_STATUS.SORTING],
    toStatus: WT_STATUS.CHECKING,
    message: '只有"待分拣"状态可以完成分拣',
  },
  checkDone: {
    allowed: [WT_STATUS.CHECKING],
    toStatus: WT_STATUS.PACKING,
    message: '只有"待复核"状态可以完成复核',
  },
  packDone: {
    allowed: [WT_STATUS.PACKING],
    toStatus: WT_STATUS.SHIPPING,
    message: '只有"待打包"状态可以完成打包',
  },
  ship: {
    allowed: [WT_STATUS.SHIPPING],
    toStatus: WT_STATUS.SHIPPED,
    message: '只有"待出库"状态可以执行出库',
  },
  cancel: {
    allowed: WT_STATUS_ACTIVE,
    toStatus: WT_STATUS.CANCELLED,
    blocked: {
      [WT_STATUS.SHIPPED]: '已出库的任务不能取消',
      [WT_STATUS.CANCELLED]: '任务已取消',
    },
  },
  viewPickWork: {
    allowed: WT_STATUS_ACTIVE,
    blocked: {
      [WT_STATUS.SHIPPED]: '任务已完成或已取消',
      [WT_STATUS.CANCELLED]: '任务已完成或已取消',
    },
  },
})

/**
 * 校验状态迁移是否合法
 * @param {number} from - 当前状态
 * @param {number} to   - 目标状态
 * @returns {boolean}
 */
function isValidTransition(from, to) {
  const allowed = WT_TRANSITIONS[from]
  if (!allowed) return false
  return allowed.includes(to)
}

function assertWarehouseTaskAction(action, status) {
  const rule = WT_ACTION_RULES[action]
  if (!rule) throw new Error(`Unknown warehouse task action: ${action}`)
  const normalized = Number(status)
  if (rule.allowed.includes(normalized)) return rule
  if (rule.blocked?.[normalized]) throw new AppError(rule.blocked[normalized], 400)
  throw new AppError(rule.message || '当前状态不允许执行该操作', 400)
}

module.exports = {
  WT_STATUS,
  WT_STATUS_NAME,
  WT_STATUS_TONE,
  WT_STATUS_ACTIVE,
  WT_STATUS_PICK_POOL,
  WT_STATUS_TERMINAL,
  WT_TRANSITIONS,
  WT_ACTION_RULES,
  WT_ON_ENTER_ACTIONS,
  WT_ON_EXIT_ACTIONS,
  isValidTransition,
  assertWarehouseTaskAction,
}
