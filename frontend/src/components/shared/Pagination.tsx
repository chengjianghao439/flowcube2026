import { Button } from '@/components/ui/button'

interface PaginationProps {
  page: number
  totalPages: number
  total: number
  /** 列表文案，如「张」「条」「单」；显示「共 {total} {unit}」 */
  unit?: string
  onPageChange: (page: number) => void
}

/**
 * 通用列表分页控件（真分页列表页统一用它）。
 * 参照 accounting/vouchers 的行内写法抽出来，避免每个列表页各写一份「上一页/下一页」。
 * 仅在有第二页时才渲染；total 用于显示「共 N 条」。
 */
export default function Pagination({ page, totalPages, total, unit = '条', onPageChange }: PaginationProps) {
  if (totalPages <= 1) return null
  return (
    <div className="mt-3 flex items-center justify-end gap-2 text-sm">
      <span className="text-muted-foreground">共 {total} {unit}</span>
      <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>上一页</Button>
      <span className="tabular-nums">{page} / {totalPages}</span>
      <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}>下一页</Button>
    </div>
  )
}
