/**
 * 仓库任务状态常量 — 统一定义，所有模块引用此文件
 *
 * 业务流程：
 *   拣货中(2) → 待分拣(3) → 待复核(4) → 待打包(5) → 待出库(6) → 已出库(7)
 *   任意阶段 → 已取消(8)
 */

export const WT_STATUS = Object.freeze({
  /** 待拣货 — 已创建但尚未开始拣货（当前跳过，直接进入 PICKING） */
  PENDING:   1,
  /** 拣货中 — PDA 正在执行拣货作业 */
  PICKING:   2,
  /** 待分拣 — 拣货完成，等待 Put Wall 分拣 */
  SORTING:   3,
  /** 待复核 — 分拣完成，等待人工复核商品数量 */
  CHECKING:  4,
  /** 待打包 — 复核通过，等待装箱打包 */
  PACKING:   5,
  /** 待出库 — 打包完成，等待出库发货确认 */
  SHIPPING:  6,
  /** 已出库 — 出库完成，库存已扣减，应收账款已生成 */
  SHIPPED:   7,
  /** 已取消 — 任务已取消，关联销售单状态同步为已取消 */
  CANCELLED: 8,
} as const)

export type WtStatus = typeof WT_STATUS[keyof typeof WT_STATUS]

/** 状态名称映射 */
export const WT_STATUS_NAME: Record<WtStatus, string> = {
  [WT_STATUS.PENDING]:   '待拣货',
  [WT_STATUS.PICKING]:   '拣货中',
  [WT_STATUS.SORTING]:   '待分拣',
  [WT_STATUS.CHECKING]:  '待复核',
  [WT_STATUS.PACKING]:   '待打包',
  [WT_STATUS.SHIPPING]:  '待出库',
  [WT_STATUS.SHIPPED]:   '已出库',
  [WT_STATUS.CANCELLED]: '已取消',
}

/** 状态徽章样式映射 */
export const WT_STATUS_CLASS: Record<WtStatus, string> = {
  [WT_STATUS.PENDING]:   'bg-gray-100 text-gray-600 border-gray-200',
  [WT_STATUS.PICKING]:   'bg-primary/10 text-primary border-primary/20',
  [WT_STATUS.SORTING]:   'bg-yellow-100 text-yellow-700 border-yellow-200',
  [WT_STATUS.CHECKING]:  'bg-purple-100 text-purple-700 border-purple-200',
  [WT_STATUS.PACKING]:   'bg-orange-100 text-orange-700 border-orange-200',
  [WT_STATUS.SHIPPING]:  'bg-cyan-100 text-cyan-700 border-cyan-200',
  [WT_STATUS.SHIPPED]:   'bg-green-100 text-green-700 border-green-200',
  [WT_STATUS.CANCELLED]: 'bg-red-100 text-red-600 border-red-200',
}

/** 进行中的状态列表（未完成且未取消）*/
export const WT_STATUS_ACTIVE: WtStatus[] = [
  WT_STATUS.PENDING,
  WT_STATUS.PICKING,
  WT_STATUS.SORTING,
  WT_STATUS.CHECKING,
  WT_STATUS.PACKING,
  WT_STATUS.SHIPPING,
]

/** PDA 拣货任务池状态 */
export const WT_STATUS_PICK_POOL: WtStatus[] = [WT_STATUS.PENDING, WT_STATUS.PICKING]

/** 终态（不可再修改）*/
export const WT_STATUS_TERMINAL: WtStatus[] = [WT_STATUS.SHIPPED, WT_STATUS.CANCELLED]

/**
 * 状态进入行为表（文档性）
 * 说明进入每个状态时系统需要执行的业务动作（由对应 service 函数负责）
 */
