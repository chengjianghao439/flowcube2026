/**
 * WorkspaceTabs — 工作区标签栏
 *
 * 位于 AppLayout 第二行（TopNav 下方），独占宽度；父级控制背景与边框。
 *
 * 行为：
 * - 标签溢出时横向滚动（scrollbar-none）
 * - 激活标签变化时自动 scrollIntoView
 * - 右侧折叠菜单（关闭其他 / 关闭全部）
 * - 未保存变更保护：关闭标签、关闭其他、关闭全部前均确认（切换标签本身由 KeepAlive 保留状态，无需确认）
 * - 脏状态标签右上角显示橙色小圆点
 */

import { useRef, useState, useEffect, useId } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { X, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useWorkspaceStore } from '@/store/workspaceStore'
import { useDirtyGuardStore } from '@/store/dirtyGuardStore'
import { confirmDirtyLeave } from '@/lib/unsavedChanges'
import { buildWorkspaceTabRegistration } from '@/router/workspaceRouteMeta'
import { getRouteListPath } from '@/router/routeRegistry'

export function WorkspaceTabs() {
  const { tabs, removeTab, closeOthers, closeAll } = useWorkspaceStore()
  const dirtyTabs = useDirtyGuardStore(s => s.dirtyTabs)
  const pendingConfirm = useDirtyGuardStore(s => s.pendingConfirm)
  const navigate = useNavigate()
  const location = useLocation()
  const activeKey = buildWorkspaceTabRegistration(location.pathname, location.search).key
  const focusKey = tabs.some(tab => tab.key === activeKey) ? activeKey : tabs[0]?.key
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef    = useRef<HTMLDivElement>(null)
  const menuButtonRef = useRef<HTMLButtonElement>(null)
  const menuItemsRef = useRef<Array<HTMLButtonElement | null>>([])
  const menuFocusIndex = useRef(0)
  const menuId = useId()
  const tabRefs = useRef(new Map<string, HTMLButtonElement>())
  const focusAfterClose = useRef(false)
  const guardedFocus = useRef<{ confirm: NonNullable<typeof pendingConfirm>; target: HTMLElement | null } | null>(null)
  const tabId = (key: string) => `${menuId}-tab-${encodeURIComponent(key)}`

  // 激活标签变化时自动滚入视图
  useEffect(() => {
    tabRefs.current.get(activeKey)?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' })
  }, [activeKey])

  useEffect(() => {
    if (!focusAfterClose.current) return
    const target = tabRefs.current.get(activeKey)
    if (target) {
      target.focus()
      focusAfterClose.current = false
    }
  }, [activeKey, tabs])

  useEffect(() => {
    if (menuOpen) menuItemsRef.current[menuFocusIndex.current]?.focus()
  }, [menuOpen])

  // The global confirmation has no Dialog.Trigger. Restore this action's own
  // focus after its dialog releases focus, including a cancelled Delete close.
  useEffect(() => {
    const previous = guardedFocus.current
    if (!previous || pendingConfirm === previous.confirm) return
    guardedFocus.current = null
    if (pendingConfirm) return
    const timer = window.setTimeout(() => {
      const target = previous.target?.isConnected ? previous.target : tabRefs.current.get(activeKey)
      target?.focus()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [pendingConfirm, activeKey])

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
    const target = document.activeElement instanceof HTMLElement ? document.activeElement : null
    confirmDirtyLeave({
      dirtyKeys: dirtyPaths,
      willNavigate,
      proceed,
    })
    const confirm = useDirtyGuardStore.getState().pendingConfirm
    if (confirm) guardedFocus.current = { confirm, target }
  }

  // 切换到另一个标签：KeepAlive 保留组件实例与草稿，无需确认
  const handleTabClick = (key: string, path: string) => {
    if (key === activeKey) return
    navigate(path)
  }

  // 关闭某个标签：检查该 tab 自身是否有未保存内容
  const handleClose = (e: React.SyntheticEvent, key: string) => {
    e.stopPropagation()
    const closingActive = key === activeKey
    const closingTab = tabs.find(t => t.key === key)
    guardedAction(
      [key],
      () => {
        focusAfterClose.current = true
        const newKey = removeTab(key, activeKey)
        if (closingActive) {
          // 详情/表单类标签有明确归属的列表页，关闭后应回到那里，而非任意相邻标签
          const listPath = closingTab ? getRouteListPath(closingTab.path) : undefined
          if (listPath) {
            navigate(listPath)
          } else {
            const newTab = useWorkspaceStore.getState().tabs.find(t => t.key === newKey)
            if (newTab) navigate(newTab.path)
          }
        }
        // 关闭非激活 tab 时无路径变化，不需要 navigate
      },
      closingActive, // 只有关闭激活 tab 才会触发路径变化
    )
  }

  const handleTabKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, key: string) => {
    const index = tabs.findIndex(tab => tab.key === key)
    let nextIndex: number | undefined
    if (e.key === 'ArrowRight') nextIndex = (index + 1) % tabs.length
    if (e.key === 'ArrowLeft') nextIndex = (index + tabs.length - 1) % tabs.length
    if (e.key === 'Home') nextIndex = 0
    if (e.key === 'End') nextIndex = tabs.length - 1
    if (nextIndex !== undefined) {
      e.preventDefault()
      const next = tabs[nextIndex]
      tabRefs.current.get(next.key)?.focus()
      handleTabClick(next.key, next.path)
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      const tab = tabs[index]
      if (tab) handleTabClick(tab.key, tab.path)
    } else if (e.key === 'Delete' && tabs[index]?.closable) {
      e.preventDefault()
      handleClose(e, key)
    }
  }

  function openMenu(index: number) {
    menuFocusIndex.current = index
    setMenuOpen(true)
    if (menuOpen) menuItemsRef.current[index]?.focus()
  }

  function handleMenuKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const index = menuItemsRef.current.findIndex(item => item === document.activeElement)
    let nextIndex: number | undefined
    if (e.key === 'ArrowDown') nextIndex = (index + 1) % 2
    if (e.key === 'ArrowUp') nextIndex = (index + 1) % 2
    if (e.key === 'Home') nextIndex = 0
    if (e.key === 'End') nextIndex = 1
    if (nextIndex !== undefined) {
      e.preventDefault()
      menuItemsRef.current[nextIndex]?.focus()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setMenuOpen(false)
      menuButtonRef.current?.focus()
    } else if (e.key === 'Tab') {
      setMenuOpen(false)
    }
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
    <div className="flex w-full min-w-0 items-center gap-0">
      {/* 可横向滚动的标签列表 */}
      <div
        className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto px-1"
        style={{ scrollbarWidth: 'none' }}
      >
        {/* aria-owns groups the tabs without making their independent close
            buttons invalid tablist children or nested tab actions. */}
        <div role="tablist" aria-label="工作区标签" aria-orientation="horizontal"
          aria-owns={tabs.map(tab => tabId(tab.key)).join(' ')} className="contents" />
        {tabs.map(tab => {
          const isActive = activeKey === tab.key
          const isDirty  = !!dirtyTabs[tab.key]
          return (
            <div
              key={tab.key}
              role="presentation"
              className={cn(
                'group relative flex h-8 shrink-0 select-none items-center rounded-md text-sm font-medium transition-colors',
                isActive
                  ? 'bg-muted text-foreground'
                  : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
              )}
            >
              {/* Active 底部指示线 */}
              {isActive && (
                <span className="absolute bottom-0 left-2 right-2 h-0.5 rounded-full bg-primary" />
              )}

              <button
                type="button"
                id={tabId(tab.key)}
                ref={element => { if (element) tabRefs.current.set(tab.key, element); else tabRefs.current.delete(tab.key) }}
                role="tab"
                aria-selected={isActive}
                tabIndex={tab.key === focusKey ? 0 : -1}
                onClick={() => handleTabClick(tab.key, tab.path)}
                onKeyDown={e => handleTabKeyDown(e, tab.key)}
                className="flex h-full items-center gap-1.5 rounded-md px-3 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              >
                <span className="whitespace-nowrap leading-none" title={tab.title}>{tab.title}</span>
                {/* 未保存变更指示点 */}
                {isDirty && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-orange-400" title="有未保存的更改" />}
              </button>

              {tab.closable && (
                <button
                  type="button"
                  onClick={e => handleClose(e, tab.key)}
                  className={cn(
                    'mr-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    'transition-all duration-100',
                    'opacity-0 group-hover:opacity-50 focus-visible:!opacity-100',
                    isActive && 'opacity-30',
                    'hover:!opacity-100 hover:bg-destructive/20 hover:text-destructive-ink'
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
          ref={menuButtonRef}
          onClick={() => setMenuOpen(v => !v)}
          onKeyDown={e => {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault()
              openMenu(e.key === 'ArrowDown' ? 0 : 1)
            }
          }}
          className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="标签操作"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-controls={menuOpen ? menuId : undefined}
        >
          <ChevronDown className="h-3.5 w-3.5" />
        </button>

        {menuOpen && (
          <div id={menuId} role="menu" aria-label="标签操作" onKeyDown={handleMenuKeyDown} className="absolute right-0 top-9 z-50 w-32 overflow-hidden rounded-lg border border-border bg-popover py-1 shadow-lg">
            <button
              type="button"
              role="menuitem"
              tabIndex={-1}
              ref={element => { menuItemsRef.current[0] = element }}
              onClick={handleCloseOthers}
              className="flex w-full items-center px-3 py-1.5 text-xs text-foreground outline-none transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            >
              关闭其他标签
            </button>
            <button
              type="button"
              role="menuitem"
              tabIndex={-1}
              ref={element => { menuItemsRef.current[1] = element }}
              onClick={handleCloseAll}
              className="flex w-full items-center px-3 py-1.5 text-xs text-destructive-ink outline-none transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            >
              关闭全部标签
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
