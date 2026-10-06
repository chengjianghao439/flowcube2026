export interface DisposalSourceInput { sourceId: number; expectedRevision: number; operationUuid: string }
export interface HandlingLink {
  linkId: number; state: 'ACTIVE' | 'TERMINATED'; allocatedQuantity: number; executedQuantity: number | null; releasedQuantity: number
  terminal: boolean; returnClosed: boolean; pendingReason: { code: string; message: string } | null
  target?: { type: string; id: number; orderNo: string; path: string; status: number }
}
export interface HandlingSourceAck { id: number; intentUuid: string; productId: number; warehouseId: number; unit: string; handlingType: 1 | 2 | 3; quantity: number; revision: number }
export interface HandlingSource extends HandlingSourceAck {
  originKind: 'ordinary' | 'legacy'; productCode: string; productName: string; warehouseName: string; warehouseCode: string; createdAt: string
  budget: { intentionQuantity: number; allocatedQuantity: number; releasedQuantity: number; availableQuantity: number; actualExecutedQuantity: number | null; progress: string }; links: HandlingLink[]
}
export interface ConversionSnapshot {
  snapshot: { version: 1; head: Record<string, unknown>; items: Array<Record<string, unknown>>; approval: Record<string, unknown> }; snapshotFingerprint: string
  conversion?: { id: number; operationUuid: string } | null
}
export interface ConversionAck { id: number; originalDisposalId: number; disposalNo: string; operationUuid: string; snapshotFingerprint: string; sources: Array<{ sourceId: number; intentUuid: string; legacyItemId: number; handlingType: 1 | 2 | 3; productId: number; warehouseId: number; unit: string; quantity: number; revision: 1 }> }
export interface ReleaseAck { sourceId: number; linkId: number; executedQuantity: number; releasedQuantity: number; revision: number }
export type HandlingAck = HandlingSourceAck | ConversionAck | ReleaseAck | { id: number; orderNo: string } | { id: number; returnNo: string } | { id: number; disposalNo: string }
export type HandlingKind = 'source' | 'sale' | 'purchase_return' | 'scrap' | 'release' | 'conversion'
export interface HandlingSpec { kind: HandlingKind; draftIdentity: string; intentUuid?: string; sourceId?: number; linkId?: number; legacyId?: number; operationUuid: string; requestKey: string; path: string; action: string; body: Record<string, unknown> }
