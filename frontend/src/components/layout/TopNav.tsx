/**
 * TopNav — 顶栏主导航（hover 下拉，两级：一级入口 + 下拉内二级分段）
 *
 * 结构定义在 routeRegistry 的 nav 元数据里（group / section / order），本文件只负责渲染。
 * 点击项打开/激活对应工作区标签（KeepAlive 保留原标签状态）。
 */

import { Fragment, useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Link, useLocation, useNavigate, type Location } from 'react-router-dom'
import { ChevronDown } from 'lucide-react'
import { getMergedPageGroup } from '@/router/mergedPageGroups'
import { cn } from '@/lib/utils'
import { getWorkspaceListPath } from '@/lib/workspaceListNavigation'
import { usePermission } from '@/hooks/usePermission'
import { useWorkspaceStore } from '@/store/workspaceStore'
import { buildWorkspaceTabRegistrationFromPath, resolveWorkspaceEntryPath } from '@/router/workspaceRouteMeta'
import { RefundRecoveryEntry } from '@/pages/supplier-refunds/RefundRecoveryPage'
import { DisposalRecoveryEntry } from '@/pages/disposal/DisposalRecoveryPage'
import { RepeatSaleRecoveryEntry } from '@/pages/sale/RepeatSaleRecoveryPage'
import {
  PATH_TITLES,
  buildTopNavSections,
  type NavMenuSection,
  type TopNavSection,
} from '@/router/routeRegistry'

const TOP_NAV_SECTIONS: TopNavSection[] = buildTopNavSections()

/** 全部导航项 path，按长度倒序，供最长前缀匹配 */
const ALL_NAV_PATHS: string[] = TOP_NAV_SECTIONS.flatMap((section) =>
  section.kind === 'link' ? [section.path] : section.children.map((child) => child.path)
).sort((a, b) => b.length - a.length)

/**
 * 当前 pathname 命中的唯一导航项。
 *
 * 必须在**全部**导航项里做最长前缀匹配，不能只在组内匹配：
 * /reports/reconciliation 归「财务」而 /reports 归「报表」，/settings/printers 归「系统」
 * 而 /settings 归「系统」——组内匹配会让两个一级入口同时高亮，并把父路径那一项误标为 active。
 */
function resolveActiveNavPath(pathname: string): string | null {
  for (const path of ALL_NAV_PATHS) {
    if (pathname === path || pathname.startsWith(`${path}/`)) return path
  }
  return null
}

const HOVER_CLOSE_MS = 140

function menuItems(menu: HTMLDivElement | null) {
  return Array.from(menu?.querySelectorAll<HTMLAnchorElement>('[role="menuitem"]') ?? [])
}

function NavItemLink(props: {
  label: string
  path: string
  active: boolean
  openNavPath: (path: string) => void
}) {
  const { label, path, active, openNavPath } = props
  return (
    <Link
      to={path}
      aria-current={active ? 'page' : undefined}
      onClick={(e) => {
        e.preventDefault()
        openNavPath(path)
      }}
      className={cn(
        'inline-flex items-center rounded-md px-3 py-2 text-sm font-medium transition-colors',
        active
          ? 'bg-primary/10 text-primary'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground'
      )}
    >
      {label}
    </Link>
  )
}

