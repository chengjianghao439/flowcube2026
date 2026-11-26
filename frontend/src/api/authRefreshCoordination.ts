/** 跨窗口串行提交一次性刷新令牌。持久记录只含原令牌摘要，接力凭据只在内存中加密传递。 */
type PublishedResult =
  | { kind: 'success'; token: string; refreshToken: string }
  | { kind: 'revoked' }

export type RefreshResult = PublishedResult | { kind: 'unavailable' | 'unknown' | 'superseded' }

interface RefreshAttempt {
  scope: string
  refreshToken: string
  isCurrent: () => boolean
  rotate: () => Promise<RefreshResult>
}

type Channel = Pick<BroadcastChannel, 'postMessage' | 'addEventListener' | 'removeEventListener' | 'close'>
interface Coordination {
  withLock: <T>(name: string, run: () => Promise<T>) => Promise<T>
  storage: Pick<Storage, 'getItem' | 'setItem'>
  crypto: Crypto
  channel: Channel
  isOnline: () => boolean
  allowLocalLock?: boolean
}

const PREFIX = 'flowcube-auth-rotation-v1:'
const TRANSFER_LIMIT = 16
const encoder = new TextEncoder()

type SealedResult = { iv: Uint8Array<ArrayBuffer>; encrypted: ArrayBuffer }
type TransferMessage = { type: 'find'; key: string } | { type: 'result'; key: string; sealed: SealedResult }

function isPublishedResult(value: unknown): value is PublishedResult {
  if (!value || typeof value !== 'object') return false
  if ('kind' in value && value.kind === 'revoked') return true
  return 'kind' in value && value.kind === 'success'
    && 'token' in value && typeof value.token === 'string' && Boolean(value.token)
    && 'refreshToken' in value && typeof value.refreshToken === 'string' && Boolean(value.refreshToken)
}

export function createAuthRefreshCoordinator({ withLock, storage, crypto, channel, isOnline, allowLocalLock = false }: Coordination) {
  const recent = new Map<string, SealedResult>()
  const onLookup = (event: MessageEvent<TransferMessage>) => {
    const message = event.data
    if (message?.type !== 'find') return
    const sealed = recent.get(message.key)
    if (sealed) channel.postMessage({ type: 'result', key: message.key, sealed } satisfies TransferMessage)
  }
  channel.addEventListener('message', onLookup)

  function lookup(key: string, encryptionKey: CryptoKey): Promise<RefreshResult> {
    return new Promise(resolve => {
      const finish = (result: RefreshResult) => {
        clearTimeout(timer)
        channel.removeEventListener('message', onResult)
        resolve(result)
      }
      const onResult = async (event: MessageEvent<TransferMessage>) => {
        const message = event.data
        if (message?.type !== 'result' || message.key !== key) return
        try {
          const { iv, encrypted } = message.sealed
          const decoded = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, encryptionKey, encrypted)
          const result: unknown = JSON.parse(new TextDecoder().decode(decoded))
          if (isPublishedResult(result)) finish(result)
        } catch { /* 无法解封的消息不具有原会话证明。 */ }
      }
      const timer = setTimeout(() => finish({ kind: 'unknown' }), 500)
      channel.addEventListener('message', onResult)
      try { channel.postMessage({ type: 'find', key } satisfies TransferMessage) }
      catch { finish({ kind: 'unknown' }) }
    })
  }

  return {
    async refresh({ scope, refreshToken, isCurrent, rotate }: RefreshAttempt): Promise<RefreshResult> {
      try {
        const material = await crypto.subtle.digest('SHA-256', encoder.encode(JSON.stringify([PREFIX, scope, refreshToken])))
        const routingDigest = await crypto.subtle.digest('SHA-256', material)
        const key = PREFIX + Array.from(new Uint8Array(routingDigest), byte => byte.toString(16).padStart(2, '0')).join('')
        const encryptionKey = await crypto.subtle.importKey('raw', material, 'AES-GCM', false, ['encrypt', 'decrypt'])
        const run = async (): Promise<RefreshResult> => {
          if (!isCurrent()) return { kind: 'superseded' }
          if (storage.getItem(key) !== null) return lookup(key, encryptionKey)
          if (!isOnline()) return { kind: 'unavailable' }
          // 先留痕再发送。窗口崩溃、响应丢失或其他无法证明的结果都不得重发旧令牌。
          storage.setItem(key, '1')
          if (storage.getItem(key) !== '1') return { kind: 'unavailable' }
          const result = await rotate()
          if (isPublishedResult(result) && isCurrent()) {
            try {
              const iv = crypto.getRandomValues(new Uint8Array(12))
              const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, encryptionKey, encoder.encode(JSON.stringify(result)))
              recent.set(key, { iv, encrypted })
              if (recent.size > TRANSFER_LIMIT) {
                const first = recent.keys().next()
                if (!first.done) recent.delete(first.value)
              }
            } catch { /* 本窗口已有真实回执，其它窗口保留待确认状态。 */ }
          }
          return result
        }
        let entered = false
        try {
          return await withLock(key, () => {
            entered = true
            return run()
          })
        } catch (error) {
          if (entered || !allowLocalLock || (error as Error)?.name !== 'SecurityError') throw error
          // file:// 可暴露 Web Locks 却在调用回调前拒绝。仍检查同一摘要标记。
          return refreshLocally(key, isCurrent, run)
        }
      } catch {
        return { kind: 'unavailable' }
      }
    },
    dispose() {
      channel.removeEventListener('message', onLookup)
      channel.close()
      recent.clear()
    },
  }
}

