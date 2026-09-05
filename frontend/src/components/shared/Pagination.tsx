import { PaginationArrow } from '@/components/shared/PaginationArrow'

interface PaginationProps {
  page: number
  totalPages: number
  total: number
  /** 列表文案，如「张」「条」「单」；显示「共 {total.toLocaleString()} {unit}」 */
  unit?: string
  onPageChange: (page: number) => void
}

/**
 * 通用列表分页控件（真分页列表页统一用它）。
 * 参照 accounting/vouchers 的行内写法抽出来，避免每个列表页各写一份「上一页/下一页」。
 * 有数据时即展示总数；total 用于显示「共 N 条」。
 */
export default function Pagination({ page, totalPages, total, unit = '条', onPageChange }: PaginationProps) {
  if (total <= 0 && totalPages <= 1) return null
  return (
    <div className="mt-3 flex flex-wrap items-center justify-end gap-2 rounded-lg border border-border bg-card px-4 py-2.5 text-sm">
      <span className="mr-auto text-xs text-muted-foreground">共 {total.toLocaleString()} {unit}</span>
      <PaginationArrow direction="previous" disabled={page <= 1} onClick={() => onPageChange(page - 1)} />
      <span className="tabular-nums">{page} / {totalPages}</span>
      <PaginationArrow direction="next" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)} />
    </div>
  )
}
