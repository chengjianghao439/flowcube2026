import { useAuthStore } from '@/store/authStore'

const SESSION_KEY = 'flowcube-kit-query-session-v1'
type Identity = { version: 1; sessionId: string; userId: number }
let identity: Identity | null = null
const nonce = () => crypto.randomUUID()
function readIdentity(): Identity | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null')
    return value?.version === 1 &&
      typeof value.sessionId === 'string' &&
      Number.isSafeInteger(value.userId)
      ? value
      : null
  } catch {
    return null
  }
}
function rotate(userId?: number) {
  identity = userId ? { version: 1, sessionId: nonce(), userId } : null
  try {
    if (identity) sessionStorage.setItem(SESSION_KEY, JSON.stringify(identity))
    else sessionStorage.removeItem(SESSION_KEY)
  } catch {
    identity = null
  }
}
const initial = useAuthStore.getState()
// Rehydrate deliberately resets the in-memory generation to 0. A login already
// performed before module loading must not adopt a prior login's query identity.
identity = initial.sessionGeneration === 0 ? readIdentity() : null
if (identity && (!initial.token || initial.user?.id !== identity.userId))
  identity = null
if (!identity && initial.token && initial.user) rotate(initial.user.id)
// Imported eagerly by main.tsx: stays active after leaving all kit pages.
useAuthStore.subscribe((next, previous) => {
  if (
    next.sessionGeneration !== previous.sessionGeneration ||
    next.user?.id !== previous.user?.id
  )
    rotate(next.token ? next.user?.id : undefined)
})
// Local-development auth storage is shared across browser tabs. A foreign tab's
// auth update cannot renew ownership of this tab's old operation on next reload.
// Conservatively invalidate only query identity; never read or persist tokens.
if (typeof window !== 'undefined')
  window.addEventListener('storage', (event) => {
    if (event.key === 'flowcube-auth-v3' && event.storageArea === localStorage)
      rotate(
        useAuthStore.getState().token
          ? useAuthStore.getState().user?.id
          : undefined
      )
  })
export function kitQuerySession() {
  const auth = useAuthStore.getState()
  if (!auth.token || !auth.user)
    throw new Error('请先完成正常登录，再查询原操作')
  if (!identity || identity.userId !== auth.user.id) rotate(auth.user.id)
  if (!identity)
    throw new Error('无法保存原查询身份，请保留草稿并检查浏览器存储')
  if (JSON.stringify(readIdentity()) !== JSON.stringify(identity))
    throw new Error('原查询会话身份已变化，请保留草稿并人工核对')
  return identity.sessionId
}
