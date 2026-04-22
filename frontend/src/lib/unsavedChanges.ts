import { useDirtyGuardStore } from '@/store/dirtyGuardStore'

interface ConfirmDirtyLeaveOptions {
  dirtyKeys?: string[]
  isDirty?: boolean
  message?: string
  willNavigate?: boolean
  proceed: () => void
}

const DEFAULT_MESSAGE = '当前内容尚未保存，确定离开吗？'

export function confirmDirtyLeave(options: ConfirmDirtyLeaveOptions) {
  const {
    dirtyKeys = [],
    isDirty = dirtyKeys.length > 0
      ? useDirtyGuardStore.getState().hasAnyDirtyIn(dirtyKeys)
      : false,
    message = DEFAULT_MESSAGE,
    willNavigate = true,
    proceed,
  } = options

  if (!isDirty) {
    proceed()
    return
  }

  const store = useDirtyGuardStore.getState()
  store.showConfirm(message, () => {
    if (willNavigate) store.setBypassNextBlock(true)
    proceed()
  })
}
