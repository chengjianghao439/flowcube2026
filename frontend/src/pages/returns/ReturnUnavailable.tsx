import PageHeader from '@/components/shared/PageHeader'
import { WorkspaceListReturnButton } from '@/components/shared/WorkspaceListReturnButton'
import { PERMISSIONS } from '@/lib/permission-codes'
import { buildWorkspaceTabRegistrationFromPath } from '@/router/workspaceRouteMeta'

export function ReturnUnavailable({ type, tabPath, message }: { type: 'purchase' | 'sale'; tabPath: string; message: string }) {
  return <div className="space-y-4"><PageHeader
    title={type === 'purchase' ? '采购退货单' : '销售退货单'}
    description={<span role="alert">{message}</span>}
    actions={<WorkspaceListReturnButton listPath={`/returns/${type}`} permission={PERMISSIONS.RETURN_ORDER_VIEW} tabKey={buildWorkspaceTabRegistrationFromPath(tabPath).key} />}
  /></div>
}
