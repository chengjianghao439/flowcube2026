/**
 * 编辑态辅助：从行对象里取「编辑对象」描述。
 *
 * 与 `@/components/shared/EditModeBadge` 配套使用——编辑态标题旁要说明正在编辑哪条记录。
 * 各页面行对象字段命名不统一（code / orderNo / name / title），这里按传入的键顺序取首个可用值。
 */
export function editTargetLabel(row: unknown, keys: string[] = ['code', 'name']): string {
  if (!row || typeof row !== 'object') return ''
  const record = row as Record<string, unknown>
  return keys
    .map(k => record[k])
    .filter((v): v is string => typeof v === 'string' && v.trim() !== '')
    .join(' · ')
}

/**
 * 「是否改过」判定用的明细行快照：剔除 `units` 这类 UI-only 投影字段。
 *
 * 编辑单据时，前端会异步拉取每个商品的「多计量单位」回填到明细行（`units`），
 * 它不属于用户改动；若把它算进脏检查，编辑态一打开就会被误判成「未保存」，
 * 并连带误触发关闭标签的未保存拦截。
 */
export function dirtyItems<T extends { units?: unknown }>(items: T[]): Array<Omit<T, 'units'>> {
  return items.map(({ units: _units, ...rest }) => rest)
}
