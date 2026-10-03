import apiClient from '@/api/client'
import { useAuthStore } from '@/store/authStore'
import { kitQuerySession } from './kitRecoveryIdentity'
import type { OperationRequestStatus } from '@/api/operation-requests'
export const KIT_QUERY_KEY = 'flowcube-kit-query-records-v1'
export interface KitQueryRecord {
  version: 1
  draftId: string
  scope: string
  sessionId: string
  userId: number
  baseURL: string
  requestKey: string
  action: string
  kind: string
  resourceType: 'sale_order' | 'sale_return' | 'warehouse_task'
  resourceId?: number
  context?: {
    taskId: number
    containerId?: number
    locationId?: number
    packageId?: number
  }
}
const positiveId = (value: unknown) =>
  Number.isSafeInteger(value) && Number(value) > 0
function valid(r: KitQueryRecord): boolean {
  if (
    !r ||
    r.version !== 1 ||
    !positiveId(r.userId) ||
    ![
      'draftId',
      'scope',
      'sessionId',
      'baseURL',
      'requestKey',
      'action',
      'kind'
    ].every(
      (key) =>
        typeof r[key as keyof KitQueryRecord] === 'string' &&
        String(r[key as keyof KitQueryRecord]).length > 0
    )
  )
    return false
  if (
    Object.keys(r).some(
      (key) =>
        ![
          'version',
          'draftId',
          'scope',
          'sessionId',
          'userId',
          'baseURL',
          'requestKey',
          'action',
          'kind',
          'resourceType',
          'resourceId',
          'context'
        ].includes(key)
    )
  )
    return false
  if (r.resourceType === 'sale_order') {
    if (r.context) return false
    if (r.kind === 'create')
      return r.action === 'sale.create' && r.resourceId == null
    return (
      [
        'update',
        'adjust',
        'ship',
        'cancel',
        'reserve',
        'release',
        'delete'
      ].includes(r.kind) &&
      positiveId(r.resourceId) &&
      r.action === `sale.${r.kind}.${r.resourceId}`
    )
  }
  if (r.resourceType === 'sale_return')
    return (
      r.kind === 'source-return-create' &&
      r.action === 'saleReturn.create' &&
      r.resourceId == null &&
      !r.context
    )
  const context = r.context
  if (
    r.resourceType !== 'warehouse_task' ||
    !positiveId(r.resourceId) ||
    !context ||
    context.taskId !== r.resourceId
  )
    return false
  if (
    Object.keys(context).some(
      (key) =>
        !['taskId', 'containerId', 'locationId', 'packageId'].includes(key)
    )
  )
    return false
  if (r.kind === 'cancel-return-row')
    return (
      r.action === `scan-log.cancel-return.${r.resourceId}` &&
      positiveId(context.containerId) &&
      positiveId(context.locationId) &&
      context.packageId == null
    )
  return (
    r.kind === 'cancel-return-box' &&
    r.action === `scan-log.cancel-return-box.${r.resourceId}` &&
    positiveId(context.packageId) &&
    context.containerId == null &&
    context.locationId == null
  )
}
function readAll(): KitQueryRecord[] {
  const raw = sessionStorage.getItem(KIT_QUERY_KEY)
  if (!raw) return []
  const doc = JSON.parse(raw)
  if (
    doc?.version !== 1 ||
    !Array.isArray(doc.records) ||
    !doc.records.every(valid)
  )
    throw new Error('历史查询记录无法核对归属，请保留草稿并人工核对')
  if (
    new Set(doc.records.map((r: KitQueryRecord) => r.requestKey)).size !==
      doc.records.length ||
    new Set(doc.records.map((r: KitQueryRecord) => r.scope)).size !==
      doc.records.length
  )
    throw new Error('历史查询记录存在重复身份，请人工核对')
  return doc.records
}
export function queryRecordOwned(record: KitQueryRecord) {
  const auth = useAuthStore.getState()
  return (
    !!auth.token &&
    auth.user?.id === record.userId &&
    kitQuerySession() === record.sessionId &&
    (apiClient.defaults.baseURL ?? '/api') === record.baseURL
  )
}
export function loadKitQuery(scope: string): KitQueryRecord | null {
  return readAll().find((r) => r.scope === scope) ?? null
}
export function saveKitQuery(record: KitQueryRecord) {
  // Allowlisted projection only: body, names, barcodes, credentials never persist.
  const safe: KitQueryRecord = {
    version: 1,
    draftId: record.draftId,
    scope: record.scope,
    sessionId: record.sessionId,
    userId: record.userId,
    baseURL: record.baseURL,
    requestKey: record.requestKey,
    action: record.action,
    kind: record.kind,
    resourceType: record.resourceType,
    ...(record.resourceId == null ? {} : { resourceId: record.resourceId }),
    ...(record.context
      ? {
          context: {
            taskId: record.context.taskId,
            ...(record.context.containerId == null
              ? {}
              : { containerId: record.context.containerId }),
            ...(record.context.locationId == null
              ? {}
              : { locationId: record.context.locationId }),
            ...(record.context.packageId == null
              ? {}
              : { packageId: record.context.packageId })
          }
        }
      : {})
  }
  if (!valid(safe)) throw new Error('原查询身份不完整，未发送请求')
  const current = readAll()
  if (
    current.some(
      (r) => r.scope === safe.scope && r.requestKey !== safe.requestKey
    )
  )
    throw new Error('该页面另有原操作待核对，请先查询原结果')
  sessionStorage.setItem(
    KIT_QUERY_KEY,
    JSON.stringify({
      version: 1,
      records: [
        ...current.filter((r) => r.requestKey !== safe.requestKey),
        safe
      ]
    })
  )
  if (!sameStoredKitQuery(safe)) throw new Error('原查询身份未保存，请保留草稿')
}
export function sameStoredKitQuery(record: KitQueryRecord) {
  return readAll().some(
    (r) =>
      r.requestKey === record.requestKey &&
      JSON.stringify(r) === JSON.stringify(record)
  )
}
export function removeKitQuery(record: KitQueryRecord) {
  if (!sameStoredKitQuery(record))
    throw new Error('原查询身份已变化，当前草稿保留')
  sessionStorage.setItem(
    KIT_QUERY_KEY,
    JSON.stringify({
      version: 1,
      records: readAll().filter((r) => r.requestKey !== record.requestKey)
    })
  )
  if (readAll().some((r) => r.requestKey === record.requestKey))
    throw new Error('已核实业务结果，但原记录未清理，请继续保留阻断')
}
export function receiptMatches(
  record: KitQueryRecord,
  receipt: OperationRequestStatus
) {
  if (
    receipt.resourceType !== record.resourceType ||
    !Number.isSafeInteger(receipt.resourceId) ||
    Number(receipt.resourceId) <= 0
  )
    return false
  if (record.resourceId != null) return receipt.resourceId === record.resourceId
  const data = receipt.data as { id?: number } | null
  return Number.isSafeInteger(data?.id) && data?.id === receipt.resourceId
}
