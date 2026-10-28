import PageHeader from '@/components/shared/PageHeader'
import { Button } from '@/components/ui/button'
import { useContext, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { TabPathContext } from '@/components/layout/TabPathContext'
import { useDisposalHandlingSource } from '@/hooks/useDisposalHandlingSource'
import { useDisposalHandlingOperation } from '@/hooks/useDisposalHandlingOperation'
import { buildWorkspaceTabRegistrationFromPath } from '@/router/workspaceRouteMeta'
import { readHandlingSourceId, mayHandle } from '@/lib/disposalHandlingRecovery'
import { PERMISSIONS as P } from '@/lib/permission-codes'
import { createRequestKey } from '@/lib/requestKey'
import { useWorkspaceStore } from '@/store/workspaceStore'
import { WorkspaceListReturnButton } from '@/components/shared/WorkspaceListReturnButton'
import CreateDisposalDialog from './components/CreateDisposalDialog'
function Draft({ id, path }: { id: number; path: string }) {
  const source = useDisposalHandlingSource(id, 3), navigate = useNavigate(), [open, setOpen] = useState(true), [operationUuid] = useState(() => crypto.randomUUID()), [requestKey] = useState(() => createRequestKey('handling-scrap'))
  const identity = buildWorkspaceTabRegistrationFromPath(path).key
  const write = useDisposalHandlingOperation(identity, source.active && open, () => source.isCurrent() && mayHandle(P.INVENTORY_DISPOSAL_VIEW, P.INVENTORY_DISPOSAL_CREATE))
  function close() { if (!source.isCurrent()) return; setOpen(false) }
  return <div className="space-y-4"><PageHeader title="来源报废草稿"
        description="保留本来源输入，报废草稿重新提交原审批。"  />

      <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => { if (source.isCurrent()) setOpen(true) }}>继续填写草稿</Button><Button variant="outline" onClick={() => { if (source.isCurrent() && !write.blocked) { useWorkspaceStore.getState().removeTab(identity); navigate('/disposals') } }}>关闭来源草稿</Button></div>{source.error && <p role="alert">{source.error}</p>}<CreateDisposalDialog open={open} onClose={close} handling={{ source, write, operationUuid, requestKey, identity }} /></div>
}
export default function HandlingScrapPage() {
  const tab = useContext(TabPathContext), location = useLocation(), path = tab || location.pathname + location.search, id = readHandlingSourceId(path)
  if (typeof id !== 'number') return <div className="space-y-4"><PageHeader
    title="来源报废草稿"
    description={<span role="alert">处理来源参数无效，请从来源列表打开；原参数保留</span>}
    actions={<WorkspaceListReturnButton listPath="/disposals" permission={P.INVENTORY_DISPOSAL_VIEW} tabKey={buildWorkspaceTabRegistrationFromPath(path).key}>返回报废处理</WorkspaceListReturnButton>}
  /></div>
  return <Draft key={buildWorkspaceTabRegistrationFromPath(path).key} id={id} path={path} />
}
