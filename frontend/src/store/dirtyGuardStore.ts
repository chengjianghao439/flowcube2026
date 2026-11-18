/**
 * dirtyGuardStore — 全系统未保存变更保护（Dirty Form Guard）状态中心
 *
 * 职责：
 * - 按规范标签键保留每个表单的未保存登记
 * - 驱动全局确认弹窗（DirtyGuardDialog）的显示/隐藏
 * - 提供 bypassNextBlock 标志，防止 Layer1（UI 层）已确认后 Layer2（useBlocker）再次弹窗
 *
 * 不使用 persist：刷新后脏状态自动清零（由页面组件重新注册）
 */

import { create } from 'zustand'
import { isElectronRuntime } from '@/lib/platform'
import { buildWorkspaceTabRegistrationFromPath } from '@/router/workspaceRouteMeta'

interface PendingConfirm {
  message: string
  onConfirm: () => void
  onCancel: () => void
}

type DirtySource = symbol | string

const tabKeyFor = (path: string) => buildWorkspaceTabRegistrationFromPath(path).key

interface DirtyGuardState {
  /** 规范标签键 → 仍有未保存变更的表单来源。 */
  dirtyTabs: Record<string, ReadonlySet<DirtySource>>

  /**
   * 当前待用户确认的弹窗配置。
   * null = 无弹窗；非 null = DirtyGuardDialog 显示。
   */
  pendingConfirm: PendingConfirm | null

  /**
   * Layer1（WorkspaceTabs / AppLayout）已弹窗确认后设为 true。
   * 供将来升级至 Data Router 后的 useBlocker 使用；
   * 当前 popstate 方案不消费此标志，但设置它无副作用。
   */
  bypassNextBlock: boolean

  // ── Actions ──────────────────────────────────────────────────────────────

  /** 更新同一表单来源；无来源参数时按输入路径单独登记。 */
  setDirty: (path: string, isDirty: boolean, source?: DirtySource) => void

  /** 查询某个 tab 是否有未保存变更 */
  isTabDirty: (path: string) => boolean

  /** 批量查询，paths 中任意一个 dirty 即返回 true */
  hasAnyDirtyIn: (paths: string[]) => boolean

  /**
   * 触发确认弹窗。
   * onConfirm / onCancel 在用户点击后由 resolveConfirm 回调。
   */
  showConfirm: (message: string, onConfirm: () => void, onCancel?: () => void) => void

  /** 由 DirtyGuardDialog 调用：ok=true 执行 onConfirm，否则执行 onCancel */
  resolveConfirm: (ok: boolean) => void

  setBypassNextBlock: (v: boolean) => void
}

export const useDirtyGuardStore = create<DirtyGuardState>((set, get) => ({
  dirtyTabs: {},
  pendingConfirm: null,
  bypassNextBlock: false,

  setDirty: (path, isDirty, source = path) => {
    if (!path) return
    const key = tabKeyFor(path)
    set(state => {
      const registered = state.dirtyTabs[key]
      if ((registered?.has(source) ?? false) === isDirty) return state
      const next = new Set(registered)
      if (isDirty) next.add(source)
      else next.delete(source)
      const dirtyTabs = { ...state.dirtyTabs }
      if (next.size) dirtyTabs[key] = next
      else delete dirtyTabs[key]
      return { dirtyTabs }
    })
  },

  isTabDirty: (path) => Boolean(path && get().dirtyTabs[tabKeyFor(path)]),

  hasAnyDirtyIn: (paths) => paths.some(get().isTabDirty),

  showConfirm: (message, onConfirm, onCancel = () => {}) => {
    if (
      isElectronRuntime() &&
      typeof window !== 'undefined' &&
      typeof window.flowcubeDesktop?.showMessageBox === 'function'
    ) {
      void window.flowcubeDesktop
        .showMessageBox!({
          type: 'question',
          title: '离开确认',
          message,
          buttons: ['放弃本次修改', '继续编辑'],
          defaultId: 1,
          cancelId: 1,
          noLink: true,
        })
        .then(({ response }) => {
          if (response === 0) onConfirm()
          else onCancel()
        })
        .catch(() => onCancel())
      return
    }
    set({ pendingConfirm: { message, onConfirm, onCancel } })
  },

  resolveConfirm: (ok) => {
    const { pendingConfirm } = get()
    if (!pendingConfirm) return
    set({ pendingConfirm: null })
    if (ok) pendingConfirm.onConfirm()
    else pendingConfirm.onCancel()
  },

  setBypassNextBlock: (v) => set({ bypassNextBlock: v }),
}))
