/**
 * 分布类图表的系列上限（2026-09-19 收敛为单一实现）。
 *
 * 仓库、资金账户这类主数据数量没有上界（开发库 253 个仓库、94 个启用账户），全量成系列会同时
 * 毁掉图例、坐标轴和配色——饼图的 `PIE_COLORS` 只有 8 色，第 9 个账户开始颜色重复，切片无法区分。
 * 因此分布类图表统一取 Top N + 「其他 N 个」合并。
 *
 * 合并逻辑此前在 `ChartWidgets` 里写了两份（各仓库存价值、账户余额），财务看板的账户余额饼图
 * 则完全没有上限（2026-09-19 发现的漏改），所以抽到这里供三处共用；改口径只改这一份。
 */
export const TOP_SERIES_LIMIT = 8

export interface TopSeriesOptions<T> {
  /** 排序与合计依据的数值（余额、库存价值等）。 */
  value: (item: T) => number
  /**
   * 构造「其他」聚合项：`rest` 是被合并的原始项（已按 value 降序），`restValue` 是它们的合计。
   * 名称文案由调用方给出（「其他 N 个仓」/「其他 N 个账户」），需要守恒的其余字段
   * （例如饼图占比 share）也在这里一并算出，避免调用方再遍历一次。
   */
  makeRest: (rest: readonly T[], restValue: number) => T
}

/**
 * 按 `value` 降序排序，取前 `TOP_SERIES_LIMIT` 项；超出的合并为一个「其他」项。
 * 不超过上限时只排序、不加聚合项，返回长度等于入参长度。
 */
export function limitTopSeries<T>(all: readonly T[], options: TopSeriesOptions<T>): T[] {
  const { value, makeRest } = options
  const sorted = [...all].sort((a, b) => value(b) - value(a))
  if (sorted.length <= TOP_SERIES_LIMIT) return sorted
  const rest = sorted.slice(TOP_SERIES_LIMIT)
  const restValue = rest.reduce((sum, item) => sum + value(item), 0)
  return [...sorted.slice(0, TOP_SERIES_LIMIT), makeRest(rest, restValue)]
}