export const WT_ON_ENTER_ACTIONS: Readonly<Partial<Record<WtStatus, string[]>>> = Object.freeze({
  [WT_STATUS.PENDING]:   [],  // 待拣货：创建后直接跳过，无额外动作（当前系统以 PICKING 创建）
  [WT_STATUS.PICKING]:   ['assignSortingBin', 'clearOrphanedContainerLocks'],
  [WT_STATUS.SORTING]:   ['syncSaleOrderStatus:3'],
  [WT_STATUS.CHECKING]:  ['releaseSortingBin', 'clearSortingBinFields', 'updateSortedQty'],
  [WT_STATUS.PACKING]:   [],
  [WT_STATUS.SHIPPING]:  ['autoTriggerByFinishPackage'],
  [WT_STATUS.SHIPPED]:   ['deductStock', 'unlockContainers', 'syncSaleOrderStatus:4', 'createPaymentRecord', 'setShippedAt'],
  [WT_STATUS.CANCELLED]: ['unlockContainers', 'releaseSortingBin', 'clearSortingBinFields', 'syncSaleOrderStatus:5'],
})


/** 状态退出行为表（文档性）*/
export const WT_ON_EXIT_ACTIONS: Readonly<Record<WtStatus, string[]>> = Object.freeze({
  [WT_STATUS.PENDING]:   [],
  [WT_STATUS.PICKING]:   [],
  [WT_STATUS.SORTING]:   ['validateSortedQty'],
  [WT_STATUS.CHECKING]:  ['updateCheckedQty', 'validateCheckedQty'],
  [WT_STATUS.PACKING]:   ['validatePackageHasItems', 'validateAllPackagesDone'],
  [WT_STATUS.SHIPPING]:  ['deductStock'],
  [WT_STATUS.SHIPPED]:   [],
  [WT_STATUS.CANCELLED]: ['unlockContainers', 'releaseSortingBin', 'clearSortingBinFields'],
})

export const WT_TRANSITIONS: Readonly<Record<WtStatus, WtStatus[]>> = Object.freeze({
  [WT_STATUS.PENDING]:   [WT_STATUS.PICKING],
  [WT_STATUS.PICKING]:   [WT_STATUS.SORTING,   WT_STATUS.CANCELLED],
  [WT_STATUS.SORTING]:   [WT_STATUS.CHECKING,  WT_STATUS.CANCELLED],
  [WT_STATUS.CHECKING]:  [WT_STATUS.PACKING,   WT_STATUS.CANCELLED],
  [WT_STATUS.PACKING]:   [WT_STATUS.SHIPPING,  WT_STATUS.CANCELLED],
  [WT_STATUS.SHIPPING]:  [WT_STATUS.SHIPPED,   WT_STATUS.CANCELLED],
  [WT_STATUS.SHIPPED]:   [],
  [WT_STATUS.CANCELLED]: [],
})

/** 校验状态迁移是否合法 */
export function isValidTransition(from: WtStatus, to: WtStatus): boolean {
  const allowed = WT_TRANSITIONS[from]
  if (!allowed) return false
  return allowed.includes(to)
}

/** 看板列定义 */
export const WT_KANBAN_COLUMNS = [
  { status: WT_STATUS.PICKING,   label: '拣货中',  accentClass: 'bg-primary/10' },
  { status: WT_STATUS.SORTING,   label: '待分拣',  accentClass: 'bg-yellow-500/10' },
  { status: WT_STATUS.CHECKING,  label: '待复核',  accentClass: 'bg-purple-500/10' },
  { status: WT_STATUS.PACKING,   label: '待打包',  accentClass: 'bg-orange-500/10' },
  { status: WT_STATUS.SHIPPING,  label: '待出库',  accentClass: 'bg-cyan-500/10' },
  { status: WT_STATUS.SHIPPED,   label: '已出库',  accentClass: 'bg-green-500/10' },
  { status: WT_STATUS.CANCELLED, label: '已取消',  accentClass: 'bg-red-500/5' },
] as const

/** 筛选选项列表（含「全部」）*/
export const WT_STATUS_OPTIONS = [
  { value: '',                          label: '全部状态' },
  { value: String(WT_STATUS.PICKING),   label: '拣货中' },
  { value: String(WT_STATUS.SORTING),   label: '待分拣' },
  { value: String(WT_STATUS.CHECKING),  label: '待复核' },
  { value: String(WT_STATUS.PACKING),   label: '待打包' },
  { value: String(WT_STATUS.SHIPPING),  label: '待出库' },
  { value: String(WT_STATUS.SHIPPED),   label: '已出库' },
  { value: String(WT_STATUS.CANCELLED), label: '已取消' },
]
