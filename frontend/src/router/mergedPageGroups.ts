import { PERMISSIONS } from '@/lib/permission-codes'
import type { PermCode } from '@/lib/permissions'

export interface MergedPageGroup {
  key: string
  title: string
  views: { path: string; label: string; permission: PermCode }[]
}

export const MERGED_PAGE_GROUPS: MergedPageGroup[] = [
  {
    key: '/procurement', title: '采购建议',
    views: [
      { path: '/procurement', label: '采购计划', permission: PERMISSIONS.PROCUREMENT_PLAN_VIEW },
      { path: '/reports/replenishment', label: '补货建议', permission: PERMISSIONS.REPORT_VIEW },
    ],
  },
  {
    key: '/reports', title: '报表中心',
    views: [
      { path: '/reports', label: '业务统计', permission: PERMISSIONS.REPORT_VIEW },
      { path: '/reports/kpi', label: '经营概览', permission: PERMISSIONS.REPORT_VIEW },
      { path: '/reports/profit-analysis', label: '利润与库存', permission: PERMISSIONS.REPORT_VIEW },
    ],
  },
  {
    key: '/reports/warehouse-ops', title: '仓库运营',
    views: [
      { path: '/reports/warehouse-ops', label: '作业概况', permission: PERMISSIONS.REPORT_VIEW },
      { path: '/reports/wave-performance', label: '批次效率', permission: PERMISSIONS.REPORT_VIEW },
      { path: '/reports/pda-anomaly', label: 'PDA 异常', permission: PERMISSIONS.REPORT_VIEW },
    ],
  },
]

export function getMergedPageGroup(path: string): MergedPageGroup | undefined {
  const pathname = path.split(/[?#]/)[0]
  return MERGED_PAGE_GROUPS.find(group => group.views.some(view => view.path === pathname))
}
