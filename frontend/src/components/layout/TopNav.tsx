/**
 * TopNav — 顶栏主导航（hover 下拉，两级：一级入口 + 下拉内二级分段）
 *
 * 结构定义在 routeRegistry 的 nav 元数据里（group / section / order），本文件只负责渲染。
 * 点击项打开/激活对应工作区标签（KeepAlive 保留原标签状态）。
 */

import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { ChevronDown } from 'lucide-react'
import { getMergedPageGroup } from '@/router/mergedPageGroups'
import { cn } from '@/lib/utils'
import { usePermission } from '@/hooks/usePermission'
import { useWorkspaceStore } from '@/store/workspaceStore'
import {
  PATH_TITLES,
  buildTopNavSections,
  type NavMenuSection,
  type TopNavSection,
} from '@/router/routeRegistry'

export const TOP_NAV_SECTIONS: TopNavSection[] = buildTopNavSections()

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
  openNavPath: (path: string) => void
}) {
  const { label, sections, activePath, openNavPath } = props
  const [open, setOpen] = useState(false)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearCloseTimer = useCallback(() => {
    if (closeTimer.current != null) {
      clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
  }, [])

  const scheduleClose = useCallback(() => {
    clearCloseTimer()
    closeTimer.current = setTimeout(() => setOpen(false), HOVER_CLOSE_MS)
  }, [clearCloseTimer])

  const openMenu = useCallback(() => {
    clearCloseTimer()
    setOpen(true)
  }, [clearCloseTimer])

  useEffect(() => () => clearCloseTimer(), [clearCloseTimer])

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
    >
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="menu"
        className={cn(
          'inline-flex items-center gap-0.5 rounded-md px-3 py-2 text-sm font-medium transition-colors',
          sectionActive || open
            ? 'bg-primary/10 text-primary'
            : 'text-muted-foreground hover:bg-muted hover:text-foreground'
        )}
      >
        {label}
        <ChevronDown className={cn('h-3.5 w-3.5 opacity-70 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div
          className="absolute left-0 top-full z-50 min-w-[12rem] pt-1"
          role="menu"
          onMouseEnter={openMenu}
          onMouseLeave={scheduleClose}
        >
          <ul className="rounded-md border border-border bg-popover py-1 text-popover-foreground shadow-md">
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
                        to={item.path}
                        aria-current={active ? 'page' : undefined}
                        onClick={(e) => {
                          e.preventDefault()
                          setOpen(false)
                          openNavPath(item.path)
                        }}
                        className={cn(
                          'block px-3 py-2 text-sm transition-colors',
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
      )}
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
      addTab({ key: path, title, path })
      navigate(path)
    },
    [addTab, navigate]
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
          label={section.label}
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
        openNavPath={openNavPath}
      />
    )
  }

  if (!nodes.length) return null

  return (
    <nav className="flex shrink-0 flex-wrap items-center gap-0.5" aria-label="主导航">
      {nodes}
    </nav>
  )
}
