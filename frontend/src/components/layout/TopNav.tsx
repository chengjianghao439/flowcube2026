/**
 * TopNav — 顶栏主导航（hover 下拉，最多两级）
 *
 * 菜单结构继承自原 Sidebar 分组；使用 Link + 工作区标签与未保存守卫。
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { usePermission } from '@/hooks/usePermission'
import { useWorkspaceStore } from '@/store/workspaceStore'
import { buildWorkspaceTabRegistration } from '@/router/workspaceRouteMeta'
import { PATH_TITLES, buildTopNavSections, type NavChildItem, type TopNavSection } from '@/router/routeRegistry'
import { confirmDirtyLeave } from '@/lib/unsavedChanges'

export const TOP_NAV_SECTIONS: TopNavSection[] = buildTopNavSections()

/** 在同级 path 中取最长前缀匹配，避免 /inventory 误匹配 /inventory/overview */
function matchChildPath(pathname: string, paths: string[]): string | null {
  const sorted = [...paths].sort((a, b) => b.length - a.length)
  for (const p of sorted) {
    if (pathname === p || pathname.startsWith(`${p}/`)) return p
  }
  return null
}

function sectionIsActive(pathname: string, section: TopNavSection): boolean {
  if (section.kind === 'link') {
    return pathname === section.path || pathname.startsWith(`${section.path}/`)
  }
  const paths = section.children.map((c) => c.path)
  return matchChildPath(pathname, paths) != null
}

function childIsActive(pathname: string, childPath: string, siblingPaths: string[]): boolean {
  const hit = matchChildPath(pathname, siblingPaths)
  return hit === childPath
}

const HOVER_CLOSE_MS = 140

function NavItemLink(props: {
  label: string
  path: string
  active: boolean
  navigateWithGuard: (path: string) => void
}) {
  const { label, path, active, navigateWithGuard } = props
  return (
    <Link
      to={path}
      aria-current={active ? 'page' : undefined}
      onClick={(e) => {
        e.preventDefault()
        navigateWithGuard(path)
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
  children: NavChildItem[]
  pathname: string
  navigateWithGuard: (path: string) => void
}) {
  const { label, children, pathname, navigateWithGuard } = props
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

  const siblingPaths = children.map((c) => c.path)
  const sectionActive = matchChildPath(pathname, siblingPaths) != null

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
          className="absolute left-0 top-full z-50 min-w-[11rem] pt-1"
          role="menu"
          onMouseEnter={openMenu}
          onMouseLeave={scheduleClose}
        >
          <ul className="rounded-md border border-border bg-popover py-1 text-popover-foreground shadow-md">
            {children.map((item) => {
              const active = childIsActive(pathname, item.path, siblingPaths)
              return (
                <li key={item.path} role="none">
                  <Link
                    role="menuitem"
                    to={item.path}
                    aria-current={active ? 'page' : undefined}
                    onClick={(e) => {
                      e.preventDefault()
                      setOpen(false)
                      navigateWithGuard(item.path)
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

  /** 打开/激活目标页：若当前页有未保存内容，先确认再跳转 */
  const navigateWithGuard = useCallback(
    (path: string) => {
      const title = PATH_TITLES[path] ?? path
      const currentKey = buildWorkspaceTabRegistration(location.pathname, location.search).key
      confirmDirtyLeave({
        dirtyKeys: [currentKey],
        proceed: () => {
          addTab({ key: path, title, path })
          navigate(path)
        },
      })
    },
    [addTab, location.pathname, location.search, navigate]
  )

  const nodes: ReactNode[] = []

  for (const section of TOP_NAV_SECTIONS) {
    if (section.kind === 'link') {
      if (!can(section.perm)) continue
      const active = sectionIsActive(pathname, section)
      nodes.push(
        <NavItemLink
          key={section.path}
          label={section.label}
          path={section.path}
          active={active}
          navigateWithGuard={navigateWithGuard}
        />
      )
      continue
    }

    const visible = section.children.filter((c) => can(c.perm))
    if (!visible.length) continue

    if (visible.length === 1) {
      const only = visible[0]
      const active =
        pathname === only.path || pathname.startsWith(`${only.path}/`)
      nodes.push(
        <NavItemLink
          key={only.path}
          label={section.label}
          path={only.path}
          active={active}
          navigateWithGuard={navigateWithGuard}
        />
      )
      continue
    }

    nodes.push(
      <NavItemMenu
        key={section.label}
        label={section.label}
        children={visible}
        pathname={pathname}
        navigateWithGuard={navigateWithGuard}
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
