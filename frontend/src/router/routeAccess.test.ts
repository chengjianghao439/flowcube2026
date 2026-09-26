import { describe, expect, it } from 'vitest'
import { buildTopNavSections, resolveRoutePermission } from './routeDefinitions'
import { hasPermission, type PermissionRequirement } from '@/lib/permissions'
import { PERMISSIONS } from '@/lib/permission-codes'

/**
 * 跨期补录审批页的准入（2026-09-26 一致性审查 · 任务 7 第二期）。
 *
 * 为什么单独测这个页面：它要同时服务两类角色——不持审批权限的出纳（回查、撤回自己的申请）
 * 与审批人（批准/驳回）。前端一条路由只写得下一个权限位，若写成单个权限码，
 * 只被授予另一档的角色会被挡在菜单与路由之外：出纳撤不回自己的单，审批人则完全进不去，
 * 而审批是只能在这个页面完成的工作。所以权限位写成数组（任一即可），
 * 与后端列表接口的 requireAnyPermission 同一口径。
 *
 * 这里测的是真实链路：路由声明 → can 判定 → 顶栏菜单可见性，用 hasPermission 本身，
 * 不另写一份比较逻辑（否则测的是测试自己，不是产品行为）。
 */
const PATH = '/accounting/backfills'
const APPLY = PERMISSIONS.FINANCE_PERIOD_BACKFILL
const APPROVE = PERMISSIONS.FINANCE_PERIOD_BACKFILL_APPROVE

const canWith = (held: string[]) =>
  (perm: PermissionRequirement) => hasPermission(held, perm)

const navPathsWith = (held: string[]) =>
  buildTopNavSections(canWith(held)).flatMap(section =>
    section.kind === 'menu' ? section.children.map(child => child.path) : [section.path])

describe('跨期补录审批页准入：申请 / 审批两档权限任一即可', () => {
  it('路由声明的是「任一」两个权限码，不是单个', () => {
    expect(resolveRoutePermission(PATH)).toEqual([APPLY, APPROVE])
  })

  it('只持申请权限的出纳：进得去，菜单里也看得到', () => {
    expect(canWith([APPLY])(resolveRoutePermission(PATH)!)).toBe(true)
    expect(navPathsWith([APPLY])).toContain(PATH)
  })

  it('只持审批权限的审批人：同样进得去（否则审批在真实分权下走不通）', () => {
    expect(canWith([APPROVE])(resolveRoutePermission(PATH)!)).toBe(true)
    expect(navPathsWith([APPROVE])).toContain(PATH)
  })

  it('两档都没有：进不去，菜单里也不出现', () => {
    expect(canWith([PERMISSIONS.ACCOUNTING_VOUCHER_VIEW])(resolveRoutePermission(PATH)!)).toBe(false)
    expect(navPathsWith([PERMISSIONS.ACCOUNTING_VOUCHER_VIEW])).not.toContain(PATH)
    expect(navPathsWith([])).not.toContain(PATH)
  })

  it('超管（roleId=1）恒可进，无论权限集合', () => {
    expect(hasPermission([], resolveRoutePermission(PATH)!, 1)).toBe(true)
  })
})
