export interface Category {
  id: number
  code: string | null
  name: string
  parentId: number | null
  level: number          // 1-4
  sortOrder: number
  status: number         // 1=启用 0=停用
  path: string           // 祖先 id 链，如 "1/5/12"
  remark: string | null
  createdAt: string
  children?: Category[]  // 仅树形接口包含
}

export interface CreateCategoryParams {
  name: string
  parentId?: number | null
  sortOrder?: number
  remark?: string | null
}

export interface UpdateCategoryParams {
  name: string
  sortOrder?: number
  status?: boolean
  remark?: string | null
}
