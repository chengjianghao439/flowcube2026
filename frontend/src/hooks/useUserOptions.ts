/**
 * useUserOptions — 用户下拉选项
 *
 * 各查询弹窗里的「经办人 / 申请人」下拉共用同一份 user-options 数据与文案
 * （含「（我）」标注与「（已禁用）」后缀），抽成 hook 消除 6 处逐字重复。
 */
import { useQuery } from '@tanstack/react-query'
import { getUserOptionsApi, type UserOption } from '@/api/users'
import { useAuthStore } from '@/store/authStore'

export function useUserOptions(enabled = true) {
  const currentUserId = useAuthStore(s => s.user?.id)
  const { data: options } = useQuery({
    queryKey: ['user-options'],
    queryFn: getUserOptionsApi,
    staleTime: 1000 * 60 * 5,
    enabled,
  })
  return { options: options ?? [], currentUserId }
}

/** 单个用户选项的展示文案（含「（我）」与「（已禁用）」） */
export function userOptionLabel(u: UserOption, currentUserId?: number): string {
  const me = u.id === currentUserId ? '（我）' : ''
  const disabled = !u.isActive ? '（已禁用）' : ''
  return `${u.realName}${me}${disabled}`
}
