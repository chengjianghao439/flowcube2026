import { useCallback, useEffect, useState } from 'react'
import { safeJsonParse } from '@/lib/safeJsonParse'

const STORAGE_KEY = 'pda_pending_request_confirmations'

export interface PendingRequestRecord {
  requestKey: string
  action: string
  label: string
  createdAt: string
}

function loadPendingRequests(): PendingRequestRecord[] {
  if (typeof window === 'undefined') return []
  const raw = localStorage.getItem(STORAGE_KEY) || '[]'
  const parsed = safeJsonParse<unknown>(raw, STORAGE_KEY, true)
  return Array.isArray(parsed) ? (parsed as PendingRequestRecord[]) : []
}

function savePendingRequests(records: PendingRequestRecord[]) {
  if (typeof window === 'undefined') return
  localStorage.setItem(STORAGE_KEY, JSON.stringify(records))
}

function replaceRecord(records: PendingRequestRecord[], next: PendingRequestRecord) {
  return [...records.filter((item) => item.action !== next.action), next]
}

export function usePendingRequests() {
  const [records, setRecords] = useState<PendingRequestRecord[]>(loadPendingRequests)

  useEffect(() => {
    savePendingRequests(records)
  }, [records])

  const addPending = useCallback((record: PendingRequestRecord) => {
    setRecords((current) => replaceRecord(current, record))
  }, [])

  const removePending = useCallback((action: string) => {
    setRecords((current) => current.filter((item) => item.action !== action))
  }, [])

  const clearAll = useCallback(() => {
    setRecords([])
  }, [])

  return {
    records,
    addPending,
    removePending,
    clearAll,
    pendingCount: records.length,
  }
}
