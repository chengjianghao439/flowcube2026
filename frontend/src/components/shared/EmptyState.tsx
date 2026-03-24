/**
 * EmptyState — 空数据状态占位组件
 *
 * 用于列表无数据、搜索无结果、权限不足等场景。
 * 内置多种语义预设，也支持完全自定义。
 *
 * 使用示例：
 * ```tsx
 * // 最简用法（使用预设 variant）
 * <EmptyState variant="no-data" />
 * <EmptyState variant="no-result" description="尝试更换关键词" />
 * <EmptyState variant="error" action={<Button onClick={refetch}>重试</Button>} />
 *
 * // 完全自定义
 * <EmptyState
 *   icon={<Package className="h-10 w-10" />}
 *   title="暂无商品"
 *   description="还没有添加任何商品，点击下方按钮开始"
 *   action={<Button>+ 新建商品</Button>}
 * />
 *
 * // 嵌入表格 td 内
 * <EmptyState variant="no-data" compact />
 * ```
 */

import { cn } from '@/lib/utils'
import { Inbox, SearchX, ServerCrash, ShieldOff, FolderOpen } from 'lucide-react'

// ── 预设 variant ─────────────────────────────────────────────────────────────

type EmptyVariant = 'no-data' | 'no-result' | 'error' | 'no-permission' | 'empty-folder'

interface VariantConfig {
  icon: React.ReactNode
  title: string
  description: string
}

const VARIANT_MAP: Record<EmptyVariant, VariantConfig> = {
  'no-data': {
    icon:        <Inbox className="h-10 w-10" />,
    title:       '暂无数据',
    description: '当前列表没有任何记录',
  },
  'no-result': {
    icon:        <SearchX className="h-10 w-10" />,
    title:       '未找到结果',
    description: '没有符合条件的记录，请尝试调整筛选条件',
  },
  error: {
    icon:        <ServerCrash className="h-10 w-10" />,
    title:       '加载失败',
    description: '数据加载时发生错误，请稍后重试',
  },
  'no-permission': {
    icon:        <ShieldOff className="h-10 w-10" />,
    title:       '无访问权限',
    description: '您没有权限查看该内容，请联系管理员',
  },
  'empty-folder': {
    icon:        <FolderOpen className="h-10 w-10" />,
    title:       '文件夹为空',
    description: '该目录下暂无内容',
  },
}

// ── Props ────────────────────────────────────────────────────────────────────

export interface EmptyStateProps {
  /** 内置预设语义（与 icon/title/description 二选一） */
  variant?: EmptyVariant
  /** 自定义图标（覆盖 variant 图标） */
  icon?: React.ReactNode
  /** 自定义标题（覆盖 variant 标题） */
  title?: string
  /** 自定义描述（覆盖 variant 描述） */
  description?: string
  /** 操作按钮区（如"新建"、"重试"等） */
  action?: React.ReactNode
  /**
   * 紧凑模式：减小内边距，适合嵌入表格空行或小卡片内
   */
  compact?: boolean
  /** 额外 className */
  className?: string
}

// ── 组件 ────────────────────────────────────────────────────────────────────

export function EmptyState({
  variant,
  icon,
  title,
  description,
  action,
  compact = false,
  className,
}: EmptyStateProps) {
  const preset = variant ? VARIANT_MAP[variant] : undefined

  const resolvedIcon        = icon        ?? preset?.icon
  const resolvedTitle       = title       ?? preset?.title
  const resolvedDescription = description ?? preset?.description

  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center',
        compact ? 'gap-2 py-8' : 'gap-3 py-16',
        className,
      )}
    >
      {resolvedIcon && (
        <div className="text-muted-foreground/40">
          {resolvedIcon}
        </div>
      )}

      {resolvedTitle && (
        <p className={cn('font-medium text-foreground', compact ? 'text-sm' : 'text-base')}>
          {resolvedTitle}
        </p>
      )}

      {resolvedDescription && (
        <p className={cn('text-muted-foreground', compact ? 'text-xs' : 'text-sm')}>
          {resolvedDescription}
        </p>
      )}

      {action && (
        <div className={cn(compact ? 'mt-1' : 'mt-2')}>
          {action}
        </div>
      )}
    </div>
  )
}
