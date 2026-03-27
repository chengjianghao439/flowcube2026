/**
 * dirtyGuardStore — 全系统未保存变更保护（Dirty Form Guard）状态中心
 *
 * 职责：
 * - 维护 tabPath → isDirty 映射表
 * - 驱动全局确认弹窗（DirtyGuardDialog）的显示/隐藏
 * - 提供 bypassNextBlock 标志，防止 Layer1（UI 层）已确认后 Layer2（useBlocker）再次弹窗
 *
 * 不使用 persist：刷新后脏状态自动清零（由页面组件重新注册）
 */

import { create } from 'zustand'
import { IS_ELECTRON_DESKTOP } from '@/lib/platform'

interface PendingConfirm {
  message: string
  onConfirm: () => void
  onCancel: () => void
}

interface DirtyGuardState {
  /** tabPath → isDirty 映射 */
  dirtyTabs: Record<string, boolean>

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

  /** 注册或更新某个 tab 的脏状态 */
  setDirty: (path: string, isDirty: boolean) => void

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

  setDirty: (path, isDirty) =>
    set(s => ({ dirtyTabs: { ...s.dirtyTabs, [path]: isDirty } })),

  isTabDirty: (path) => !!get().dirtyTabs[path],

  hasAnyDirtyIn: (paths) => paths.some(p => !!get().dirtyTabs[p]),

  showConfirm: (message, onConfirm, onCancel = () => {}) => {
    if (
      IS_ELECTRON_DESKTOP &&
      typeof window !== 'undefined' &&
      typeof window.flowcubeDesktop?.showMessageBox === 'function'
    ) {
      void window.flowcubeDesktop
        .showMessageBox!({
          type: 'question',
          title: '离开确认',
          message,
          buttons: ['确定离开', '继续编辑'],
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
