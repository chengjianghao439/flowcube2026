export interface Department {
  id: number
  name: string
  parentId: number
  managerId: number | null
  managerName: string | null
  managerIsActive: boolean | null
  managerIsDevelopment: boolean
  sortOrder: number
  remark: string | null
  memberCount: number
  approvalFlowCount: number
  createdAt: string
}
