/** 审批流节点审批人类型 */
export const APPROVER_TYPE = {
  ROLE: 1,
  DEPT_MANAGER: 2,
  USER: 3,
} as const

export type ApproverType = (typeof APPROVER_TYPE)[keyof typeof APPROVER_TYPE]

export interface ApprovalFlowStep {
  id?: number
  stepOrder: number
  approverType: ApproverType
  approverTypeName?: string
  roleId?: number | null
  departmentId?: number | null
  userId?: number | null
}

export interface ApprovalFlow {
  id: number
  bizType: string
  name: string
  minAmount: number
  maxAmount: number | null
  isActive: boolean
  remark: string | null
  createdAt: string
  stepCount: number
  steps?: ApprovalFlowStep[]
}

export interface ApprovalInstanceTask {
  stepOrder: number
  status: number
  approverName: string | null
  comment: string | null
  actionAt: string | null
}

/** 某业务单据的审批实例（含进度历史） */
export interface ApprovalInstance {
  instanceId: number
  flowId: number
  status: number
  applicantId: number
  applicantName: string
  amount: number
  currentStep: number
  rejectReason: string | null
  finishedAt: string | null
  createdAt: string
  tasks: ApprovalInstanceTask[]
}

/** 待我审批列表项（跨业务类型聚合） */
export interface PendingApproval {
  instanceId: number
  taskId: number
  bizType: string
  bizId: number
  no: string
  title: string | null
  status: number | null
  applicantId: number
  applicantName: string
  amount: number
  currentStep: number
  flowId: number
  createdAt: string
}

export const INSTANCE_STATUS = {
  PENDING: 1,
  APPROVED: 2,
  REJECTED: 3,
  CANCELLED: 4,
} as const
