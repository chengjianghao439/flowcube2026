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
export function ContentTabs<Value extends string>({ value, onValueChange, tabs, label, className }: {
  value: Value
  onValueChange: (value: Value) => void
  tabs: readonly ContentTab<Value>[]
  label: string
  className?: string
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
  return <Tabs.Root value={value} onValueChange={selectTab} className={cn('fc-content-tabs space-y-3', className)}>
    <Tabs.List aria-label={label} asChild><DetailViewTabsList>
      {tabs.map(({ value: tabValue, label, Icon, disabled }) => <Tabs.Trigger key={tabValue} value={tabValue} disabled={disabled}
        onClick={() => selectTab(tabValue)} asChild><DetailViewTabsTrigger>
        {Icon && <Icon className="size-4" aria-hidden />}{label}
      </DetailViewTabsTrigger></Tabs.Trigger>)}
    </DetailViewTabsList></Tabs.List>
    {tabs.map(tab => <Tabs.Content key={tab.value} value={tab.value} forceMount hidden={value !== tab.value}
      tabIndex={value === tab.value ? 0 : -1} className="outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=inactive]:hidden">
      <KeepAliveSection active={value === tab.value}>{tab.content}</KeepAliveSection>
    </Tabs.Content>)}
  </Tabs.Root>
}
