/**
 * DirtyGuardDialog — 全局唯一的"未保存变更"确认弹窗
 *
 * 由 dirtyGuardStore.pendingConfirm 驱动，无需 props。
 * 挂载在 AppLayout 中，通过 shadcn Dialog Portal 渲染到 body。
 *
 * 不应在多处挂载，整个应用只需挂载一次。
 */

import { useDirtyGuardStore } from '@/store/dirtyGuardStore'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'

export function DirtyGuardDialog() {
  const pendingConfirm = useDirtyGuardStore(s => s.pendingConfirm)
  const resolveConfirm = useDirtyGuardStore(s => s.resolveConfirm)

  return (
    <ConfirmDialog
      open={pendingConfirm !== null}
      title="离开确认"
      description={pendingConfirm?.message ?? '当前内容尚未保存，确定离开吗？'}
      confirmText="确定离开"
      cancelText="继续编辑"
      variant="destructive"
      onConfirm={() => resolveConfirm(true)}
      onCancel={() => resolveConfirm(false)}
    />
  )
}
