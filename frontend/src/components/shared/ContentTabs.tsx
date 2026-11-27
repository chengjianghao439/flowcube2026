import { useRef, type ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import * as Tabs from '@radix-ui/react-tabs'
import KeepAliveSection from './KeepAliveSection'
import { cn } from '@/lib/utils'
import { DetailViewTabsList, DetailViewTabsTrigger } from './DetailViewTabs'

interface ContentTab<Value extends string> {
  value: Value
  label: string
  Icon?: LucideIcon
  disabled?: boolean
  content: ReactNode
}

/** 纯内容页签：Radix 管理焦点与关联，原保活层管理首次挂载、草稿、可见性和滚动。 */
export function ContentTabs<Value extends string>({ value, onValueChange, tabs, label, className, variant = 'segmented', rightSlot }: {
  value: Value
  onValueChange: (value: Value) => void
  tabs: readonly ContentTab<Value>[]
  label: string
  className?: string
  /** segmented = 双层页二级紧凑分段（默认）；underline = 单层页一级下划线；wide = 单据详情通栏等宽。 */
  variant?: 'segmented' | 'underline' | 'wide'
  /** 分页栏最右侧的附加区域（如已生效日期/筛选标签与清空按钮） */
  rightSlot?: ReactNode
}) {
  const notifiedValue = useRef(value)
  notifiedValue.current = value
  const selectTab = (next: string) => {
    const tab = tabs.find(tab => tab.value === next && !tab.disabled)
    if (tab && notifiedValue.current !== tab.value) {
      // mousedown、focus和兼容click可能在同一轮到达，只通知一次。
      notifiedValue.current = tab.value
      onValueChange(tab.value)
    }
  }
  const listNode = variant === 'wide' ? (
    <DetailViewTabsList className="fc-detail-view-tabs-wide">
      {tabs.map(({ value: tabValue, label, Icon, disabled }) => <Tabs.Trigger key={tabValue} value={tabValue} disabled={disabled}
        onClick={() => selectTab(tabValue)} asChild><DetailViewTabsTrigger>
        {Icon && <Icon className="size-4" aria-hidden />}{label}
      </DetailViewTabsTrigger></Tabs.Trigger>)}
    </DetailViewTabsList>
  ) : variant === 'underline' ? (
    <div className="fc-underline-tabs">
      {tabs.map(({ value: tabValue, label, Icon, disabled }) => <Tabs.Trigger key={tabValue} value={tabValue} disabled={disabled}
        onClick={() => selectTab(tabValue)}
        className="min-h-10 border-b-2 border-transparent px-3 py-2 text-sm font-normal text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:opacity-50 data-[state=active]:border-primary data-[state=active]:font-semibold data-[state=active]:text-foreground">
        {Icon && <Icon className="size-4" aria-hidden />}{label}
      </Tabs.Trigger>)}
    </div>
  ) : (
    <div className="fc-segmented-control w-fit">
      {tabs.map(({ value: tabValue, label, Icon, disabled }) => <Tabs.Trigger key={tabValue} value={tabValue} disabled={disabled}
        onClick={() => selectTab(tabValue)}
        className="fc-segmented-option focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:opacity-50">
        {Icon && <Icon className="size-4" aria-hidden />}{label}
      </Tabs.Trigger>)}
    </div>
  )
  return <Tabs.Root value={value} onValueChange={selectTab} className={cn('fc-content-tabs space-y-3', className)}>
    {rightSlot ? (
      <div className={cn('fc-filter-bar', variant === 'underline' && 'fc-filter-bar-underline')}>
        <Tabs.List aria-label={label} asChild>{listNode}</Tabs.List>
        <div className="fc-filter-bar-filters">{rightSlot}</div>
      </div>
    ) : (
      <Tabs.List aria-label={label} asChild>{listNode}</Tabs.List>
    )}
    {tabs.map(tab => <Tabs.Content key={tab.value} value={tab.value} forceMount hidden={value !== tab.value}
      tabIndex={value === tab.value ? 0 : -1} className="outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=inactive]:hidden">
      <KeepAliveSection active={value === tab.value}>{tab.content}</KeepAliveSection>
    </Tabs.Content>)}
  </Tabs.Root>
}
