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
import CreateDisposalDialog from './components/CreateDisposalDialog'
function Draft({ id, path }: { id: number; path: string }) {
  const source = useDisposalHandlingSource(id, 3), navigate = useNavigate(), [open, setOpen] = useState(true), [operationUuid] = useState(() => crypto.randomUUID()), [requestKey] = useState(() => createRequestKey('handling-scrap'))
  const identity = buildWorkspaceTabRegistrationFromPath(path).key
  const write = useDisposalHandlingOperation(identity, source.active && open, () => source.isCurrent() && mayHandle(P.INVENTORY_DISPOSAL_VIEW, P.INVENTORY_DISPOSAL_CREATE))
  function close() { if (!source.isCurrent()) return; setOpen(false) }
  return <><h1>来源报废草稿</h1><p>保留本来源输入，报废草稿重新提交原审批。</p><button onClick={() => { if (source.isCurrent()) setOpen(true) }}>继续填写草稿</button><button onClick={() => { if (source.isCurrent() && !write.blocked) { useWorkspaceStore.getState().removeTab(identity); navigate('/disposals') } }}>关闭来源草稿</button>{source.error && <p role="alert">{source.error}</p>}<CreateDisposalDialog open={open} onClose={close} handling={{ source, write, operationUuid, requestKey, identity }} /></>
}
export default function HandlingScrapPage() {
  const tab = useContext(TabPathContext), location = useLocation(), path = tab || location.pathname + location.search, id = readHandlingSourceId(path)
  if (typeof id !== 'number') return <p role="alert">处理来源参数无效，请从来源列表打开；原参数保留</p>
  return <Draft key={buildWorkspaceTabRegistrationFromPath(path).key} id={id} path={path} />
}
