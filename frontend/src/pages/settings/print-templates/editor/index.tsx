/**
 * 打印模板编辑页
 * 路由：/settings/print-templates/new  /settings/print-templates/:id
 */
import { useContext } from 'react'
import { TabPathContext } from '@/components/layout/TabPathContext'
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">{isNew ? '新建打印模板' : `编辑打印模板 #${id}`}</h1>
          <p className="text-sm text-muted-foreground mt-1">配置打印模板内容与格式</p>
        </div>
        <button
          onClick={closeTab}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          关闭
        </button>
      </div>
      <div className="rounded-lg border bg-card p-8 text-center text-muted-foreground">
        打印模板编辑器功能开发中...
      </div>
    </div>
  )
}
