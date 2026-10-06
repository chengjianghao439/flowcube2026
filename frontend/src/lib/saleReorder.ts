import { getApiClientBaseURL, subscribeApiClientBaseURL } from '@/api/client'
import { useAuthStore } from '@/store/authStore'
import { hasPermission } from './permissions'
import { PERMISSIONS, type PermissionCode } from './permission-codes'
import type { KitReadOwner } from '@/api/kits'
export const positiveReorderId = (id: unknown): id is number => typeof id === 'number' && Number.isSafeInteger(id) && id > 0
export function readReorderSource(path: string): number | 'invalid' | null {
  const params = new URLSearchParams(path.split('?')[1] ?? '')
  if (!params.has('sourceId')) return null
  const values = params.getAll('sourceId')
  if (values.length !== 1 || !/^[1-9]\d*$/.test(values[0]) || !positiveReorderId(Number(values[0]))) return 'invalid'
  return Number(values[0])
}
let epoch = 0
const listeners = new Set<() => void>()
function changed() { epoch++; listeners.forEach(fn => fn()) }
subscribeApiClientBaseURL(changed)
const actorKey = () => { const a = useAuthStore.getState(); return JSON.stringify([a.token, a.sessionGeneration, a.user?.id, a.user?.roleId, a.user?.permissions]) }
let lastActor = actorKey()
useAuthStore.subscribe(() => { const next = actorKey(); if (next !== lastActor) { lastActor = next; changed() } })
export const reorderEpoch = () => epoch
export function subscribeReorder(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } }
export interface ReorderOwner extends KitReadOwner { epoch: number }
export function captureReorderOwner(): ReorderOwner { const a = useAuthStore.getState(); return { baseURL: getApiClientBaseURL() ?? '/api', userId: a.user?.id ?? null, sessionGeneration: a.sessionGeneration, epoch } }
export function reorderOwnerCurrent(owner: ReorderOwner) { const a = useAuthStore.getState(); return !!a.token && a.user?.id === owner.userId && a.sessionGeneration === owner.sessionGeneration && (getApiClientBaseURL() ?? '/api') === owner.baseURL && epoch === owner.epoch }
export function assertReorderOwner(owner: ReorderOwner) { if (!reorderOwnerCurrent(owner)) throw new Error('账号、权限或服务器已变化，原草稿保留；请核对后重新打开新单') }
export function mayReorder(permission: PermissionCode) { const a = useAuthStore.getState(); return !!a.token && hasPermission(a.user?.permissions, permission, a.user?.roleId) }
export function assertReorderPermission(permission: PermissionCode) { if (!mayReorder(permission)) throw new Error('缺少当前资料的查看权限，请保留来源并联系管理员核对') }
export const reorderConfig = (owner: KitReadOwner) => ({ baseURL: owner.baseURL, _authSessionGeneration: owner.sessionGeneration, _erpApiFallbackTried: true, skipGlobalError: true })
export function validReorderQuantity(q: number, integer = false) { return Number.isFinite(q) && q > 0 && q <= 9999999999.99 && Math.abs(q * 100 - Math.round(q * 100)) < 1e-6 && (!integer || Number.isSafeInteger(q)) }
export const mayCreateReorder = () => mayReorder(PERMISSIONS.SALE_ORDER_CREATE)
