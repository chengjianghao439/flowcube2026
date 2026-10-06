import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { usePermission } from '@/hooks/usePermission'
import { PERMISSIONS } from '@/lib/permission-codes'
import type { RepeatSaleCreate, RepeatSaleAck } from '@/hooks/useRepeatSaleCreate'
import { MAX_WORKSPACE_TABS, useWorkspaceStore } from '@/store/workspaceStore'
import { toast } from '@/lib/toast'
export function RepeatCreateRecoveryPanel({ write, onConfirmed, active }: { write: RepeatSaleCreate; onConfirmed: (a: RepeatSaleAck) => void; active: boolean }) {
  const navigate = useNavigate(), { can } = usePermission()
  function viewResult() {
    if (!active || !write.result || !write.canView(write.result) || !can(PERMISSIONS.SALE_ORDER_VIEW)) return
    const path = `/sale/${write.result.id}`, workspace = useWorkspaceStore.getState()
    if (!workspace.tabs.some(t => t.key === path) && workspace.tabs.length >= MAX_WORKSPACE_TABS) { toast.warning('工作区标签已满，请先关闭不需要的页面再查看新单'); return }
    if (workspace.addTab({ key: path, path, title: '销售详情' })) navigate(path)
  }
  return <div className="space-y-2 text-sm">
    {write.error && <p role="alert">{write.error}</p>}
    {write.pending && <>
      <p>原请求结果待确认；不能修改输入或另发保存。重挂后仅保留查询身份，不保存完整表单。超7天或缺原载荷只能查询／人工核对。</p>
      <Button variant="outline" disabled={!active || write.busy} onClick={() => void write.queryOriginal().then(a => { if (a && write.canApply(a)) onConfirmed(a) })}>查询原创建结果</Button>
      <Button variant="outline" disabled={!active || write.busy || !write.canRetry} onClick={() => void write.retry().then(a => { if (a && write.canApply(a)) onConfirmed(a) })}>按原请求重试</Button>
    </>}
    {write.result && <Button variant="outline" disabled={!active || !can(PERMISSIONS.SALE_ORDER_VIEW)} onClick={viewResult}>查看已创建销售单</Button>}
  </div>
}
