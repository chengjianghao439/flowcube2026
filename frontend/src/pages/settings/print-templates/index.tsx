/**
 * 打印模板管理页
 * 路由：/settings/print-templates
 */
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { toast } from '@/lib/toast'
import { useWorkspaceStore } from '@/store/workspaceStore'
import PageHeader from '@/components/shared/PageHeader'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import DataTable from '@/components/shared/DataTable'
import type { TableColumn } from '@/types'
import { getPrintTemplateListApi, deletePrintTemplateApi } from '@/api/print-templates'
import type { PrintTemplate } from '@/types/print-template'

export default function PrintTemplatesPage() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { addTab } = useWorkspaceStore()
  const [deleteTarget, setDeleteTarget] = useState<PrintTemplate | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['print-templates'],
    queryFn: () => getPrintTemplateListApi().then(r => r.data.data ?? []),
  })

  function invalidate() { qc.invalidateQueries({ queryKey: ['print-templates'] }) }

  const deleteMut = useMutation({
    mutationFn: (id: number) => deletePrintTemplateApi(id),
    onSuccess: () => { toast.success('已删除'); invalidate() },
    onError: () => toast.error('删除失败'),
  })

  function goToNew() {
    addTab({ key: '/settings/print-templates/new', title: '新建打印模板', path: '/settings/print-templates/new' })
    navigate('/settings/print-templates/new')
  }

  function goToEdit(tpl: PrintTemplate) {
    const path = `/settings/print-templates/${tpl.id}`
    addTab({ key: path, title: `编辑模板 #${tpl.id}`, path })
    navigate(path)
  }

  const columns: TableColumn<PrintTemplate>[] = [
    { key: 'name',      title: '模板名称' },
    { key: 'typeName',  title: '类型', width: 160,
      render: (_, row) => row.typeName || String(row.type) },
    { key: 'isDefault', title: '默认', width: 80,
      render: v => v ? <Badge variant="default">默认</Badge> : <span className="text-muted-foreground">—</span> },
    { key: 'createdAt', title: '创建时间', width: 160,
      render: v => (v as string)?.slice(0, 16) },
    {
      key: 'id', title: '操作', width: 140,
      render: (_, row) => (
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={() => goToEdit(row)}>编辑</Button>
          <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setDeleteTarget(row)}>删除</Button>
        </div>
      ),
    },
  ]

  return (
    <div className="space-y-5">
      <PageHeader
        title="打印模板"
        description="管理销售单、采购单等打印模板"
        actions={<Button onClick={goToNew}>+ 新建模板</Button>}
      />

      <DataTable
        columns={columns}
        data={data ?? []}
        loading={isLoading}
        rowKey="id"
      />

      <ConfirmDialog
        open={!!deleteTarget}
        title="删除模板"
        description={`确认删除模板「${deleteTarget?.name}」？`}
        variant="destructive"
        confirmText="确认删除"
        onConfirm={() => { deleteMut.mutate(deleteTarget!.id); setDeleteTarget(null) }}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}
