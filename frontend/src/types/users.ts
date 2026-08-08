export interface SysUser {
  id: number
  username: string
  realName: string
  roleId: number
  roleName: string
  isActive: boolean
  createdAt: string
}

export interface CreateUserParams {
  username: string
  password: string
  realName: string
  roleId: number
}

export interface UpdateUserParams {
  realName: string
  /** 省略 = 保持原角色（编辑超管账号时不传，后端 schema 只放行 2-5） */
  roleId?: number
  isActive: boolean
}
