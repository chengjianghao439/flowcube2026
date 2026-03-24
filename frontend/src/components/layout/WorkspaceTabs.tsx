/**
 * WorkspaceTabs — 内联标签栏
 *
 * 设计为在 TopNav 单行内使用（flex-1 子元素）。
 * 不带外层高度或 border-b，由父容器控制垂直居中。
 *
 * 行为：
 * - 标签溢出时横向滚动（scrollbar-none）
 * - 激活标签变化时自动 scrollIntoView
 * - 右侧折叠菜单（关闭其他 / 关闭全部）
 * - 未保存变更保护：切换/关闭/关闭其他/关闭全部前检查脏状态
 * - 脏状态标签右上角显示橙色小圆点
 */

import { useRef, useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { X, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useWorkspaceStore } from '@/store/workspaceStore'
import { useDirtyGuardStore } from '@/store/dirtyGuardStore'

export function WorkspaceTabs() {
  const { tabs, activeKey, removeTab, setActive, closeOthers, closeAll } = useWorkspaceStore()
  const dirtyTabs = useDirtyGuardStore(s => s.dirtyTabs)
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef    = useRef<HTMLDivElement>(null)
  const scrollRef  = useRef<HTMLDivElement>(null)
  const activeRef  = useRef<HTMLDivElement>(null)

  // 激活标签变化时自动滚入视图
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' })
  }, [activeKey])

  // 点击外部关闭下拉菜单
  useEffect(() => {
    if (!menuOpen) return
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [menuOpen])

  /**
   * 脏状态守卫：检查 dirtyPaths 中是否有 dirty tab。
   * - 无 dirty → 直接执行 proceed
   * - 有 dirty → 弹确认框，用户确认后执行 proceed
   *
   * @param dirtyPaths    要检查的 tabKey 数组
   * @param proceed       确认后执行的动作
   * @param willNavigate  是否会触发路径变化（决定是否设置 bypassNextBlock）
   */
  function guardedAction(
    dirtyPaths: string[],
    proceed: () => void,
    willNavigate = true,
  ) {
    const store = useDirtyGuardStore.getState()
    if (!store.hasAnyDirtyIn(dirtyPaths)) {
      proceed()
      return
    }
    store.showConfirm('当前内容尚未保存，确定离开吗？', () => {
      if (willNavigate) store.setBypassNextBlock(true)
      proceed()
    })
  }

  // 切换到另一个标签：检查当前激活 tab 是否有未保存内容
  const handleTabClick = (key: string, path: string) => {
    if (key === activeKey) return
    guardedAction([activeKey], () => {
      setActive(key)
      navigate(path)
    })
  }

  // 关闭某个标签：检查该 tab 自身是否有未保存内容
  const handleClose = (e: React.MouseEvent, key: string) => {
    e.stopPropagation()
    const closingActive = key === activeKey
    guardedAction(
      [key],
      () => {
        const newKey = removeTab(key)
        if (closingActive) {
          const newTab = useWorkspaceStore.getState().tabs.find(t => t.key === newKey)
          if (newTab) navigate(newTab.path)
        }
        // 关闭非激活 tab 时无路径变化，不需要 navigate
      },
      closingActive, // 只有关闭激活 tab 才会触发路径变化
    )
  }

  // 关闭其他标签：检查其他 closable tab 中是否有未保存内容
  const handleCloseOthers = () => {
    const otherKeys = tabs.filter(t => t.key !== activeKey && t.closable).map(t => t.key)
    guardedAction(otherKeys, () => {
      closeOthers(activeKey)
      const cur = useWorkspaceStore.getState().tabs.find(t => t.key === activeKey)
      if (cur) navigate(cur.path)
      setMenuOpen(false)
    })
  }

  // 关闭全部标签：检查所有 closable tab
  const handleCloseAll = () => {
    const allKeys = tabs.filter(t => t.closable).map(t => t.key)
    guardedAction(allKeys, () => {
      closeAll()
      navigate('/dashboard')
      setMenuOpen(false)
    })
  }

  return (
    <div className="flex min-w-0 flex-1 items-center gap-0">
      {/* 可横向滚动的标签列表 */}
      <div
        ref={scrollRef}
        className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto px-1"
        style={{ scrollbarWidth: 'none' }}
      >
        {tabs.map(tab => {
          const isActive = activeKey === tab.key
          const isDirty  = !!dirtyTabs[tab.key]
          return (
            <div
              key={tab.key}
              ref={isActive ? activeRef : undefined}
              role="tab"
              aria-selected={isActive}
              onClick={() => handleTabClick(tab.key, tab.path)}
              className={cn(
                'group relative flex h-8 shrink-0 cursor-pointer select-none items-center gap-1.5 rounded-md px-3 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-muted text-foreground'
                  : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
              )}
            >
              {/* Active 底部指示线 */}
              {isActive && (
                <span className="absolute bottom-0 left-2 right-2 h-0.5 rounded-full bg-primary" />
              )}

              <span className="max-w-[7rem] truncate leading-none">{tab.title}</span>

              {/* 未保存变更指示点 */}
              {isDirty && (
                <span
                  className="h-1.5 w-1.5 shrink-0 rounded-full bg-orange-400"
                  title="有未保存的更改"
                />
              )}

              {tab.closable && (
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={e => handleClose(e, tab.key)}
                  className={cn(
                    'flex h-3 w-3 shrink-0 items-center justify-center rounded-full',
                    'transition-all duration-100',
                    'opacity-0 group-hover:opacity-50',
                    isActive && 'opacity-30',
                    'hover:!opacity-100 hover:bg-destructive/20 hover:text-destructive'
                  )}
                  aria-label={`关闭 ${tab.title}`}
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              )}
            </div>
          )
        })}
      </div>

      {/* 操作下拉菜单 */}
      <div className="relative shrink-0" ref={menuRef}>
        <button
          type="button"
          onClick={() => setMenuOpen(v => !v)}
          className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label="标签操作"
        >
          <ChevronDown className="h-3.5 w-3.5" />
        </button>

        {menuOpen && (
          <div className="absolute right-0 top-9 z-50 w-32 overflow-hidden rounded-lg border border-border bg-popover py-1 shadow-lg">
            <button
              type="button"
              onClick={handleCloseOthers}
              className="flex w-full items-center px-3 py-1.5 text-xs text-foreground transition-colors hover:bg-muted"
            >
              关闭其他标签
            </button>
            <button
              type="button"
              onClick={handleCloseAll}
              className="flex w-full items-center px-3 py-1.5 text-xs text-destructive transition-colors hover:bg-muted"
            >
              关闭全部标签
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
