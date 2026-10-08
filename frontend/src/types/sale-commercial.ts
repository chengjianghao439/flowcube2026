import type { CreateSaleParams, SaleOrder, SaleOrderItem } from './sale'
import type { PrintItem } from '@/components/print/TemplateRenderer'
export type CommercialInput = { lineKey: string; warehouseId?: number; quantity: number } & (
  | { kind: 'kit'; kitVersionId: number; priceSource: 'kit_default' | 'manual'; unitPrice?: number }
  | {
      kind: 'ordinary'
      productId: number
      entryUnit?: string | null
      priceSource: 'default' | 'list' | 'manual'
      unitPrice?: number
    }
)
export interface CommercialEntry {
  entryUnit: string
  entryQty: number
  conversionRate: number
  entryUnitPrice: number
}
export interface CommercialComponent {
  id?: number
  productId: number
  productCode: string
  productName: string
  unit: string
  baseQty: number
  quantity?: number
  amount?: number
  allocatedAmount?: number
  articleNumber?: string | null
  spec?: string | null
  color?: string | null
}
export interface CommercialDispatchFact {
  dispatchGroupId: number
  groupId: number
  taskId: number
  taskNo: string
  warehouseId: number
  taskStatus: number
  quantity: number
  active: boolean
  confirmedAt: string | null
  confirmedShipped: boolean
  outstanding: boolean
  allocated: boolean
  taskDeletedAt: string | null
}
export interface CommercialGroup {
  id: number
  lineKey: string
  kind: 'kit' | 'ordinary'
  warehouseId: number
  kitVersionId: number | null
  kitCode: string | null
  kitName: string | null
  originalQty: number
  targetQty: number
  quantity: number
  unitPrice: number
  amount: number
  originalAmount: number
  priceSource: CommercialInput['priceSource']
  components: CommercialComponent[]
  metadata: {
    kitUnit?: string
    kitIdentity?: { spec: string; color: string; articleNumber: string }
    input: CommercialInput
    entry: CommercialEntry | null
    priceCustomerId?: number
    quote?: {
      referenceUnitPrice: number
      resolvedPriceSource: string
      resolvedPriceLevel: string
      priceListId: number | null
    } | null
  }
  entry?: CommercialEntry | null
  dispatch?: {
    confirmedShippedQty: number
    outstandingQty: number
    activeAllocatedQty: number
    availableQty: number
    facts: CommercialDispatchFact[]
  }
}
export interface CommercialBody {
  commercialModel: 'kit-v1'
  expectedRevision?: number
  customerId: number
  customerName?: string
  warehouseId: number
  warehouseName?: string
  commercialGroups: CommercialInput[]
  discountAmount?: number
  remark?: string
  shippingProduct?: string | null
  carrierId?: number | null
  freightType?: number | null
  receiverName?: string
  receiverPhone?: string
  receiverAddress?: string
}
export interface CommercialPreview {
  customerId: number
  warehouseId: number
  commercialGroups: CommercialGroup[]
  physicalItems: (SaleOrderItem & {
    warehouseId: number
    inventory: { quantity: number; reserved: number; available: number; required: number; shortage: number }
  })[]
  amount: number
  canFulfillEntireVector: boolean
  expected: null
  readyDate: null
  readyDateExplanation: string
  inventoryExplanation: string
}
export type CommercialAction = 'create' | 'update' | 'adjust' | 'ship' | 'cancel' | 'reserve' | 'release' | 'delete'
export interface CommercialMarker {
  commercialModel: 'kit-v1'
  expectedRevision: number
}
export type CommercialOperation =
  | { action: 'create'; id?: number; body: CreateSaleParams | CommercialBody }
  | { action: 'update' | 'adjust'; id?: number; body: CommercialBody }
  | {
      action: Exclude<CommercialAction, 'create' | 'update' | 'adjust'>
      id: number
      body: CommercialMarker & { groups?: { groupId: number; qty: number }[]; confirmCreditOverride?: boolean }
    }
/** Mounted request plan; third batch can persist/query this exact original identity. */
export interface CommercialOperationPlan {
  operation: CommercialOperation
  requestKey: string
  baseURL: string
  userId: number
  sessionGeneration: number
  uncertain: boolean
  queryHint: { action: string; resourceType: 'sale_order'; resourceId?: number }
}
export type CommercialWriteResult = { id?: number; orderNo?: string; pending?: boolean } | null
export interface CommercialWriteConfirmation {
  confirmed: true
  result: CommercialWriteResult
  queryOnly?: boolean
  plan: Omit<CommercialOperationPlan, 'operation'> & { operation: Pick<CommercialOperation, 'action' | 'id'> }
}
export type CommercialSaleOrder = SaleOrder & {
  commercialModel: 'kit-v1'
  commercialRevision: number
  commercialGroups: CommercialGroup[]
}
export type CommercialPrintItem = PrintItem

export interface CommercialDeliveryGroup {
  groupId: number
  lineKey: string
  kind: 'kit' | 'ordinary'
  remainingQty: number
  readyDate: string | null
  readyDateExplanation: string
  components: {
    saleItemId: number
    requiredQty: number
    physical: number
    shortage: number
    allDate: string | null
    sources: { orderId: number | null; orderNo: string; quantity: number; date: string | null }[]
  }[]
}
