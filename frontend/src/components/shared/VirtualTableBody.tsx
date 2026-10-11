import { Fragment, cloneElement, useCallback, useLayoutEffect, useRef, useState, type ReactElement, type RefAttributes, type HTMLAttributes } from 'react'
import { defaultRangeExtractor, useVirtualizer, type Range, type VirtualItem } from '@tanstack/react-virtual'
import { useSectionActive } from '@/components/layout/SectionVisibilityContext'

export const VIRTUAL_TABLE_THRESHOLD = 200

type RowElement = ReactElement<HTMLAttributes<HTMLTableRowElement> & RefAttributes<HTMLTableRowElement>>
interface Props<T> {
  data: T[]
  preserveFocus?: boolean
  columns: number
  getRowKey: (row: T) => string | number
  renderRow: (row: T, index: number) => RowElement
  /** 调用方为屏幕外的受控录入行定位；默认列表不使用。 */
  onScrollToIndexReady?: (scroll: ((index: number) => void) | null) => void
}

/** 原生表格 + 可变行高；复用工作区滚动条，数据/选择/导出仍由调用方持有。 */
export function VirtualTableBody<T>({ data, columns, getRowKey, renderRow, onScrollToIndexReady, preserveFocus = false }: Props<T>) {
  const bodyRef = useRef<HTMLTableSectionElement>(null)
  const [focusedKey, setFocusedKey] = useState<string | number | null>(null)
  const focusedIndex = preserveFocus && focusedKey != null ? data.findIndex(row => getRowKey(row) === focusedKey) : -1
  const rangeExtractor = useCallback((range: Range) => {
    const indices = defaultRangeExtractor(range)
    return focusedIndex < 0 ? indices : [...new Set([...indices, focusedIndex])].sort((a, b) => a - b)
  }, [focusedIndex])
  const active = useSectionActive()
  const [margin, setMargin] = useState(0)
  const lastOffset = useRef(0)
  const lastView = useRef<{ items: VirtualItem[]; total: number }>({ items: [], total: data.length * 48 })
  const getScrollElement = useCallback(() => bodyRef.current?.closest<HTMLElement>('[data-workspace-scroll]')
    ?? bodyRef.current?.closest<HTMLElement>('[data-table-scroll]') ?? null, [])
  const itemKey = useCallback((index: number) => getRowKey(data[index]), [data, getRowKey])
  const virtualizer = useVirtualizer<HTMLElement, HTMLTableRowElement>({
    count: data.length,
    rangeExtractor,
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
  useLayoutEffect(() => {
    onScrollToIndexReady?.(index => virtualizer.scrollToIndex(index, { align: 'auto' }))
    return () => onScrollToIndexReady?.(null)
  }, [onScrollToIndexReady, virtualizer])
  const total = active ? virtualizer.getTotalSize() : lastView.current.total
  useLayoutEffect(() => {
    if (active) {
      lastOffset.current = getScrollElement()?.scrollTop ?? 0
      lastView.current = { items, total }
    }
  }, [active, getScrollElement, items, total])

  const top = items.length ? Math.max(0, items[0].start - margin) : 0
  const bottom = items.length ? Math.max(0, total - (items[items.length - 1].end - margin)) : total
  return <tbody ref={bodyRef} data-virtual-body onFocusCapture={preserveFocus ? event => {
    const index = Number((event.target as HTMLElement).closest('tr')?.getAttribute('data-index'))
    if (data[index]) setFocusedKey(getRowKey(data[index]))
  } : undefined} onBlurCapture={preserveFocus ? event => {
    if (!(event.relatedTarget instanceof Node) || !bodyRef.current?.contains(event.relatedTarget)) setFocusedKey(null)
  } : undefined}>
    {top > 0 && <tr aria-hidden="true"><td colSpan={columns} style={{ height: top, padding: 0, border: 0 }} /></tr>}
    {items.map((item, position) => {
      const gap = position > 0 ? Math.max(0, item.start - items[position - 1].end) : 0
      return data[item.index] && <Fragment key={item.key}>
        {gap > 0 && <tr aria-hidden="true"><td colSpan={columns} style={{ height: gap, padding: 0, border: 0 }} /></tr>}
        {cloneElement(renderRow(data[item.index], item.index), {
          key: item.key, ref: virtualizer.measureElement, 'data-index': item.index, 'aria-rowindex': item.index + 2,
        } as HTMLAttributes<HTMLTableRowElement> & RefAttributes<HTMLTableRowElement>)}
      </Fragment>
    })}
    {bottom > 0 && <tr aria-hidden="true"><td colSpan={columns} style={{ height: bottom, padding: 0, border: 0 }} /></tr>}
  </tbody>
}
