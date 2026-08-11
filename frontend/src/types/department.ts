export interface Department {
  id: number
  name: string
  parentId: number
  managerId: number | null
  managerName: string | null
  sortOrder: number
  remark: string | null
  memberCount: number
  createdAt: string
}
