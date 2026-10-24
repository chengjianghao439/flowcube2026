import { useCallback, useRef, type ReactElement, type HTMLAttributes, type RefAttributes } from 'react'
import { useTableColumns } from '@/components/shared/useTableColumns'
import { TableColumnHeader } from '@/components/shared/TableColumnHeader'
import { VirtualTableBody, VIRTUAL_TABLE_THRESHOLD } from '@/components/shared/VirtualTableBody'
import type { TableColumn } from '@/types'

const pickerColumns: TableColumn<Record<string, unknown>>[] = [
  { key: 'product', title: '商品', width: 34, minWidth: 220 },
  { key: 'quantity', title: '本次数量', width: 15, minWidth: 144, align: 'right' },
  { key: 'source', title: '采购来源', width: 18, minWidth: 140 },
  { key: 'warehouse', title: '仓库', width: 9, minWidth: 70 },
  { key: 'progress', title: '订单 / 已收 / 未收', width: 14, minWidth: 110, align: 'right' },
  { key: 'price', title: '单价', width: 10, minWidth: 90, align: 'right' },
]
const entryColumns: TableColumn<Record<string, unknown>>[] = [
  { key: 'product', title: '商品', width: 40, minWidth: 220 },
  { key: 'quantity', title: '本次到货', width: 14, minWidth: 144, align: 'right' },
  { key: 'source', title: '采购来源', width: 18, minWidth: 140 },
  { key: 'warehouse', title: '仓库', width: 10, minWidth: 70 },
  { key: 'price', title: '单价', width: 12, minWidth: 90, align: 'right' },
  { key: 'actions', title: '操作', width: 8, minWidth: 80, align: 'center' },
]

type RowElement = ReactElement<HTMLAttributes<HTMLTableRowElement> & RefAttributes<HTMLTableRowElement>>
export function InboundEntryTable<T>({ data, getRowKey, renderRow, picker = false }: {
  data: T[]; getRowKey: (row: T) => number; renderRow: (row: T, index: number) => RowElement; picker?: boolean
}) {
  const columns = picker ? pickerColumns : entryColumns
  const scrollToIndex = useRef<((index: number) => void) | null>(null)
  const registerScroll = useCallback((scroll: ((index: number) => void) | null) => { scrollToIndex.current = scroll }, [])
  const layout = useTableColumns({ columns, fluid: true, columnStorageKey: picker ? 'inbound-picker-items' : 'inbound-entry-items', isSelectEnabled: false })
  return <table ref={layout.tableRef} aria-rowcount={data.length + 1} data-inbound-entry-table
    className="isolate table-fixed text-sm [&_td]:px-3 [&_td]:py-2 [&_td]:align-middle [&_td]:[overflow-wrap:anywhere]"
    style={layout.usesPercent ? { width: '100%', minWidth: layout.percentMinWidth } : { width: layout.tableWidth, minWidth: layout.hasCustomWidths ? 0 : '100%' }}
    onKeyDown={event => {
      const input = event.target
      if (!(input instanceof HTMLInputElement) || !['Enter', 'ArrowDown', 'ArrowUp', ...(picker ? ['Tab'] : [])].includes(event.key)) return
      const rowIndex = data.findIndex(row => String(getRowKey(row)) === input.dataset.purchaseItemId)
      const next = rowIndex + (event.key === 'ArrowUp' || (event.key === 'Tab' && event.shiftKey) ? -1 : 1)
      if (rowIndex < 0 || next < 0 || next >= data.length) return
      event.preventDefault()
      scrollToIndex.current?.(next)
      const table = event.currentTarget, id = getRowKey(data[next])
      let tries = 0
      const focus = () => {
        const target = table.querySelector<HTMLInputElement>(`input[data-purchase-item-id="${id}"]`)
        if (target) { target.focus(); target.select() } else if (++tries < 20) requestAnimationFrame(focus)
      }
      requestAnimationFrame(focus)
    }}>
    <colgroup ref={layout.colgroupRef}>{columns.map(col => <col key={String(col.key)} style={{ width: layout.usesPercent ? layout.getPercentColumnWidth(col) : layout.getColumnWidth(col) }} />)}</colgroup>
    <thead data-resizable className="data-table-header sticky top-0 z-10"><tr>{columns.map(col => <TableColumnHeader key={String(col.key)} column={col} layout={layout} />)}</tr></thead>
    {data.length >= VIRTUAL_TABLE_THRESHOLD ? <VirtualTableBody data={data} columns={columns.length} getRowKey={getRowKey} renderRow={renderRow} preserveFocus onScrollToIndexReady={registerScroll} /> : <tbody>{data.map((row, index) => <Row key={getRowKey(row)} row={renderRow(row, index)} />)}</tbody>}
  </table>
}
function Row({ row }: { row: RowElement }) { return row }
