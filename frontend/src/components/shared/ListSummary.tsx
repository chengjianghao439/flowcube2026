/** 列表只显示记录总数，不提供分页或截断数据。 */
export default function ListSummary({ total, unit = '条' }: { total: number; unit?: string }) {
  return <div className="px-1 py-3 text-xs text-muted-foreground" role="status">共 {total.toLocaleString()} {unit}</div>
}
