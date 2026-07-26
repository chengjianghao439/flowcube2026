/**
 * 状态徽章配色的唯一权威来源。
 *
 * 全站所有「状态」显示——单据状态、仓库任务状态、启用/停用、打印结果、
 * 分类标识——都必须经 `SoftStatusLabel` / `StatusBadge` 渲染，配色从这里取。
 * 形态固定为「浅底 + 同色描边 + 同色文字」的小号胶囊，**只用颜色区分语义，
 * 不允许各页面自己发挥**（历史上出现过实心 Badge、bg-green-50、bg-blue-100
 * 三套写法混排，同一张表里两种状态长得完全不一样）。
 *
 * tone 名与后端常量保持一致：`backend/src/constants/` 里的 WT_STATUS_TONE /
 * SALE_STATUS_TONE 产出 draft / active / success / danger，经
 * `npm run generate:status` 落到 `src/generated/status.ts`。新增 tone 只能往
 * 这里加，不能在页面里另起炉灶。
 */
export const STATUS_TONE_CLASS = {
  /** 中性态：草稿、停用、空闲、未开始——尚未发生任何事 */
  draft: 'bg-muted text-muted-foreground border-border',
  /** 进行中：已占库、拣货中、收货中、待上架，一切流程内的中间态 */
  active: 'bg-primary/10 text-primary border-primary/20',
  /** 终态成功：已完成、已出库、已执行、启用、质检合格 */
  success: 'bg-success/10 text-success border-success/20',
  /** 需要留意但不算失败：在途、超时待确认、部分完成、逾期临近 */
  warning: 'bg-warning/10 text-warning border-warning/20',
  /** 失败或终止：已取消、打印失败、异常、逾期 */
  danger: 'bg-destructive/10 text-destructive border-destructive/20',
  /** 分类标识：仓库类型、角色、价格等级——不表达进度，只作区分 */
  info: 'bg-info/10 text-info border-info/20',
} as const

export type StatusTone = keyof typeof STATUS_TONE_CLASS

/** 布尔型启用状态的统一取色：启用=成功绿，停用=中性灰（停用不是错误，别用红） */
export function activeTone(isActive: boolean | number | null | undefined): StatusTone {
  return isActive ? 'success' : 'draft'
}
