export interface CreditOverride {
  id: number
  overrideNo: string
  saleOrderId: number
  saleOrderNo: string
  customerId: number
  customerName: string
  creditLimit: number
  usedCredit: number
  thisAmount: number
  overAmount: number
  reason: string | null
  applicantId: number
  applicantName: string
  status: number
  statusName: string
  statusTone: string
  rejectReason: string | null
  createdAt: string
  approval?: {
    instanceId: number
    status: number
    currentStep: number
    rejectReason: string | null
    finishedAt: string | null
    tasks: Array<{
      stepOrder: number
      status: number
      approverName: string | null
      comment: string | null
      actionAt: string | null
    }>
  } | null
}

export interface CreateCreditOverrideParams {
  saleOrderId: number
  reason?: string
}

export const CREDIT_OVERRIDE_STATUS = {
  DRAFT: 1,
  PENDING: 2,
  APPROVED: 3,
  REJECTED: 4,
  CANCELLED: 5,
} as const
