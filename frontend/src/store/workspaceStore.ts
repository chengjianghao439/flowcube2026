import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { buildWorkspaceTabRegistrationFromPath } from '@/router/workspaceRouteMeta'

export interface WorkspaceTab {
  key: string        // 唯一标识，对列表页即路径本身
  title: string
  path: string
  closable: boolean
}

/** 路径 → 标签标题映射表 */
export const PATH_TITLES: Record<string, string> = {
  '/dashboard':       '仪表盘',
  '/sale':            '销售管理',
  '/sale/new':        '新建销售单',
  '/purchase':        '采购订单',
  '/purchase/new':    '新建采购单',
  '/products':        '商品管理',
  '/categories':      '商品分类',
  '/warehouses':      '仓库管理',
  '/inventory':          '库存管理',
  '/inventory/overview': '库存总览',
  '/stockcheck':      '库存盘点',
  '/transfer':        '库存调拨',
  '/warehouse-tasks': '仓库任务',
  '/inbound-tasks':   '收货订单',
  '/inbound-tasks/new': '新建收货订单',
  '/picking-waves':   '波次拣货',
  '/sorting-bins':    '分拣格管理',
  '/wave-scan':       '波次扫码',
  '/locations':       '库位管理',
  '/racks':           '货架管理',
  '/customers':       '客户管理',
  '/suppliers':       '供应商管理',
  '/carriers':        '承运商管理',
  '/returns':         '退货管理',
  '/payments':        '应付/应收',
  '/users':           '用户管理',
  '/permissions':     '权限管理',
  '/settings':        '系统设置',
  '/settings/barcode-print-query': '条码打印查询',
  '/oplogs':          '操作日志',
  '/reports':                 '报表中心',
  '/reports/role-workbench':   '岗位工作台',
  '/reports/exception-workbench': '异常工作台',
  '/reports/reconciliation':   '对账基础版',
  '/reports/profit-analysis':  '利润 / 库存分析',
  '/reports/approvals':        '审批与提醒',
  '/reports/wave-performance': '波次效率报表',
  '/reports/pda-anomaly':      'PDA 异常分析',
  '/reports/warehouse-ops':    '仓库运营看板',
  '/price-lists':          '价格管理',
  '/settings/print-templates': '打印模板',
  '/settings/printers':         '打印机管理',
}

export const HOME_TAB: WorkspaceTab = {
  key: '/dashboard',
  title: '仪表盘',
  path: '/dashboard',
  closable: false,
}

interface WorkspaceState {
  tabs: WorkspaceTab[]
  activeKey: string
  /** 添加标签，若已存在则激活并返回 true */
  addTab: (tab: Omit<WorkspaceTab, 'closable'>) => boolean
  /** 关闭标签，返回关闭后应激活的 key */
  removeTab: (key: string, currentActiveKey?: string) => string
  setActive: (key: string) => void
  closeOthers: (key: string) => void
  closeAll: () => void
  syncFromLocation: (path: string, title?: string) => void
}

function sanitizeTabs(rawTabs: unknown): WorkspaceTab[] {
  const tabs = Array.isArray(rawTabs) ? rawTabs as Partial<WorkspaceTab>[] : []
  const deduped = new Map<string, WorkspaceTab>()
  deduped.set(HOME_TAB.key, HOME_TAB)
  for (const tab of tabs) {
    const rawPath = typeof tab.path === 'string' && tab.path ? tab.path : (typeof tab.key === 'string' ? tab.key : '')
    if (!rawPath) continue
    const normalized = buildWorkspaceTabRegistrationFromPath(rawPath)
    if (normalized.key === HOME_TAB.key) continue
    deduped.set(normalized.key, {
      key: normalized.key,
      path: normalized.path,
      title: typeof tab.title === 'string' && tab.title ? tab.title : normalized.path,
      closable: true,
    })
  }
  return Array.from(deduped.values())
}

export const useWorkspaceStore = create<WorkspaceState>()(
  persist(
    (set, get) => ({
      tabs: [HOME_TAB],
      activeKey: HOME_TAB.key,

      addTab: (tab) => {
        const { tabs } = get()
        const normalized = buildWorkspaceTabRegistrationFromPath(tab.path)
        const title = tab.title
        const existing = tabs.find((t) => t.key === normalized.key)
        if (existing) {
          set({
            tabs: tabs.map((item) => (
              item.key === normalized.key
                ? { ...item, title, path: normalized.path }
                : item
            )),
            activeKey: normalized.key,
          })
          return true
        }
        set({
          tabs: [...tabs, { ...tab, key: normalized.key, path: normalized.path, title, closable: true }],
          activeKey: normalized.key,
        })
        return true
      },

      removeTab: (key, currentActiveKey) => {
        const { tabs, activeKey } = get()
        const effectiveActiveKey = currentActiveKey ?? activeKey
        if (key === HOME_TAB.key) return effectiveActiveKey
        const idx = tabs.findIndex(t => t.key === key)
        if (idx === -1) return effectiveActiveKey
        const newTabs = tabs.filter(t => t.key !== key)
        const newActive = effectiveActiveKey === key
          ? (newTabs[Math.max(0, idx - 1)]?.key ?? HOME_TAB.key)
          : effectiveActiveKey
        set({ tabs: newTabs, activeKey: newActive })
        return newActive
      },

      setActive: (key) => set({ activeKey: key }),

      closeOthers: (key) => {
        const { tabs } = get()
        set({
          tabs: tabs.filter(t => !t.closable || t.key === key),
          activeKey: key,
        })
      },

      closeAll: () => set({ tabs: [HOME_TAB], activeKey: HOME_TAB.key }),

      syncFromLocation: (path, title) => {
        const normalized = buildWorkspaceTabRegistrationFromPath(path)
        const { tabs } = get()
        const existing = tabs.find((tab) => tab.key === normalized.key)
        if (!existing) {
          set({
            tabs: [
              ...tabs,
              {
                key: normalized.key,
                path: normalized.path,
                title: title || normalized.path,
                closable: normalized.key !== HOME_TAB.key,
              },
            ],
            activeKey: normalized.key,
          })
          return
        }
        const nextTitle = title || existing.title
        set({
          tabs: tabs.map((tab) => (
            tab.key === normalized.key
              ? { ...tab, path: normalized.path, title: nextTitle }
              : tab
          )),
          activeKey: normalized.key,
        })
      },
    }),
    {
      name: 'flowcube-workspace',
      partialize: (s) => ({ tabs: s.tabs }),
      merge: (persistedState, currentState) => {
        const persisted = (persistedState as Partial<WorkspaceState> | undefined) ?? {}
        return {
          ...currentState,
          tabs: sanitizeTabs(persisted.tabs),
          activeKey: HOME_TAB.key,
        }
      },
    }
  )
)
