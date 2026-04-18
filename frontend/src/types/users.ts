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
  roleId: number
  isActive: boolean
}