function NavItemMenu(props: {
  label: string
  sections: NavMenuSection[]
  activePath: string | null
  location: Location
  openNavPath: (path: string) => void
}) {
  const { label, sections, activePath, location, openNavPath } = props
  const [open, setOpen] = useState(false)
  const id = useId()
  const trigger = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const focusOnOpen = useRef<'first' | 'last' | null>(null)
  const activatedByPointer = useRef(false)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearCloseTimer = useCallback(() => {
    if (closeTimer.current != null) {
      clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
  }, [])

  const closeMenu = useCallback((returnFocus = false) => {
    clearCloseTimer()
    activatedByPointer.current = false
    focusOnOpen.current = null
    setOpen(false)
    if (returnFocus) trigger.current?.focus()
  }, [clearCloseTimer])

  function scheduleClose() {
    clearCloseTimer()
    closeTimer.current = setTimeout(() => {
      closeTimer.current = null
      if (!menu.current?.contains(document.activeElement)) closeMenu()
    }, HOVER_CLOSE_MS)
  }

  function openMenu() {
    clearCloseTimer()
    setOpen(true)
  }

  function focusMenuItem(item: HTMLAnchorElement | undefined) {
    item?.focus({ preventScroll: true })
    item?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }

  function openAndFocus(edge: 'first' | 'last') {
    openMenu()
    if (open) {
      const items = menuItems(menu.current)
      const item = edge === 'first' ? items[0] : items.at(-1)
      focusMenuItem(item)
    } else {
      focusOnOpen.current = edge
    }
  }

  useLayoutEffect(() => {
    if (!open || !trigger.current || !menu.current) return
    const anchor = trigger.current
    const dropdown = menu.current
    const measure = () => {
      // 浮层顶部留 4px 过渡区，窗口底部留 8px 给边缘与焦点。
      const height = Math.max(0, Math.floor(window.innerHeight - anchor.getBoundingClientRect().bottom - 12))
      dropdown.style.setProperty('--topnav-menu-height', `${height}px`)
    }
    measure()
    window.addEventListener('resize', measure)
    const topbar = anchor.closest('.desktop-topbar')
    const observer = topbar && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null
    if (observer && topbar) observer.observe(topbar)
    return () => {
      window.removeEventListener('resize', measure)
      observer?.disconnect()
    }
  }, [open])

  useLayoutEffect(() => {
    if (!open || !focusOnOpen.current) return
    const items = menuItems(menu.current)
    const item = focusOnOpen.current === 'first' ? items[0] : items.at(-1)
    focusOnOpen.current = null
    focusMenuItem(item)
  }, [open])

  useEffect(() => () => clearCloseTimer(), [clearCloseTimer])
  useEffect(() => {
    closeMenu(menu.current?.contains(document.activeElement))
  }, [location, closeMenu])
  useEffect(() => {
    if (!open) return
    function escape(event: globalThis.KeyboardEvent) {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      const focusedInside = !!menu.current?.contains(document.activeElement) || document.activeElement === trigger.current
      if (focusedInside) event.preventDefault()
      closeMenu(focusedInside)
    }
    document.addEventListener('keydown', escape)
    return () => document.removeEventListener('keydown', escape)
  }, [open, closeMenu])

  function moveWithinMenu(event: KeyboardEvent<HTMLDivElement>) {
    const items = menuItems(menu.current)
    const index = items.findIndex(item => item === document.activeElement)
    if (index < 0) return
    let next: HTMLAnchorElement | undefined
    switch (event.key) {
      case 'ArrowDown': next = items[(index + 1) % items.length]; break
      case 'ArrowUp': next = items[(index - 1 + items.length) % items.length]; break
      case 'Home': next = items[0]; break
      case 'End': next = items.at(-1); break
      case ' ': event.preventDefault(); items[index].click(); return
      default: return
    }
    event.preventDefault()
    focusMenuItem(next)
  }

  const sectionActive = sections.some((section) =>
    section.items.some((item) => item.path === activePath)
  )
  /** 权限过滤后只剩一个分段时，段标题不再起区分作用，隐藏以免冗余 */
  const showSectionLabels = sections.length > 1

  return (
    <div
      className="relative"
      onMouseEnter={openMenu}
      onMouseLeave={scheduleClose}
      onBlur={event => {
        if (!event.currentTarget.contains(event.relatedTarget) || event.relatedTarget === trigger.current) closeMenu()
      }}
    >
      <button
        ref={trigger}
        id={id}
        type="button"
        aria-expanded={open}
        aria-haspopup="menu"
        aria-controls={`${id}-menu`}
        onMouseDown={event => {
          // 保留菜单内焦点到 click，避免 blur 先收起、click 又重新展开。
          if (event.button === 0 && menu.current?.contains(document.activeElement)) event.preventDefault()
        }}
        onClick={event => {
          if (event.detail === 0) {
            openAndFocus('first')
            return
          }
          const focusedInside = menu.current?.contains(document.activeElement)
          if (activatedByPointer.current || focusedInside) {
            closeMenu(focusedInside)
            return
          }
          activatedByPointer.current = true
          openMenu()
        }}
        onKeyDown={event => {
          if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
          event.preventDefault()
          openAndFocus(event.key === 'ArrowDown' ? 'first' : 'last')
        }}
        className={cn(
          'inline-flex items-center gap-0.5 rounded-md px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          sectionActive || open
            ? 'bg-primary/10 text-primary'
            : 'text-muted-foreground hover:bg-muted hover:text-foreground'
        )}
      >
        {label}
        <ChevronDown aria-hidden="true" className={cn('h-3.5 w-3.5 opacity-70 transition-transform', open && 'rotate-180')} />
      </button>
        <div
          ref={menu}
          id={`${id}-menu`}
          className="fc-topnav-menu absolute left-0 top-full z-50 min-w-[12rem] pt-1"
          role="menu"
          aria-labelledby={id}
          hidden={!open}
          aria-hidden={!open || undefined}
          {...(!open ? { inert: '' } : {})}
          onKeyDown={moveWithinMenu}
        >
          <ul role="none" className="rounded-md border border-border bg-popover py-1 text-popover-foreground shadow-md">
            {sections.map((section, index) => (
              <Fragment key={section.label ?? `__plain-${index}`}>
                {index > 0 && (
                  <li role="separator" className="my-1 border-t border-border" />
                )}
                {showSectionLabels && section.label && (
                  <li
                    role="presentation"
                    className="px-3 pb-1 pt-1.5 text-xs font-medium text-muted-foreground"
                  >
                    {section.label}
                  </li>
                )}
                {section.items.map((item) => {
                  const active = item.path === activePath
                  return (
                    <li key={item.path} role="none">
                      <Link
                        role="menuitem"
                        tabIndex={-1}
                        to={item.path}
                        aria-current={active ? 'page' : undefined}
                        onClick={(e) => {
                          e.preventDefault()
                          closeMenu(menu.current?.contains(document.activeElement))
                          openNavPath(item.path)
                        }}
                        className={cn(
                          'block px-3 py-2 text-sm transition-colors focus-visible:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                          active
                            ? 'bg-primary/10 font-medium text-primary'
                            : 'text-foreground hover:bg-muted'
                        )}
                      >
                        {item.label}
                      </Link>
                    </li>
                  )
                })}
              </Fragment>
            ))}
          </ul>
        </div>
    </div>
  )
}

export function TopNav() {
  const { can } = usePermission()
  const navigate = useNavigate()
  const location = useLocation()
  const { addTab } = useWorkspaceStore()
  const pathname = location.pathname
  const visibleNav = buildTopNavSections(can)
  const activeGroup = getMergedPageGroup(pathname)
  const activePath = activeGroup
    ? visibleNav.flatMap(section => section.kind === 'menu' ? section.children : [section])
      .find(item => getMergedPageGroup(item.path)?.key === activeGroup.key)?.path ?? null
    : resolveActiveNavPath(pathname)

  /** 打开/激活目标页：KeepAlive 保留当前标签状态，无需确认 */
  const openNavPath = useCallback(
    (path: string) => {
      const title = PATH_TITLES[path] ?? path
      const key = buildWorkspaceTabRegistrationFromPath(path).key
      const target = getMergedPageGroup(path)?.tabTitle === 'group'
        ? resolveWorkspaceEntryPath(path, useWorkspaceStore.getState().tabs.find(tab => tab.key === key), can)
        : getWorkspaceListPath(path)
      if (addTab({ key, title, path: target })) navigate(target)
    },
    [addTab, navigate, can]
  )

  const nodes: ReactNode[] = []

  for (const section of visibleNav) {
    if (section.kind === 'link') {
      if (!can(section.perm)) continue
      nodes.push(
        <NavItemLink
          key={section.path}
          label={section.label}
          path={section.path}
          active={activePath === section.path}
          openNavPath={openNavPath}
        />
      )
      continue
    }

    // 逐段过滤权限，空段整段丢弃
    const visibleSections = section.sections
      .map((menuSection) => ({
        label: menuSection.label,
        items: menuSection.items.filter((item) => can(item.perm)),
      }))
      .filter((menuSection) => menuSection.items.length > 0)
    const visibleItems = visibleSections.flatMap((menuSection) => menuSection.items)
    if (!visibleItems.length) continue

    if (visibleItems.length === 1) {
      const only = visibleItems[0]
      nodes.push(
        <NavItemLink
          key={only.path}
          label={only.label}
          path={only.path}
          active={activePath === only.path}
          openNavPath={openNavPath}
        />
      )
      continue
    }

    nodes.push(
      <NavItemMenu
        key={section.label}
        label={section.label}
        sections={visibleSections}
        activePath={activePath}
        location={location}
        openNavPath={openNavPath}
      />
    )
  }

  if (!nodes.length) return <><RepeatSaleRecoveryEntry /><DisposalRecoveryEntry /><RefundRecoveryEntry /></>

  return (
    <nav className="flex shrink-0 flex-wrap items-center gap-0.5" aria-label="主导航">
      {nodes}
      <RepeatSaleRecoveryEntry /><DisposalRecoveryEntry /><RefundRecoveryEntry />
    </nav>
  )
}
