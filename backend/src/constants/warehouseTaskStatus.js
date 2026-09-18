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
 * 状态进入行为表（**纯文档性**，说明状态推进时系统实际执行的业务动作）
 *
 * ⚠️ 这两个常量**没有任何代码消费**（全仓只有定义/导出与文档引用），它们不施加任何约束，
 *    改副作用时不要以为改了这里就改了行为。2026-09-18 审计 [29] 核对出原表把「CAS 之前」
 *    的动作写成了「CAS 之后」、两表重复登记、以及把 CAS 内部字段（shipped_at）单列成动作，
 *    这里按实现重写，并给每条动作标注**时序**：
 *
 *      [前] = 同一事务内、`compareAndSetStatus` **之前**执行（失败则整笔回滚）
 *      [内] = 与 CAS 同一条 UPDATE（extraSet），不是独立动作
 *      [后] = CAS 成功**之后**执行的副作用
 *
 * ┌──────────────┬──────────────────────────────────────────────────────────────┐
 * │ 进入状态      │ 触发的业务动作（含时序）                                       │
 * ├──────────────┼──────────────────────────────────────────────────────────────┤
 * │ PICKING(2)   │ [后] 1. 自动分配空闲分拣格（assignToTask）                     │
 * │              │ [后] 2. 清除孤立容器锁（startPicking 兼容路径）                │
 * ├──────────────┼──────────────────────────────────────────────────────────────┤
 * │ SORTING(3)   │ [后] 1. 同步销售单状态 → 3（拣货中/仓库履约中）                │
 * │              │        sale_orders.status = 3                                │
 * ├──────────────┼──────────────────────────────────────────────────────────────┤
 * │ CHECKING(4)  │ [后] 1. 更新 warehouse_task_items.sorted_qty（逐件或整批）     │
 * │              │        （分拣格在此不释放——货未装箱前一直占用，见 SHIPPING(6)）│
 * ├──────────────┼──────────────────────────────────────────────────────────────┤
 * │ PACKING(5)   │ （无额外动作，复核通过即可进入打包）                           │
 * ├──────────────┼──────────────────────────────────────────────────────────────┤
 * │ SHIPPING(6)  │ [前] 所有箱子完成打包后由 packDoneWithinTransaction 在事务内   │
 * │              │      校验并推进；分拣格在此释放（releaseByTask，若曾分配过）   │
 * │              │ [内] 清空 sorting_bin_id / sorting_bin_code                   │
 * ├──────────────┼──────────────────────────────────────────────────────────────┤
 * │ SHIPPED(7)   │ 由 warehouse-tasks.ship.js 执行，实际时序（已对代码逐条核对）： │
 * │              │ [前] 1. 信用额度校验 assertCreditWithinLimit                   │
 * │              │ [前] 2. FIFO 扣减库存（moveStock，按 productId 升序避免死锁）  │
 * │              │ [前] 3. 销售单发货同步 + 应收全量重算                          │
 * │              │        （syncShippedByWarehouseTaskWithinTransaction，含       │
 * │              │         sale_orders.status → 4；采购退货走 syncPurchaseReturn- │
 * │              │         Shipped 冲减应付）                                    │
 * │              │ [内] 4. shipped_at = 出库时点（extraSet，与 CAS 同一条 UPDATE）│
 * │              │ [后] 5. 释放容器锁（unlockContainersByTask）                   │
 * │              │ [后] 6. 固化 sale_order_items.cost_snapshot（COGS 成本快照）   │
 * │              │ [后] 7. 写 SHIP_DONE 事件                                     │
 * │              │ ※ 不再单独 INSERT payment_records：应收由第 3 步全量重算      │
 * │              │   （分批增量幂等），扣减**不在本行重复登记**，见退出表 SHIPPING │
 * ├──────────────┼──────────────────────────────────────────────────────────────┤
 * │ CANCELLED(8) │ **两条路径，时序不同**（原表把它当一条写，是错的）：           │
 * │              │ ① 主流路径（状态 2–6 且需要逆向归还）：先置                 │
 * │              │    cancel_requested_at、由 PDA 逐件确认归还；               │
 * │              │    [前] 释放分拣格 releaseByTask（cancel-return.js）与容器    │
 * │              │         解锁（scan-logs 的取消归还扫码）；                    │
 * │              │    [后] 最终 CAS 到 8 之后只写事件。                          │
 * │              │ ② 直连路径（PENDING 直接取消，command.js）：                 │
 * │              │    [内] CAS 同语句清空 sorting_bin_id / sorting_bin_code；    │
 * │              │    [后] unlockContainersByTask、releaseByTask、释放预占、     │
 * │              │         取消包裹（packages.status → 3）、取消包裹打印任务    │
 * │              │         （print_jobs.status → 3）、同步销售单 → 5            │
 * │              │    （该路径下分拣格/容器锁本就为空，①②的动作集合等价）        │
 * │              │ [前] 两条路径都在 CAS 之前把「待归还容器库位」写进事件明细     │
 * └──────────────┴──────────────────────────────────────────────────────────────┘
 */
