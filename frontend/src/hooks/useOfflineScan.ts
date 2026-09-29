/**
 * useOfflineScan — 强在线扫码提交
 *
 * 用法：替换页面中直接调用 client.post('/scan-logs', ...) 的地方
 *
 *   const { submitScan, logError, logUndo } = useOfflineScan()
 */
import { useCallback } from 'react'
import { payloadClient as client } from '@/api/client'
import { useAuthStore } from '@/store/authStore'
import { withRequestKeyHeaders } from '@/lib/requestKey'

interface ScanPayload {
  taskId:       number
  itemId:       number
  containerId:  number
  barcode:      string
  productId:    number
  qty:          number
  scanMode:     '整件' | '散件'
  locationCode?: string
}

interface ErrorPayload {
  taskId?:  number
  barcode:  string
  reason:   string
}

interface UndoPayload {
  taskId:      number
  itemId:      number
  barcode:     string
  prevQty:     number
  newQty:      number
  productName: string
}

export function useOfflineScan() {
  const user          = useAuthStore(s => s.user)

  // 返回后端回执本身：**扫码流程与语义不变**，只是把本来就拿到的响应交给调用方。
  // 批 B1/B2 需要它回显「新取货码 + 取货量 + 打印状态」；旧调用方忽略返回值即可。
  // 用泛型表达回执结构，调用方按需指定，**不需要在调用处做强制类型断言**。
  const submitScan = useCallback(async <T = unknown,>(payload: ScanPayload, requestKey: string): Promise<T> => {
    return client.post('/scan-logs', payload, {
      skipGlobalError: true,
      headers: withRequestKeyHeaders(requestKey, { 'X-Client': 'pda' }),
    }) as Promise<T>
  }, [])

  // 记录错误扫码（静默，不影响流程）
  const logError = useCallback((payload: ErrorPayload): void => {
    client.post('/scan-logs/error', payload, { skipGlobalError: true }).catch(() => { /* 静默失败 */ })
  }, [])

  // 记录撤销操作
  const logUndo = useCallback((payload: UndoPayload): void => {
    client.post('/scan-logs/undo', {
      taskId:  payload.taskId,
      itemId:  payload.itemId,
      barcode: payload.barcode,
      prevQty: payload.prevQty,
      newQty:  payload.newQty,
    }, { skipGlobalError: true }).catch(() => { /* 静默失败 */ })
  }, [])

  return { submitScan, logError, logUndo, currentUser: user }
}
