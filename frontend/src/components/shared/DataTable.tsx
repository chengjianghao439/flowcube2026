import { useCallback, useMemo, type ReactNode } from 'react'
import { useTableColumns, isAction } from './useTableColumns'
import { VirtualTableBody, VIRTUAL_TABLE_THRESHOLD } from './VirtualTableBody'
import { Inbox } from 'lucide-react'
import { TableTextPreview } from './TableTextPreview'
import { TableColumnHeader } from './TableColumnHeader'
import type { TableColumn } from '@/types'

interface DataTableProps<T extends object> {
  columns: TableColumn<T>[]
  data: T[]
  loading?: boolean
  /** 达到 200 行时仅渲染可见行，选择和导出仍使用完整数据。 */
  virtualized?: boolean
  /** 虚拟行内有键盘操作时保留聚焦行，失焦后恢复普通可视范围。 */
  preserveFocus?: boolean
  /** 行内打开模态时暂存原聚焦行，供关闭后的原按钮回焦。 */
  retainFocusedRow?: boolean
  rowKey?: keyof T
  emptyText?: string
  /** 页面按当前查询状态提供空态说明与操作；不影响表头、加载或行数据。 */
  emptyState?: ReactNode
  /** 兼容旧用法：等价于 selectionMode="multiple" */
  selectable?: boolean
  /** 多选模式：显示 checkbox 列，受控 selectedIds/onSelectionChange */
  selectionMode?: 'multiple'
  /** 多选模式下哪些行可勾选（返回 false 的行 checkbox 禁用） */
  selectableCheck?: (row: T) => boolean
  selectedIds?: Set<number>
  /** 选中变化回调（onSelectChange 的别名，命名与 selectionMode 呼应） */
  onSelectionChange?: (ids: Set<number>) => void
  onSelectChange?: (ids: Set<number>) => void
  onRowDoubleClick?: (row: T) => void
  columnStorageKey?: string
  /** 当前排序字段（配合 col.sortable 使用），受控由调用方维护 */
  sortKey?: string
  sortDirection?: 'asc' | 'desc'
  onSortChange?: (key: string) => void
  /**
   * 默认按百分比铺满容器，兼容旧比例设置；手动调整后按像素独立记忆列宽。
   * 没有已保存宽度时使用 col.width 的默认布局。
   */
  fluid?: boolean
}

