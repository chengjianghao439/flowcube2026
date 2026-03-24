/**
 * FormSection — 表单分区容器
 *
 * 将复杂表单拆分为若干逻辑区块，每个区块带标题、可选描述。
 * 支持两列布局（grid cols-2）和单列布局，适应不同字段数量。
 *
 * 使用示例：
 * ```tsx
 * // 基础用法
 * <FormSection title="基本信息">
 *   <div className="grid grid-cols-2 gap-4">
 *     <FormItem label="客户名称"><Input /></FormItem>
 *     <FormItem label="联系电话"><Input /></FormItem>
 *   </div>
 * </FormSection>
 *
 * // 带描述
 * <FormSection title="收货地址" description="填写实际收货地址，用于生成配送单据">
 *   ...
 * </FormSection>
 *
 * // 可折叠区块
 * <FormSection title="备注信息" collapsible defaultOpen={false}>
 *   <Textarea />
 * </FormSection>
 *
 * // 无卡片容器（嵌入已有卡片内）
 * <FormSection title="商品明细" bare>
 *   <ItemsTable />
 * </FormSection>
 * ```
 */

import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface FormSectionProps {
  /** 区块标题 */
  title: string
  /** 标题下方的辅助说明 */
  description?: string
  /** 标题右侧操作区（如"+ 添加行"按钮） */
  actions?: React.ReactNode
  /** 区块内容 */
  children: React.ReactNode
  /** 是否支持折叠 */
  collapsible?: boolean
  /** 折叠时的初始状态（默认展开） */
  defaultOpen?: boolean
  /**
   * 裸模式：不渲染外层卡片边框，仅保留标题分隔线。
   * 适合嵌套在已有卡片/SectionCard 内使用。
   */
  bare?: boolean
  /** 额外 className（作用于根节点） */
  className?: string
}

export function FormSection({
  title,
  description,
  actions,
  children,
  collapsible = false,
  defaultOpen = true,
  bare = false,
  className,
}: FormSectionProps) {
  const [open, setOpen] = useState(defaultOpen)

  // ── 标题行 ─────────────────────────────────────────────────────────────────
  const header = (
    <div
      className={cn(
        'flex items-start justify-between gap-3',
        bare ? 'border-b border-border pb-3 mb-4' : '',
        collapsible && 'cursor-pointer select-none',
      )}
      onClick={collapsible ? () => setOpen(v => !v) : undefined}
    >
      {/* 左：标题 + 描述 */}
      <div className="min-w-0">
        <h4 className="text-sm font-semibold leading-none text-foreground">
          {title}
        </h4>
        {description && (
          <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
            {description}
          </p>
        )}
      </div>

      {/* 右：操作 or 折叠箭头 */}
      <div className="flex shrink-0 items-center gap-2">
        {actions && !collapsible && (
          <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
            {actions}
          </div>
        )}
        {collapsible && (
          <ChevronDown
            className={cn(
              'h-4 w-4 text-muted-foreground transition-transform duration-200',
              open && 'rotate-180',
            )}
          />
        )}
      </div>
    </div>
  )

  // ── 带卡片模式 ──────────────────────────────────────────────────────────────
  if (!bare) {
    return (
      <div className={cn('rounded-xl border border-border bg-card shadow-sm', className)}>
        {/* 卡片顶部标题行 */}
        <div
          className={cn(
            'flex items-start justify-between gap-3 border-b border-border px-5 py-4',
            collapsible && 'cursor-pointer select-none',
          )}
          onClick={collapsible ? () => setOpen(v => !v) : undefined}
        >
          <div className="min-w-0">
            <h4 className="text-sm font-semibold leading-none text-foreground">{title}</h4>
            {description && (
              <p className="mt-1 text-xs text-muted-foreground leading-relaxed">{description}</p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {actions && (
              <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
                {actions}
              </div>
            )}
            {collapsible && (
              <ChevronDown
                className={cn(
                  'h-4 w-4 text-muted-foreground transition-transform duration-200',
                  open && 'rotate-180',
                )}
              />
            )}
          </div>
        </div>

        {/* Body */}
        {(!collapsible || open) && (
          <div className="p-5">{children}</div>
        )}
      </div>
    )
  }

  // ── 裸模式 ─────────────────────────────────────────────────────────────────
  return (
    <div className={cn('', className)}>
      {header}
      {(!collapsible || open) && children}
    </div>
  )
}
