import { useCallback, useRef } from 'react'
import { moveFinderFocus } from '@/lib/finderNavigation'
import type { FinderColumn } from '@/types/finder'
import { VirtualTableBody, VIRTUAL_TABLE_THRESHOLD } from '@/components/shared/VirtualTableBody'
import { cn } from '@/lib/utils'

/** Opt-in presentation for the sale customer picker; selection remains in CustomerFinder. */
export function FinderDataTable<T extends Record<string, unknown>>({ columns, data, selected, onSelect, onConfirm, getRowKey, isLoading }: {
  columns: FinderColumn<T>[]; data: T[]; selected: T | null; onSelect: (row: T) => void
  onConfirm: (row: T) => void; getRowKey: (row: T) => number; isLoading: boolean
}) {
  const scrollToIndex = useRef<((index: number) => void) | null>(null)
  const registerScroll = useCallback((scroll: ((index: number) => void) | null) => { scrollToIndex.current = scroll }, [])
  const renderRow = (row: T, index: number) => <tr key={getRowKey(row)} role="row" data-finder-key={getRowKey(row)} aria-selected={selected ? getRowKey(selected) === getRowKey(row) : false} tabIndex={0}
    onClick={() => onSelect(row)} onDoubleClick={() => onConfirm(row)}
    onKeyDown={event => {
      if (isLoading) return
      if (event.key === ' ') { event.preventDefault(); onSelect(row) }
      if (event.key === 'Enter') { event.preventDefault(); onConfirm(row) }
      moveFinderFocus(event, data, index, getRowKey, scrollToIndex.current)
    }} className={cn('cursor-pointer border-b text-sm outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring', selected && getRowKey(selected) === getRowKey(row) ? 'bg-primary/10' : 'hover:bg-muted/40')}>
    {columns.map(column => <td role="gridcell" key={column.key} className={cn('break-words px-4 py-3 leading-5', column.align === 'right' && 'text-right', column.align === 'center' && 'text-center')}>
      {column.render ? column.render(row[column.key], row) : row[column.key] != null && row[column.key] !== '' ? String(row[column.key]) : '—'}
    </td>)}
  </tr>
  return <table role="grid" aria-label="查询结果" aria-readonly="true" aria-busy={isLoading} aria-rowcount={data.length + 1} className="w-full min-w-[580px] table-fixed">
    <colgroup>{columns.map(col => <col key={col.key} style={{ width: col.width }} />)}</colgroup>
    <thead className="sticky top-0 z-10 data-table-header"><tr role="row">{columns.map(col => <th role="columnheader" key={col.key} className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">{col.title}</th>)}</tr></thead>
    {data.length >= VIRTUAL_TABLE_THRESHOLD ? <VirtualTableBody data={data} columns={columns.length} getRowKey={getRowKey} renderRow={renderRow} onScrollToIndexReady={registerScroll} /> : <tbody>{data.map(renderRow)}</tbody>}
    {!data.length && <tbody><tr><td colSpan={columns.length} className="px-4 py-12 text-center text-sm text-muted-foreground">{isLoading ? '正在查询…' : '没有匹配的客户'}</td></tr></tbody>}
  </table>
}