let browserCoordinator: ReturnType<typeof createAuthRefreshCoordinator> | undefined
// 已发过的旧凭据在当前进程不再轮换。只在内存短暂保留最近的接力结果，
// 超出上限后只保留旧键的「已发送」记录，避免长时间持有后续有效凭据。
const localRotations = new Map<string, Promise<RefreshResult>>()
const recentLocalKeys = new Set<string>()
const spentRotation = Promise.resolve<RefreshResult>({ kind: 'unknown' })
async function refreshLocally(key: string, isCurrent: () => boolean, rotate: () => Promise<RefreshResult>): Promise<RefreshResult> {
  if (!isCurrent()) return { kind: 'superseded' }
  if (globalThis.navigator?.onLine === false) return { kind: 'unavailable' }
  let flight = localRotations.get(key)
  if (!flight) {
    flight = Promise.resolve().then(async (): Promise<RefreshResult> => {
      if (!isCurrent()) return { kind: 'superseded' }
      try { return await rotate() } catch { return { kind: 'unknown' } }
    })
    localRotations.set(key, flight)
    void flight.then(result => {
      if (result.kind === 'unavailable' || result.kind === 'superseded') {
        localRotations.delete(key)
      } else if (isPublishedResult(result)) {
        recentLocalKeys.add(key)
        if (recentLocalKeys.size > TRANSFER_LIMIT) {
          const oldest = recentLocalKeys.values().next().value!
          recentLocalKeys.delete(oldest)
          localRotations.set(oldest, spentRotation)
        }
      }
    })
  }
  const result = await flight
  return isCurrent() ? result : { kind: 'superseded' }
}

export async function coordinateAuthRefresh(attempt: RefreshAttempt): Promise<RefreshResult> {
  const local = (scope: string) => refreshLocally(JSON.stringify([scope, attempt.refreshToken]), attempt.isCurrent, attempt.rotate)
  if (typeof window === 'undefined') return local(attempt.scope)
  try {
    const scope = new URL(attempt.scope || '/api', window.location.href).href.replace(/\/+$/, '')
    const allowLocalLock = window.location.protocol === 'file:' || window.location.protocol === 'http:' && !window.isSecureContext
    if (!navigator.locks?.request || !globalThis.crypto?.subtle || typeof BroadcastChannel !== 'function') {
      return allowLocalLock ? local(scope) : { kind: 'unavailable' }
    }
    if (!browserCoordinator) {
      try {
        browserCoordinator = createAuthRefreshCoordinator({
          withLock: async (name, run) => await navigator.locks.request(name, run),
          storage: localStorage,
          crypto: globalThis.crypto,
          channel: new BroadcastChannel(PREFIX),
          isOnline: () => navigator.onLine !== false,
          allowLocalLock,
        })
      } catch (error) {
        if (allowLocalLock && (error as Error)?.name === 'SecurityError') return local(scope)
        throw error
      }
    }
    return browserCoordinator.refresh({ ...attempt, scope })
  } catch {
    return { kind: 'unavailable' }
  }
}

if (import.meta.hot) import.meta.hot.dispose(() => browserCoordinator?.dispose())
