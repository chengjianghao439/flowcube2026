/**
 * useOfflineQueue — PDA 离线操作队列
 *
 * 原理：
 *  1. 调用 enqueue() 将操作存入 localStorage
 *  2. 网络恢复时自动 flush，按顺序重放请求
 *  3. 成功后从队列移除，失败时保留并标记 retryCount
 *  4. 最多重试 3 次，超出则标记 failed
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import axios from 'axios'
import { useAuthStore } from '@/store/authStore'
import { useNetworkStatus } from './useNetworkStatus'

const QUEUE_KEY  = 'pda_offline_queue'
const MAX_RETRY  = 3

export interface QueuedOp {
  id:         string         // uuid
  method:     'POST' | 'PUT' | 'PATCH' | 'DELETE'
  url:        string         // e.g. '/api/scan-logs'
  body:       unknown
  retryCount: number
  status:     'pending' | 'syncing' | 'failed'
  createdAt:  string
  label:      string         // 用于 UI 展示，如「扫码记录 CNT000123」
}

function loadQueue(): QueuedOp[] {
  try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]') } catch { return [] }
}

function saveQueue(q: QueuedOp[]) {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(q))
}

function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

export function useOfflineQueue() {
  const [queue, setQueue]     = useState<QueuedOp[]>(loadQueue)
  const networkStatus         = useNetworkStatus()
  const flushingRef           = useRef(false)

  // 持久化每次变化
  useEffect(() => { saveQueue(queue) }, [queue])

  // 网络恢复时自动 flush
  useEffect(() => {
    if (networkStatus === 'online') flush()
  }, [networkStatus]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── 入队 ────────────────────────────────────────────────────────────────
  const enqueue = useCallback((
    op: Pick<QueuedOp, 'method' | 'url' | 'body' | 'label'>
  ): string => {
    const item: QueuedOp = {
      ...op,
      id:         uid(),
      retryCount: 0,
      status:     'pending',
      createdAt:  new Date().toISOString(),
    }
    setQueue(q => [...q, item])
    return item.id
  }, [])

  // ── 移除 ────────────────────────────────────────────────────────────────
  const remove = useCallback((id: string) => {
    setQueue(q => q.filter(op => op.id !== id))
  }, [])

  // ── Flush：按序重放所有 pending 操作 ─────────────────────────────────────
  const flush = useCallback(async () => {
    if (flushingRef.current) return
    const pending = loadQueue().filter(op => op.status === 'pending')
    if (pending.length === 0) return

    flushingRef.current = true
    const token = useAuthStore.getState().token

    for (const op of pending) {
      // 标记为同步中
      setQueue(q => q.map(o => o.id === op.id ? { ...o, status: 'syncing' } : o))

      try {
        await axios({
          method:  op.method,
          url:     `/api${op.url.startsWith('/api') ? op.url.slice(4) : op.url}`,
          data:    op.body,
          headers: { Authorization: `Bearer ${token}` },
          timeout: 10_000,
        })
        // 成功：移除
        setQueue(q => q.filter(o => o.id !== op.id))
      } catch {
        const newRetry = op.retryCount + 1
        if (newRetry >= MAX_RETRY) {
          setQueue(q => q.map(o => o.id === op.id ? { ...o, status: 'failed', retryCount: newRetry } : o))
        } else {
          setQueue(q => q.map(o => o.id === op.id ? { ...o, status: 'pending', retryCount: newRetry } : o))
        }
      }
    }
    flushingRef.current = false
  }, [])

  const pendingCount = queue.filter(op => op.status !== 'failed').length
  const failedCount  = queue.filter(op => op.status === 'failed').length

  return { queue, enqueue, remove, flush, pendingCount, failedCount }
}
