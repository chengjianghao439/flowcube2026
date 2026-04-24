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

  const submitScan = useCallback(async (payload: ScanPayload, requestKey: string): Promise<void> => {
    await client.post('/scan-logs', payload, {
      headers: withRequestKeyHeaders(requestKey, { 'X-Client': 'pda' }),
    })
  }, [])

  // 记录错误扫码（静默，不影响流程）
  const logError = useCallback((payload: ErrorPayload): void => {
    client.post('/scan-logs/error', payload).catch(() => { /* 静默失败 */ })
  }, [])

  // 记录撤销操作
  const logUndo = useCallback((payload: UndoPayload): void => {
    client.post('/scan-logs/undo', {
      taskId:  payload.taskId,
      itemId:  payload.itemId,
      barcode: payload.barcode,
      prevQty: payload.prevQty,
      newQty:  payload.newQty,
    }).catch(() => { /* 静默失败 */ })
  }, [])

  return { submitScan, logError, logUndo, currentUser: user }
}
