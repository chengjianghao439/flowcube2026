/** 开发用角色仍保留在服务端，所有前端业务界面按稳定编码隐藏。 */
export function isDevelopmentRoleCode(code: string): boolean {
  return /^(smoke|codex)_/i.test(code)
}

export function visibleRoles<T extends { code: string }>(roles: T[]): T[] {
  return roles.filter(role => !isDevelopmentRoleCode(role.code))
}
