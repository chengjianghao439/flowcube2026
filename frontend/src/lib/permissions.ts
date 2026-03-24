/**
 * 前端权限配置
 * role_id=1 (admin) 拥有全部权限，直接放行
 * 其他角色根据此表控制可见菜单和操作按钮
 */

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export type PermCode =
  | 'page:dashboard' | 'page:users' | 'page:warehouses' | 'page:suppliers'
  | 'page:products' | 'page:categories' | 'page:inventory' | 'page:customers' | 'page:purchase'
  | 'page:sale' | 'page:stockcheck' | 'page:reports' | 'page:settings'
  | 'page:transfer' | 'page:returns' | 'page:payments' | 'page:warehouse-tasks'
  | 'action:purchase:confirm' | 'action:purchase:receive' | 'action:purchase:cancel'
  | 'action:sale:confirm' | 'action:sale:ship' | 'action:sale:cancel'
  | 'action:inventory:inbound' | 'action:inventory:outbound' | 'action:inventory:adjust'
  | 'action:stockcheck:create' | 'action:stockcheck:submit'
  | 'action:import' | 'action:export'

const ALL: PermCode[] = [
  'page:dashboard','page:users','page:warehouses','page:suppliers','page:products','page:categories',
  'page:inventory','page:customers','page:purchase','page:sale','page:stockcheck',
  'page:transfer','page:returns','page:payments','page:warehouse-tasks','page:reports','page:settings',
  'action:purchase:confirm','action:purchase:receive','action:purchase:cancel',
  'action:sale:confirm','action:sale:ship','action:sale:cancel',
  'action:inventory:inbound','action:inventory:outbound','action:inventory:adjust',
  'action:stockcheck:create','action:stockcheck:submit',
  'action:import','action:export',
]

const ROLE_PERMS: Record<number, PermCode[]> = {
  1: ALL,
  2: [ // 仓库管理员
    'page:dashboard','page:warehouses','page:products','page:categories','page:inventory','page:stockcheck','page:warehouse-tasks','page:reports','action:export',
    'action:inventory:inbound','action:inventory:outbound','action:inventory:adjust',
    'action:stockcheck:create','action:stockcheck:submit',
  ],
  3: [ // 采购员
    'page:dashboard','page:suppliers','page:products','page:categories','page:inventory','page:purchase','page:reports','action:export','action:import',
    'action:purchase:confirm','action:purchase:receive','action:purchase:cancel',
  ],
  4: [ // 销售员
    'page:dashboard','page:customers','page:products','page:inventory','page:sale','page:warehouse-tasks','page:reports','action:export',
    'action:sale:confirm','action:sale:ship','action:sale:cancel',
  ],
  5: [ // 只读
    'page:dashboard','page:products','page:categories','page:inventory','page:purchase','page:sale',
    'page:warehouses','page:suppliers','page:customers','page:reports','action:export',
  ],
}

export function getPermissions(roleId: number): Set<PermCode> {
  return new Set(ROLE_PERMS[roleId] ?? ROLE_PERMS[5])
}

export function hasPermission(roleId: number, perm: PermCode): boolean {
  if (roleId === 1) return true
  return getPermissions(roleId).has(perm)
}
