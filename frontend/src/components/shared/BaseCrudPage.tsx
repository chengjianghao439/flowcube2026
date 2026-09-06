import { QueryErrorState } from '@/components/shared/QueryErrorState'
/**
 * BaseCrudPage — 基础资料 CRUD 列表页共享骨架
 *
 * 封装基础资料页（承运商/客户/供应商/仓库/库位/费用类别/塑料盒/货架/分拣格等）
 * 高度重复的「列表 + 操作列(编辑/删除) + 新增/编辑弹窗 + 删除确认」结构。
 *
 * 各页差异：
 * - 弹窗表单字段 → renderForm 插槽注入
 * - 列表数据列 → columns 注入（操作列由本组件自动追加）
 * - 行内额外操作（详情/打印/批量）→ renderRowExtra 插槽注入到操作列
 * - 列表筛选（关键词/复杂查询）→ 可选 renderToolbar 插槽
 */
import { useState, type ReactNode } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from '@/lib/toast'
import PageHeader from '@/components/shared/PageHeader'
import DataTable from '@/components/shared/DataTable'
import ListSummary from '@/components/shared/ListSummary'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import TableActionsMenu from '@/components/shared/TableActionsMenu'
import type { TableColumn } from '@/types'

interface RowLike { id: number }

interface Props<T extends RowLike> {
  /** 页面标题与描述 */
  title: string
  description?: string
  /** 列表数据列（不含操作列，操作列自动追加） */
  columns: TableColumn<T>[]
  /** 列表查询：queryKey + queryFn */
  queryKey: readonly unknown[]
  listQuery: () => Promise<{ list?: T[] } | T[]>
  /** 删除 API */
  deleteApi: (id: number) => Promise<unknown>
  /** 删除确认文案 */
  deleteMessage: string
  /** 新增/编辑弹窗表单内容 */
  renderForm: (editing: T | null, open: boolean) => ReactNode
  /** 打开弹窗时回调（新建 editing=null，编辑=行对象）。页面在此回填表单，避免在 renderForm 里用 useEffect（回调内不能调 hooks） */
  onOpen?: (editing: T | null) => void
  /** 新增/编辑提交 */
  submitForm: (editing: T | null) => Promise<unknown>
  /** 保存成功文案 */
  saveSuccessMessage?: (editing: T | null) => string
  /** 弹窗标题 */
  formTitle?: (editing: T | null) => string
  /** 弹窗宽度类名（默认 max-w-md） */
  formWidthClass?: string
  /** 行内额外操作（追加到操作列，位于删除之前） */
  renderRowExtra?: (row: T) => ReactNode
  /**
   * 完全自定义整列操作（替代默认的「编辑 + 删除」操作列）。
   * 仅当操作列结构差异很大（如塑料盒的「详情」主操作 + 条件删除、分拣格的「释放」主操作）时使用；
   * 编辑/删除确认仍由组件统一处理，通过 helpers 触发。
   */
  renderActions?: (row: T, helpers: { openEdit: (row: T) => void; openDelete: (row: T) => void }) => ReactNode
  /** 新建按钮文案 */
  createLabel?: string
  /** 保存校验 */
  canSubmit?: (editing: T | null) => boolean
  /** PageHeader 额外动作（查询/导出等，置于新建按钮之前） */
  headerActions?: ReactNode
  /** 列表筛选工具栏（可选，放在表格上方） */
  renderToolbar?: ReactNode
  /** 列表空态文案 */
  emptyText?: string
  /** 是否显示操作列（默认 true） */
  showActions?: boolean
  /** 记录总数单位 */
  recordUnit?: string
}

export default function BaseCrudPage<T extends RowLike>(props: Props<T>) {
  const {
    title, description, columns: dataColumns, queryKey, listQuery, deleteApi, deleteMessage,
    renderForm, submitForm, saveSuccessMessage, formTitle, formWidthClass = 'max-w-md',
    renderRowExtra, renderActions, createLabel = '+ 新建', canSubmit, headerActions, renderToolbar,
    emptyText, showActions = true, recordUnit,
  } = props

  const qc = useQueryClient()
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<T | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<T | null>(null)

  const { data, isLoading, isError, error, refetch } = useQuery({ queryKey, queryFn: listQuery })
  const invalidate = () => qc.invalidateQueries({ queryKey: [queryKey[0]] })

  const saveMut = useMutation({
    mutationFn: () => submitForm(editing),
    onSuccess: () => {
      invalidate()
      setFormOpen(false)
      toast.success(saveSuccessMessage ? saveSuccessMessage(editing) : (editing ? '已保存' : '已创建'))
    },
    onError: (e: unknown) =>
      toast.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? '保存失败'),
  })

  const deleteMut = useMutation({
    mutationFn: (id: number) => deleteApi(id),
    onSuccess: () => { invalidate(); setDeleteTarget(null); toast.success('已删除') },
    onError: (e: unknown) =>
      toast.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? '删除失败'),
  })

  function openCreate() { setEditing(null); setFormOpen(true); props.onOpen?.(null) }
  function openEdit(row: T) { setEditing(row); setFormOpen(true); props.onOpen?.(row) }
  function closeDialog() { setFormOpen(false); setEditing(null) }

  const list = Array.isArray(data) ? data : (data as { list?: T[] })?.list ?? []

  const columns: TableColumn<T>[] = showActions
    ? [
        ...dataColumns,
        {
          key: 'id', title: '操作', width: 140,
          render: (_, row) => renderActions
            ? renderActions(row, { openEdit, openDelete: (r) => setDeleteTarget(r) })
            : (
              <div className="flex items-center gap-1">
                {renderRowExtra ? renderRowExtra(row) : null}
                <TableActionsMenu
                  primaryLabel="编辑"
                  primaryVariant="outline"
                  onPrimaryClick={() => openEdit(row)}
                  items={[
                    { label: '删除', destructive: true, onClick: () => setDeleteTarget(row) },
                  ]}
                />
              </div>
            ),
        },
      ]
    : dataColumns

  return (
    <div className="space-y-4">
      <PageHeader
        title={title}
        description={description}
        actions={
          <>
            {headerActions}
            <Button onClick={openCreate}>{createLabel}</Button>
          </>
        }
      />

      {renderToolbar}

      {isError ? <QueryErrorState error={error} onRetry={() => void refetch()} title={`${title}加载失败`} compact /> : <DataTable columns={columns} data={list} loading={isLoading} rowKey="id" emptyText={emptyText} />}
      <ListSummary total={(data as { pagination?: { total?: number } } | undefined)?.pagination?.total ?? list.length} unit={recordUnit} />

      <Dialog open={formOpen} onOpenChange={v => !v && closeDialog()}>
        <DialogContent className={formWidthClass}>
          <DialogHeader>
            <DialogTitle>{formTitle ? formTitle(editing) : (editing ? `编辑${title.replace(/管理$/, '')}` : `新建${title.replace(/管理$/, '')}`)}</DialogTitle>
          </DialogHeader>
          <div className="min-h-0 max-h-[65vh] space-y-4 overflow-y-auto py-2 pr-1">{renderForm(editing, formOpen)}</div>
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>取消</Button>
            <Button
              disabled={(canSubmit && !canSubmit(editing)) || saveMut.isPending}
              onClick={() => saveMut.mutate()}
            >
              {saveMut.isPending ? '保存中…' : (editing ? '保存' : '创建')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteTarget}
        title={`删除${title.replace(/管理$/, '')}`}
        description={deleteMessage}
        variant="destructive"
        confirmText="确认删除"
        onConfirm={() => deleteTarget && deleteMut.mutate(deleteTarget.id)}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}
