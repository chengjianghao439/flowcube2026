/**
 * ConfirmActionDialog — 危险操作二次确认弹窗
 *
 * 针对以下场景的语义封装，默认使用 destructive（红色）按钮：
 *   删除数据 / 取消订单 / 作废单据 / 库存调整 / 出库操作 / 批量操作
 *
 * 使用示例：
 *   <ConfirmActionDialog
 *     open={open}
 *     title="确认删除"
 *     description="该操作不可撤销，是否继续？"
 *     confirmText="确认删除"
 *     onConfirm={handleDelete}
 *     onCancel={() => setOpen(false)}
 *   />
 *
 * 与 ConfirmDialog 的区别：
 *   - variant 默认为 'destructive'（红色确认按钮）
 *   - confirmText 默认为 '确认操作'
 *   - 专为不可逆操作场景设计
 *
 * 完全基于 ConfirmDialog，API 保持兼容。
 */

import { ConfirmDialog } from '@/components/shared/ConfirmDialog'

interface ConfirmActionDialogProps {
  open: boolean
  title: string
  description: string
  confirmText?: string
  cancelText?: string
  /** 默认 destructive（红色），也可改为 default（蓝色）用于普通操作确认 */
  variant?: 'default' | 'destructive'
  loading?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmActionDialog({
  open,
  title,
  description,
  confirmText = '确认操作',
  cancelText  = '取消',
  variant     = 'destructive',
  loading     = false,
  onConfirm,
  onCancel,
}: ConfirmActionDialogProps) {
  return (
    <ConfirmDialog
      open={open}
      title={title}
      description={description}
      confirmText={confirmText}
      cancelText={cancelText}
      variant={variant}
      loading={loading}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  )
}
