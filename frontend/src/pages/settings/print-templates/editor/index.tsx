/**
 * 打印模板编辑页
 * 路由：/settings/print-templates/new  /settings/print-templates/:id
 */
import { useContext } from 'react'
import { TabPathContext } from '@/components/layout/TabPathContext'
import PageHeader from '@/components/shared/PageHeader'
import { Button } from '@/components/ui/button'
import { useWorkspaceStore } from '@/store/workspaceStore'

export default function PrintTemplateEditorPage() {
  const tabPath = useContext(TabPathContext)
  const isNew   = tabPath.endsWith('/new')
  const id      = isNew ? null : Number(tabPath.split('/').pop())
  const { removeTab } = useWorkspaceStore()

  function closeTab() {
    removeTab(tabPath)
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title={isNew ? '新建打印模板' : `编辑打印模板 #${id}`}
        description="打印模板编辑器入口页，保持与桌面端其他设置页一致的标题和操作区。"
        actions={<Button size="sm" variant="outline" onClick={closeTab}>关闭页面</Button>}
      />
      <div className="rounded-lg border bg-card p-8 text-center text-muted-foreground">
        打印模板编辑器功能开发中...
      </div>
    </div>
  )
}
