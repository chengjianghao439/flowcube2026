/**
 * WarehouseStructurePage — 仓库结构外壳（仓库 / 库位 / 货架 / 分拣格 四合一）
 *
 * 四条路由（/warehouses、/locations、/racks、/sorting-bins）都渲染本组件，
 * 每路由是独立工作区标签（tabIdentity: pathname），由 KeepAliveOutlet 注入各自的
 * TabPathContext。激活 tab 必须读 TabPathContext（本标签自己的路径）而非 useLocation
 * （全局路径）——否则隐藏标签在全局切走时会被重渲染成别的子页（keepAlive 串扰）。
 * 点 tab = addTab + navigate 到对应路由，打开/激活对应工作区标签。
 * 页头视图导航与 MergedPage 共用，各子页保留自己的标题和操作。
 */

import { useContext } from 'react'
import { usePermission } from '@/hooks/usePermission'
import { PERMISSIONS } from '@/lib/permission-codes'
import type { PermissionRequirement } from '@/lib/permissions'
import { useWorkspaceStore } from '@/store/workspaceStore'
import { PATH_TITLES } from '@/router/routeRegistry'
import { TabPathContext } from '@/components/layout/TabPathContext'
import { PageHeaderContext } from '@/components/shared/PageHeaderContext'
import { PageViewNavigation } from '@/components/shared/PageViewNavigation'
import WarehousesPage from '@/pages/warehouses'
import LocationsPage from '@/pages/locations'
import RacksPage from '@/pages/racks'
import SortingBinsPage from '@/pages/sorting-bins'

type TabKey = 'warehouses' | 'locations' | 'racks' | 'sorting-bins'

const TAB_KEYS: TabKey[] = ['warehouses', 'locations', 'racks', 'sorting-bins']

const PATH_TO_KEY: Record<string, TabKey> = {
  '/warehouses': 'warehouses',
  '/locations': 'locations',
  '/racks': 'racks',
  '/sorting-bins': 'sorting-bins',
}

const KEY_TO_PATH: Record<TabKey, string> = {
  warehouses: '/warehouses',
  locations: '/locations',
  racks: '/racks',
  'sorting-bins': '/sorting-bins',
}

const LABEL: Record<TabKey, string> = {
  warehouses: '仓库',
  locations: '库位',
  racks: '货架',
  'sorting-bins': '分拣格',
}

const TAB_PERM: Record<TabKey, PermissionRequirement> = {
  warehouses: PERMISSIONS.WAREHOUSE_VIEW,
  locations: PERMISSIONS.LOCATION_VIEW,
  racks: PERMISSIONS.RACK_VIEW,
  'sorting-bins': [PERMISSIONS.SORTING_BIN_VIEW, PERMISSIONS.WAREHOUSE_TASK_ASSIGN],
}

export default function WarehouseStructurePage() {
  const tabPath = useContext(TabPathContext)
  // TabPathContext 是本标签自己的路径；兜底退化为空时默认仓库页
  const ownPath = (tabPath || '').split(/[?#]/)[0]
  const activeKey = PATH_TO_KEY[ownPath] ?? 'warehouses'

  const { can } = usePermission()
  const addTab = useWorkspaceStore((s) => s.addTab)

  const visibleTabs = TAB_KEYS.filter((key) => can(TAB_PERM[key]))

  const navigation = visibleTabs.length > 1 && (
    <PageViewNavigation label="仓库结构视图" activePath={KEY_TO_PATH[activeKey]}
      views={visibleTabs.map(key => ({ path: KEY_TO_PATH[key], label: LABEL[key] }))}
      onSelect={path => addTab({ key: path, title: PATH_TITLES[path] ?? path, path })}
    />
  )

  return (
    <PageHeaderContext.Provider value={{ navigation }}>
      {/* 条件渲染只挂本标签匹配的子页；隐藏标签不执行其他子页的 query */}
      {activeKey === 'warehouses' && <WarehousesPage />}
      {activeKey === 'locations' && <LocationsPage />}
      {activeKey === 'racks' && <RacksPage />}
      {activeKey === 'sorting-bins' && <SortingBinsPage />}
    </PageHeaderContext.Provider>
  )
}