const WT_ON_ENTER_ACTIONS = Object.freeze({
  [WT_STATUS.PENDING]:   [],  // 待拣货：创建后直接跳过，无额外动作（当前系统以 PICKING 创建）
  [WT_STATUS.PICKING]:   ['assignSortingBin', 'clearOrphanedContainerLocks'],
  [WT_STATUS.SORTING]:   ['syncSaleOrderStatus:3'],
  [WT_STATUS.CHECKING]:  ['updateSortedQty'],
  [WT_STATUS.PACKING]:   [],
  [WT_STATUS.SHIPPING]:  ['autoTriggerByPackDone', 'releaseSortingBin'],  // [前] 推进；sorting_bin 字段在 CAS 内清空
  // [前] 校验/扣减/重算 → [内] shipped_at → [后] 解锁容器 + 固化 cost_snapshot + 事件
  [WT_STATUS.SHIPPED]:   ['assertCreditWithinLimit', 'syncSaleOrderStatus:4', 'recomputeReceivable', 'unlockContainers', 'snapshotCost', 'recordShipDoneEvent'],
  [WT_STATUS.CANCELLED]: ['releaseSortingBin', 'unlockContainers', 'releaseReservation', 'cancelPackages', 'cancelPackagePrintJobs', 'syncSaleOrderStatus:5'],
})

/**
 * 状态退出行为表（**纯文档性**，说明离开某个状态前后系统执行的业务动作）
 *
 * 与进入表同样标注时序（[前] = CAS 之前的前置校验/扣减；[内] = 与 CAS 同一语句；
 * [后] = CAS 之后的副作用）。注意「离开状态」只对**前置校验**有意义——副作用都发生在
 * 目标状态的 CAS 之后，所以本表只列「推进到下一状态之前必须先成立的校验/扣减」。
 *
 * ┌──────────────┬──────────────────────────────────────────────────────────────┐
 * │ 离开状态      │ 推进前必须完成的前置校验 / 扣减（[前]）                        │
 * ├──────────────┼──────────────────────────────────────────────────────────────┤
 * │ PENDING(1)   │ （无，startPicking 直接推进）                                 │
 * ├──────────────┼──────────────────────────────────────────────────────────────┤
 * │ PICKING(2)   │ 1. assertTaskPickScanClosure 后端强校验（warehouse-tasks.     │
 * │              │    helpers.js）：picked_qty 必须等于 required_qty，且扫码流水  │
 * │              │    合计与明细一致、锁定容器与扫码容器一致，不满足拒绝推进       │
 * ├──────────────┼──────────────────────────────────────────────────────────────┤
 * │ SORTING(3)   │ 1. 校验所有 item 的 sorted_qty >= picked_qty                  │
 * │              │    （sortTask 内部查询 warehouse_task_items）                  │
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
 * │              │    （这是「扣减」唯一登记处；进入表的 SHIPPED 行不再重复登记）  │
 * │              │ [后] 2. 释放容器锁（unlockContainersByTask）——在 status 推进到  │
 * │              │     SHIPPED 之后执行（同一事务内），不属「推进前」的前置       │
 * ├──────────────┼──────────────────────────────────────────────────────────────┤
 * │ SHIPPED(7)   │ （终态，无退出）                                              │
 * └──────────────┴──────────────────────────────────────────────────────────────┘
 *
 * CANCELLED(8) 不属本表：取消不是「从某状态推进到下一状态」的统一前置——主流路径由
 * cancel_requested_at + PDA 逆向归还驱动（释放动作在最终 CAS **之前**逐件发生），
 * 直连路径（PENDING 直接取消）的资源释放全部在 CAS **之后**（见进入表 CANCELLED 行）。
 */
