import { create } from 'zustand'
import { persist } from 'zustand/middleware'

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
  '/purchase':        '采购管理',
  '/purchase/new':    '新建采购单',
  '/products':        '商品管理',
  '/categories':      '商品分类',
  '/warehouses':      '仓库管理',
  '/inventory':          '库存管理',
  '/inventory/overview': '库存总览',
  '/stockcheck':      '库存盘点',
  '/transfer':        '库存调拨',
  '/warehouse-tasks': '仓库任务',
  '/inbound-tasks':   '入库任务',
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
  '/oplogs':          '操作日志',
  '/reports':                 '报表中心',
  '/reports/wave-performance': '波次效率报表',
  '/reports/pda-anomaly':      'PDA 异常分析',
  '/reports/warehouse-ops':    '仓库运营看板',
  '/price-lists':          '价格管理',
  '/settings/print-templates': '打印模板',
  '/settings/printers':         '打印机管理',
  '/settings/print-tenant':     '打印租户运营',
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
  removeTab: (key: string) => string
  setActive: (key: string) => void
  closeOthers: (key: string) => void
  closeAll: () => void
}

export const useWorkspaceStore = create<WorkspaceState>()(
  persist(
    (set, get) => ({
      tabs: [HOME_TAB],
      activeKey: HOME_TAB.key,

      addTab: (tab) => {
        const { tabs } = get()
        if (tabs.some(t => t.key === tab.key)) {
          set({ activeKey: tab.key })
          return true
        }
        set({
          tabs: [...tabs, { ...tab, closable: true }],
          activeKey: tab.key,
        })
        return true
      },

      removeTab: (key) => {
        const { tabs, activeKey } = get()
        if (key === HOME_TAB.key) return activeKey
        const idx = tabs.findIndex(t => t.key === key)
        if (idx === -1) return activeKey
        const newTabs = tabs.filter(t => t.key !== key)
        const newActive = activeKey === key
          ? (newTabs[Math.max(0, idx - 1)]?.key ?? HOME_TAB.key)
          : activeKey
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
    }),
    {
      name: 'flowcube-workspace',
      partialize: (s) => ({ tabs: s.tabs, activeKey: s.activeKey }),
    }
  )
)
