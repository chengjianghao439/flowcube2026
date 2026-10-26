// 角色权限：与 Flow 后端 constants/permissions.js 及各 routes 的 requirePermission 一一对齐（2026-10-26 源码核对）。
// 原则：Agent 的权限 = 发起人权限（后端仍会再验一次，Agent 侧先验是为了明确拒绝、零无谓调用）。
export const PERM_LABELS = {
  'dashboard.view': '经营看板查看',
  'inventory.view': '库存查看',
  'report.view': '报表查看',
  'product.view': '商品查看',
  'customer.view': '客户查看',
  'price.list.view': '价格表查看',
  'sale.order.view': '销售单查看',
  'sale.order.create': '销售单新建',
  'sale.order.reserve': '销售单占库',
  'purchase.order.create': '采购单新建',
  'purchase.order.view': '采购单查看',
  'payment.view': '收付款查看',
  'payment.execute': '收付款执行',
  'finance.account.view': '资金账户查看',
  'warehouse.view': '仓库查看',
  'warehouse.task.view': '仓储作业查看',
};

export class PermissionDeniedError extends Error {
  constructor(code, toolDesc) {
    super(`缺少权限 ${code}`);
    this.name = 'PermissionDeniedError';
    this.code = code;
    this.toolDesc = toolDesc;
  }
}

// actor: { username, realName, roleId, roleName, permissions: string[], warehouseIds: number[]|null, isSuper }
export function hasPerm(actor, code) {
  if (!code) return true;
  if (!actor) return false;
  if (actor.isSuper) return true; // 与后端一致：超管角色恒真
  return Array.isArray(actor.permissions) && actor.permissions.includes(code);
}

export function permLabel(code) {
  return PERM_LABELS[code] || code;
}

export function denialReply(actor, err) {
  const role = actor?.roleName ? `「${actor.roleName}」` : '';
  return `你当前的角色${role}没有「${permLabel(err.code)}」权限（${err.code}），这一步我不能替你做。如需办理，请找管理员给你的角色加上这个权限，或换有权限的账号。`;
}
