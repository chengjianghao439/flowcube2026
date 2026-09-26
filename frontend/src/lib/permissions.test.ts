import { describe, it, expect } from 'vitest'
import { normalizePermissions, hasPermission } from './permissions'
import { PERMISSIONS, type PermissionCode } from '@/lib/permission-codes'

/**
 * 前端权限码渲染守卫单元测试（审计 4.3 起步）。
 * hasPermission 是「按钮/菜单按权限渲染」的唯一入口：
 *   1. 超管（roleId=1）恒放行
 *   2. 非超管按权限集合精确匹配
 *   3. undefined 权限集合 = 空集（未登录/异常态不放行）
 */

describe('hasPermission', () => {
  it('超管（roleId=1）恒放行，无论权限集合', () => {
    expect(hasPermission([], PERMISSIONS.USER_UPDATE, 1)).toBe(true)
    expect(hasPermission(undefined, PERMISSIONS.USER_UPDATE, 1)).toBe(true)
  })

  it('非超管按权限集合精确匹配', () => {
    const perms = ['sale.order.view', 'sale.order.create']
    expect(hasPermission(perms, 'sale.order.view' as PermissionCode)).toBe(true)
    expect(hasPermission(perms, 'sale.order.ship' as PermissionCode)).toBe(false)
  })

  it('传数组 = 任一权限即可（给「同一页面服务两类角色」用）', () => {
    const either = [PERMISSIONS.FINANCE_PERIOD_BACKFILL, PERMISSIONS.FINANCE_PERIOD_BACKFILL_APPROVE]
    // 只持其中一档就放行——这正是审批人只被授予「审批跨期补录」时的处境
    expect(hasPermission([PERMISSIONS.FINANCE_PERIOD_BACKFILL], either)).toBe(true)
    expect(hasPermission([PERMISSIONS.FINANCE_PERIOD_BACKFILL_APPROVE], either)).toBe(true)
    expect(hasPermission([...either], either)).toBe(true)
    // 一档都没有才不放行：数组是「任一」，不是「全部」
    expect(hasPermission([PERMISSIONS.ACCOUNTING_VOUCHER_VIEW], either)).toBe(false)
    expect(hasPermission([], either)).toBe(false)
    expect(hasPermission(undefined, either)).toBe(false)
  })

  it('超管对数组同样恒放行', () => {
    expect(hasPermission([], [PERMISSIONS.FINANCE_PERIOD_BACKFILL, PERMISSIONS.FINANCE_PERIOD_BACKFILL_APPROVE], 1)).toBe(true)
  })

  it('undefined 权限集合 = 空集（不放行）', () => {
    expect(hasPermission(undefined, PERMISSIONS.SALE_ORDER_VIEW)).toBe(false)
  })

  it('空数组 = 空集', () => {
    expect(hasPermission([], PERMISSIONS.SALE_ORDER_VIEW)).toBe(false)
  })

  it('模糊匹配不生效（必须是完整权限码）', () => {
    const perms = ['sale.order']
    expect(hasPermission(perms, 'sale.order.view' as PermissionCode)).toBe(false)
  })
})

describe('normalizePermissions', () => {
  it('过滤空值、去重', () => {
    const s = normalizePermissions(['a.b', '', 'a.b', 'c.d', null as unknown as string])
    expect([...s]).toEqual(['a.b', 'c.d'])
  })

  it('undefined → 空 Set', () => {
    expect(normalizePermissions(undefined).size).toBe(0)
  })
})
