import { cloneElement, useCallback, useLayoutEffect, useRef, useState, type ReactElement, type RefAttributes, type HTMLAttributes } from 'react'
import { useVirtualizer, type VirtualItem } from '@tanstack/react-virtual'
import { useSectionActive } from '@/components/layout/SectionVisibilityContext'

export const VIRTUAL_TABLE_THRESHOLD = 200

type RowElement = ReactElement<HTMLAttributes<HTMLTableRowElement> & RefAttributes<HTMLTableRowElement>>
interface Props<T> {
  data: T[]
  columns: number
  getRowKey: (row: T) => string | number
  renderRow: (row: T, index: number) => RowElement
}

/** 原生表格 + 可变行高；复用工作区滚动条，数据/选择/导出仍由调用方持有。 */
export function VirtualTableBody<T>({ data, columns, getRowKey, renderRow }: Props<T>) {
  const bodyRef = useRef<HTMLTableSectionElement>(null)
  const active = useSectionActive()
  const [margin, setMargin] = useState(0)
  const lastOffset = useRef(0)
  const lastView = useRef<{ items: VirtualItem[]; total: number }>({ items: [], total: data.length * 48 })
  const getScrollElement = useCallback(() => bodyRef.current?.closest<HTMLElement>('[data-workspace-scroll]')
    ?? bodyRef.current?.closest<HTMLElement>('[data-table-scroll]') ?? null, [])
  const itemKey = useCallback((index: number) => getRowKey(data[index]), [data, getRowKey])
  const virtualizer = useVirtualizer<HTMLElement, HTMLTableRowElement>({
    count: data.length,
    // 返回 null 只拆除观察者；enabled=false 会清除已测量行高并造成返回位置漂移。
    getScrollElement: () => active ? getScrollElement() : null,
    getItemKey: itemKey,
    estimateSize: () => 48,
    overscan: 8,
    scrollMargin: margin,
    initialOffset: () => lastOffset.current,
    measureElement: element => element.getBoundingClientRect().height,
  })

  useLayoutEffect(() => {
    if (!active) return
    const body = bodyRef.current, scroll = getScrollElement()
    if (!body || !scroll) return
    const updateMargin = () => {
      setMargin(Math.max(0, body.getBoundingClientRect().top - scroll.getBoundingClientRect().top + scroll.scrollTop))
    }
    updateMargin()
    // 统计卡片、查询条件和表头会改变列表起点；横向改列宽时行自身由 virtualizer 测量。
    const observer = new ResizeObserver(updateMargin)
    observer.observe(scroll)
    for (let parent = body.parentElement; parent && parent !== scroll; parent = parent.parentElement) observer.observe(parent)
    return () => observer.disconnect()
  }, [active, getScrollElement])

  const items = active ? virtualizer.getVirtualItems() : lastView.current.items
  const total = active ? virtualizer.getTotalSize() : lastView.current.total
  useLayoutEffect(() => {
    if (active) {
      lastOffset.current = getScrollElement()?.scrollTop ?? 0
      lastView.current = { items, total }
    }
  }, [active, getScrollElement, items, total])

  const top = items.length ? Math.max(0, items[0].start - margin) : 0
  const bottom = items.length ? Math.max(0, total - (items[items.length - 1].end - margin)) : total
  return <tbody ref={bodyRef} data-virtual-body>
    {top > 0 && <tr aria-hidden="true"><td colSpan={columns} style={{ height: top, padding: 0, border: 0 }} /></tr>}
    {items.map(item => data[item.index] && cloneElement(renderRow(data[item.index], item.index), {
      key: item.key,
      ref: virtualizer.measureElement,
      'data-index': item.index,
      'aria-rowindex': item.index + 2,
    } as HTMLAttributes<HTMLTableRowElement> & RefAttributes<HTMLTableRowElement>))}
    {bottom > 0 && <tr aria-hidden="true"><td colSpan={columns} style={{ height: bottom, padding: 0, border: 0 }} /></tr>}
  </tbody>
}
