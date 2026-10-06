import { useContext, useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { TabPathContext } from '@/components/layout/TabPathContext'
import { useActiveWorkspaceTab } from '@/hooks/useActiveWorkspaceTab'
import { useApprovalReadScope } from '@/hooks/useApprovalReadScope'
import { usePermission } from '@/hooks/usePermission'
import type { PermissionCode } from '@/lib/permission-codes'

/** 按本标签的原单ID读取，不改筛选，不覆盖任何已打开的新建/编辑/处理草稿。 */
export function useApprovalDetailHandoff<T extends { id: number }>(
  pathname: string, permission: PermissionCode, read: (id: number) => Promise<T>, blocked = false,
) {
  const tabPath = useContext(TabPathContext)
  const location = useLocation()
  const path = tabPath || `${location.pathname}${location.search}`
  const [ownPath, search = ''] = path.split('?')
  const values = new URLSearchParams(search).getAll('detailId')
  const requested = ownPath === pathname && values.length > 0
  const id = values.length === 1 && /^[1-9]\d*$/.test(values[0]) && Number.isSafeInteger(Number(values[0])) ? Number(values[0]) : null
  const { can } = usePermission()
  const allowed = can(permission)
  const active = useActiveWorkspaceTab()
  const scope = useApprovalReadScope()
  const identity = `${scope.key}:${pathname}:${values.join(':')}`
  const [dismissed, setDismissed] = useState('')
  useEffect(() => {
    // 同页关闭保持关闭；KeepAlive离开交接后，下一次进入同链接可重新读取。
    if (!active || !requested) setDismissed('')
  }, [active, requested])
  const [opened, setOpened] = useState<{ identity: string; scope: string; data: T } | null>(null)
  const currentOpened = opened?.scope === scope.key ? opened : null
  const sameTarget = !currentOpened || currentOpened.identity === identity
  const enabled = sameTarget && requested && id != null && allowed && active && !blocked && dismissed !== identity
  const query = useQuery({
    queryKey: ['approval-source-detail', scope.key, pathname, id],
    queryFn: async () => {
      const result = await read(id!)
      if (!scope.isCurrent() || result?.id !== id) throw new Error('原单读取失败，请重新核对')
      return result
    },
    enabled, staleTime: 0, gcTime: 0, refetchOnMount: 'always', retry: false,
  })
  const fresh = enabled && !query.isFetching && !query.isPaused && !query.isError && query.data?.id === id
  useEffect(() => {
    if (opened && opened.scope !== scope.key) setOpened(null)
    if (fresh && query.data && (!currentOpened || currentOpened.identity === identity && currentOpened.data !== query.data)) {
      setOpened({ identity, scope: scope.key, data: query.data })
    }
  }, [fresh, query.data, opened, currentOpened, identity, scope.key])
  // 已打开详情保持原对象及其内部草稿；新目标等用户主动关闭后才读取。
  const data = currentOpened && allowed && scope.isCurrent() ? currentOpened.data : undefined
  const open = !!data && ownPath === pathname && active
  const ready = open && sameTarget && fresh
  const message = currentOpened && !sameTarget
    ? '先关闭当前原单，再查看新的审批原单；已保留当前输入'
    : !requested || dismissed === identity ? ''
      : id == null ? '原单定位信息无效'
        : !allowed ? '没有查看原单的权限'
          : blocked ? '先关闭当前弹窗，再查看审批原单；已保留当前输入'
            : query.isError ? '原单读取失败，请重试或核对访问权限'
              : !ready ? '加载审批原单…' : ''
  return { id, data, open, ready, message,
    canRetry: enabled && query.isError, retry: () => { if (enabled) void query.refetch() },
    canClose: !!currentOpened && !ready,
    close: () => { setDismissed(currentOpened?.identity ?? identity); setOpened(null) },
  }
}