export default function DataTable<T extends object>({
  columns, data, loading = false, virtualized = false, preserveFocus = false, retainFocusedRow = false,
  rowKey = 'id' as keyof T, emptyText = '暂无数据', emptyState,
  selectable = false, selectionMode, selectedIds, onSelectChange, onSelectionChange, selectableCheck,
  onRowDoubleClick,
  columnStorageKey,
  sortKey, sortDirection, onSortChange,
  fluid = false,
}: DataTableProps<T>) {
  const isSelectEnabled = !!(selectable || selectionMode)
  const { orderedColumns, usesPercent, getColumnWidth, getPercentColumnWidth, percentMinWidth, colgroupRef, tableRef, tableWidth, hasCustomWidths, setDraggingKey, draggingKey, moveColumn, startResize, fitColumn, resizeCleanupRef, measureWidths, savePixelWidths } = useTableColumns({ columns, fluid, columnStorageKey, isSelectEnabled, fitData: virtualized ? data : undefined })

  const enabledIds = useMemo(() => data.filter(row => !selectableCheck || selectableCheck(row))
    .map(row => Number((row as Record<string, unknown>)[String(rowKey)])), [data, rowKey, selectableCheck])
  const allSelected = enabledIds.length > 0 && enabledIds.every(id => selectedIds?.has(id))
  const someSelected = !allSelected && enabledIds.some(id => selectedIds?.has(id))

  const handleSelectChange = (next: Set<number>) => {
    if (onSelectionChange) onSelectionChange(next)
    else onSelectChange?.(next)
  }

  const toggleAll = () => {
    if (!onSelectChange && !onSelectionChange) return
    if (allSelected) {
      const next = new Set(selectedIds)
      enabledIds.forEach(id => next.delete(id))
      handleSelectChange(next)
    } else {
      const next = new Set(selectedIds)
      enabledIds.forEach(id => next.add(id))
      handleSelectChange(next)
    }
  }

  const toggleRow = (id: number) => {
    if (!onSelectChange && !onSelectionChange) return
    const next = new Set(selectedIds)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    handleSelectChange(next)
  }

  const colCount = orderedColumns.length + (isSelectEnabled ? 1 : 0)

  const renderRow = (row: T, rowIndex: number) => {
    const rowId = Number((row as Record<string, unknown>)[String(rowKey)])
    const isSelected = selectedIds?.has(rowId) ?? false
    const rowSelectable = selectableCheck ? selectableCheck(row) : true
    return (
      <tr
        key={String(row[rowKey])}
        data-selected={isSelected || undefined}
        onDoubleClick={onRowDoubleClick ? () => onRowDoubleClick(row) : undefined}
        className={`group min-h-12 border-b border-border/70 last:border-0 transition-colors ${
          isSelected ? 'bg-primary/[0.07]' : 'hover:bg-muted/30'
        } ${onRowDoubleClick ? 'cursor-pointer' : ''}`}
      >
        {isSelectEnabled && (
          <td className="px-4">
            <input
              type="checkbox"
              aria-label={`选择第 ${rowIndex + 1} 行`}
              checked={isSelected}
              disabled={!rowSelectable}
              onChange={() => toggleRow(rowId)}
              className="h-4 w-4 cursor-pointer rounded"
              title={rowSelectable ? undefined : '该行不可勾选'}
            />
          </td>
        )}
        {orderedColumns.map((col) => {
          const rawValue = (row as Record<string, unknown>)[String(col.key)]
          const textValue = String(rawValue ?? '')
          const alignClass = col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : ''
          return (
          <td
            key={String(col.key)}
            data-column-key={String(col.key)}
            onDoubleClick={isAction(String(col.key), col.title) ? e => e.stopPropagation() : undefined}
            className="overflow-hidden px-4 py-2.5 text-foreground align-middle"
          >
            {isAction(String(col.key), col.title)
              // 极窄操作列在格内滚动，保留所有按钮的可达性，避免越界覆盖相邻列。
              ? <div className={`min-w-0 overflow-x-auto ${alignClass}`}>{col.render ? (col.render(rawValue, row) as ReactNode) : textValue}</div>
              : (
                <div className={`min-w-0 whitespace-normal [overflow-wrap:anywhere] ${alignClass}`} title={textValue}>
                  {col.expandableText && typeof rawValue === 'string' && rawValue.trim().length > 0 ? (
                    <TableTextPreview title={col.title} value={textValue}>{col.render ? (col.render(rawValue, row) as ReactNode) : textValue}</TableTextPreview>
                  ) : col.render ? (col.render(rawValue, row) as ReactNode) : textValue}
                </div>
              )}
          </td>
          )
        })}
      </tr>
    )
  }

  const renderVirtual = virtualized && !loading && data.length >= VIRTUAL_TABLE_THRESHOLD
  const getRowKey = useCallback((row: T) => String(row[rowKey]), [rowKey])
  return (
    <div className="desktop-table min-w-0 max-w-full rounded-lg border border-border bg-card overflow-hidden">
      <div className="overflow-x-auto" data-table-scroll>
        <table aria-rowcount={renderVirtual ? data.length + 1 : undefined} ref={tableRef} aria-busy={loading} className="table-fixed text-sm" style={usesPercent ? { width: '100%', minWidth: percentMinWidth } : { width: tableWidth, minWidth: hasCustomWidths ? 0 : '100%' }}>
          <colgroup ref={colgroupRef}>
            {isSelectEnabled && <col style={{ width: 56 }} />}
            {orderedColumns.map(col => (
              <col key={String(col.key)} style={{ width: usesPercent ? getPercentColumnWidth(col) : getColumnWidth(col) }} />
            ))}
          </colgroup>
          <thead>
            <tr className="data-table-header-surface border-b border-border">
              {isSelectEnabled && (
                <th scope="col" className="w-10 px-4 py-2.5">
                  <input
                    type="checkbox"
                    aria-label="选择当前结果中所有可选行"
                    checked={allSelected}
                    ref={el => { if (el) el.indeterminate = someSelected }}
                    onChange={toggleAll}
                    className="h-4 w-4 cursor-pointer rounded"
                  />
                </th>
              )}
              {orderedColumns.map((col) => (
                <TableColumnHeader
                  key={String(col.key)}
                  column={col}
                  layout={{ startResize, fitColumn, measureWidths, savePixelWidths }}
                  aria-sort={sortKey === String(col.key) ? (sortDirection === 'asc' ? 'ascending' : 'descending') : undefined}
                  draggable
                  onDragStart={event => { if (resizeCleanupRef.current) event.preventDefault(); else setDraggingKey(String(col.key)) }}
                  onDragOver={(e) => {
                    if (draggingKey && draggingKey !== String(col.key)) e.preventDefault()
                  }}
                  onDrop={(e) => {
                    e.preventDefault()
                    moveColumn(String(col.key))
                  }}
                  onDragEnd={() => setDraggingKey(null)}
                  className="cursor-move select-none"
                >
                    {col.sortable && onSortChange ? (
                      <button
                        type="button"
                        aria-label={`按${col.title}排序`}
                        onClick={() => onSortChange(String(col.key))}
                        className={`min-w-0 flex-1 whitespace-normal [overflow-wrap:anywhere] transition-colors hover:text-foreground ${
                          col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : 'text-left'
                        } ${sortKey === String(col.key) ? 'text-primary' : ''}`}
                        title={col.title}
                      >
                        {col.title} {sortKey === String(col.key) ? (sortDirection === 'asc' ? '↑' : '↓') : ''}
                      </button>
                    ) : undefined}
                </TableColumnHeader>
              ))}
            </tr>
          </thead>
          {renderVirtual ? <VirtualTableBody data={data} columns={colCount} getRowKey={getRowKey} renderRow={renderRow} preserveFocus={preserveFocus} retainFocusedRow={retainFocusedRow} /> : <tbody>
            {loading ? (
              // Skeleton rows
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i} className="border-b border-border last:border-0">
                  {isSelectEnabled && <td className="min-h-12 px-4 py-2.5" />}
                  {orderedColumns.map((col) => (
                    <td key={String(col.key)} className="min-h-12 px-4 py-2.5">
                      <div className="h-3.5 w-3/4 animate-pulse rounded bg-muted" />
                    </td>
                  ))}
                </tr>
              ))
            ) : data.length === 0 ? (
              <tr>
                <td colSpan={colCount} className={emptyState ? 'px-4 text-center' : 'px-4 py-16 text-center'}>
                  {emptyState ?? <div className="fc-table-empty flex flex-col items-center gap-2 text-muted-foreground">
                    <Inbox className="h-8 w-8 opacity-40" />
                    <span className="text-sm">{emptyText}</span>
                  </div>}
                </td>
              </tr>
            ) : (
              data.map(renderRow)
            )}
          </tbody>}
        </table>
      </div>

    </div>
  )
}
