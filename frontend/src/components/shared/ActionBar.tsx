/**
 * ActionBar — 全系统统一页面顶部操作栏
 *
 * 结构：
 *   [ 主标题  副标题(可选) ]  |  [ rightActions ]
 *
 * 视觉规范：
 * - 高度固定 h-14（56px）
 * - border-b 分割，无阴影，无渐变
 * - 极简 SaaS 风格，保持与顶部导航栏同高
 *
 * sticky 模式（默认开启）：
 * - 使用 -mx-6 -mt-6 抵消父容器 TabPanel 的 p-6 内边距，
 *   使 ActionBar 贴合内容区顶部并延伸至两侧边缘。
 * - 需确保父容器为 TabPanel（或同等 p-6 容器）。
 *
 * 按钮层级约定（由调用方保证顺序）：
 * - 危险操作（variant="destructive"）放最左
 * - 次操作（variant="outline"）居中
 * - 主操作（variant="default"）放最右，且只允许 1 个
 *
 * 使用示例：
 * ```tsx
 * <ActionBar
 *   title="新建销售单"
 *   rightActions={
 *     <>
 *       <Button variant="outline" onClick={onCancel}>取消</Button>
 *       <Button onClick={onSubmit}>提交保存</Button>
 *     </>
 *   }
 * />
 *
 * <ActionBar
 *   title={order.orderNo}
 *   subtitle={<StatusBadge type="sale" status={order.status} />}
 *   rightActions={...}
 * />
 * ```
 */

import { cn } from '@/lib/utils'

export interface ActionBarProps {
  /** 页面主标题，支持字符串或自定义 JSX（text-xl font-semibold 由组件提供） */
  title: React.ReactNode

  /** 副标题区域，通常用于放置状态 Badge */
  subtitle?: React.ReactNode

  /** 右侧操作按钮区域，按主→次→危险从右到左排列 */
  rightActions?: React.ReactNode

  /**
   * 是否 sticky 吸顶（默认 true）。
   * sticky 模式下会应用 -mx-6 -mt-6 抵消 TabPanel 的 p-6，
   * 非 sticky 模式下作为普通块级元素使用。
   */
  sticky?: boolean
}

export function ActionBar({
  title,
  subtitle,
  rightActions,
  sticky = true,
}: ActionBarProps) {
  return (
    <div
      className={cn(
        'flex h-14 items-center justify-between border-b bg-background px-6',
        sticky && 'sticky top-0 z-10 -mx-6 -mt-6',
      )}
    >
      {/* 左侧：主标题 + 副标题 */}
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-semibold leading-none text-foreground">
          {title}
        </h1>
        {subtitle && (
          <div className="flex items-center">{subtitle}</div>
        )}
      </div>

      {/* 右侧：操作按钮 */}
      {rightActions && (
        <div className="flex items-center gap-2">{rightActions}</div>
      )}
    </div>
  )
}
