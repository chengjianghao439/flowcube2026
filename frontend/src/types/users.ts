export interface SysUser {
  id: number
  username: string
  realName: string
  roleId: number
  roleName: string
  isActive: boolean
  /** 允许自行审批：本人可审批自己提交的单据（报销/采购单/采购申请/授信放行/审批流），仅超管可设置 */
  allowSelfApprove: boolean
  departmentId: number | null
  departmentName: string | null
  createdAt: string
}

export interface CreateUserParams {
  username: string
  password: string
  realName: string
  roleId: number
  departmentId?: number | null
}

export interface UpdateUserParams {
  realName: string
  /** 省略 = 保持原角色（编辑超管账号时不传，后端 schema 只放行 2-5） */
  roleId?: number
  isActive: boolean
  /** 省略 = 保持原部门；null = 清空部门 */
  departmentId?: number | null
  /** 省略 = 保持原值。提权类字段，后端只允许超管设置 */
  allowSelfApprove?: boolean
}
