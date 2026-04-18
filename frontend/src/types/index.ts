// ─── 通用接口响应结构 ───────────────────────────────────────────────────────────

export interface ApiResponse<T = unknown> {
  success: boolean
  message: string
  data: T
}

export interface PaginatedData<T> {
  list: T[]
  pagination: Pagination
}

export interface Pagination {
  page: number
  pageSize: number
  total: number
}

// ─── 用户与权限 ─────────────────────────────────────────────────────────────────

export interface User {
  id: number
  username: string
  realName: string
  roleId: number
  roleName: string
  avatar?: string
  permissions?: string[]
}

export interface TokenPayload {
  userId: number
  roleId: number
  iat: number
  exp: number
}

export interface Permission {
  code: string
  name: string
  module: string
}

// ─── 通用表格列定义 ─────────────────────────────────────────────────────────────

export interface TableColumn<T extends object> {
  key: keyof T | string
  title: string
  width?: number | string
  render?: (value: unknown, record: T) => React.ReactNode
}

// ─── 通用查询参数 ───────────────────────────────────────────────────────────────

export interface QueryParams {
  page?: number
  pageSize?: number
  keyword?: string
  [key: string]: unknown
}