const WT_ON_EXIT_ACTIONS = Object.freeze({
  [WT_STATUS.PENDING]:   [],
  [WT_STATUS.PICKING]:   ['assertTaskPickScanClosure'],  // 后端强校验拣货闭合（数量+扫码流水+容器锁三重核对）
  [WT_STATUS.SORTING]:   ['validateSortedQty'],           // 不满足则中止推进
  [WT_STATUS.CHECKING]:  ['updateCheckedQty', 'validateCheckedQty'],  // 不满足则中止推进
  [WT_STATUS.PACKING]:   ['validatePackageHasItems', 'validateAllPackagesDone'],  // 不满足则中止推进
  [WT_STATUS.SHIPPING]:  ['deductStock'],                 // [前] 同事务内 CAS 之前的前置扣减，失败则整笔回滚
  [WT_STATUS.SHIPPED]:   [],
  [WT_STATUS.CANCELLED]: [],
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
 * 取消（→CANCELLED）可从任意进行中状态（1-6）触发。
 */
// 改单（sale adjust）会用到的反向边：仅供 warehouse-tasks.adjust.js 的两个内部 action
// （adjustReopenPicking / adjustReopenChecking）使用，不对应任何用户可直接调用的入口，
// 见下方 WT_ACTION_RULES 里这两条各自的 allowed/toStatus 收窄范围。
const WT_TRANSITIONS = Object.freeze({
  [WT_STATUS.PENDING]:  [WT_STATUS.PICKING, WT_STATUS.CANCELLED],
  [WT_STATUS.PICKING]:  [WT_STATUS.SORTING,   WT_STATUS.CANCELLED],
  [WT_STATUS.SORTING]:  [WT_STATUS.CHECKING,  WT_STATUS.CANCELLED, WT_STATUS.PICKING],
  [WT_STATUS.CHECKING]: [WT_STATUS.PACKING,   WT_STATUS.CANCELLED, WT_STATUS.PICKING],
  [WT_STATUS.PACKING]:  [WT_STATUS.SHIPPING,  WT_STATUS.CANCELLED, WT_STATUS.PICKING, WT_STATUS.CHECKING],
  [WT_STATUS.SHIPPING]: [WT_STATUS.SHIPPED,   WT_STATUS.CANCELLED, WT_STATUS.PICKING, WT_STATUS.CHECKING],
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
  // 以下两条仅供 warehouse-tasks.adjust.js 内部调用，不对外暴露为用户可直接触发的 action。
  adjustReopenPicking: {
    // 改单增量：新增/追加的数量必然超出原本已拣数量，任务退回拣货中，让 PDA 把差额拣出来。
    allowed: [WT_STATUS.SORTING, WT_STATUS.CHECKING, WT_STATUS.PACKING, WT_STATUS.SHIPPING],
    toStatus: WT_STATUS.PICKING,
    message: '内部动作：因改单需要补拣，任务退回拣货中',
  },
  adjustReopenChecking: {
    // 改单减量命中已打包/已复核部分：物理退回分拣格后，任务退回待复核，让受影响商品重新走复核→打包。
    allowed: [WT_STATUS.PACKING, WT_STATUS.SHIPPING],
    toStatus: WT_STATUS.CHECKING,
    message: '内部动作：因改单退回分拣格，任务退回待复核',
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
  if (!rule) throw new AppError(`Unknown warehouse task action: ${action}`, 500, 'INTERNAL_CONFIG')
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
