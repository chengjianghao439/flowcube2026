import { useOwnHandlingRecords, useDisposalHandlingOperation } from '@/hooks/useDisposalHandlingOperation'
import { handlingEpoch, ownHandlingRecords } from '@/lib/disposalHandlingRecovery'
import { HandlingOperationPanel } from './HandlingOperationPanel'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useOwnDisposalRecords, useDisposalExecution } from '@/hooks/useDisposalExecution'
import { disposalEpoch, ownDisposalRecords, recordIdentity, type DisposalExecutionRecord } from '@/lib/disposalRecovery'
import { useActiveWorkspaceTab } from '@/hooks/useActiveWorkspaceTab'
import { Button } from '@/components/ui/button'
import { MAX_WORKSPACE_TABS, useWorkspaceStore } from '@/store/workspaceStore'
import { toast } from '@/lib/toast'
import { DisposalExecutionPanel } from './DisposalExecutionPanel'
const path = '/disposals/recovery'
/** 只在本人当前服务器存在未决请求时出现，无常驻主菜单。 */
export function DisposalRecoveryEntry() {
  const { records, error } = useOwnDisposalRecords(), handling = useOwnHandlingRecords(), navigate = useNavigate()
  if (!records.length && !error && !handling.records.length && !handling.error) return null
  function open() {
    const pending = ownDisposalRecords(), originalHandling = ownHandlingRecords()
    if (!pending.records.length && !pending.error && !originalHandling.records.length && !originalHandling.error) return
    const workspace = useWorkspaceStore.getState()
    if (!workspace.tabs.some(tab => tab.key === path) && workspace.tabs.length >= MAX_WORKSPACE_TABS) { toast.warning('工作区标签已满，请先关闭不需要的页面再核对原结果'); return }
    if (workspace.addTab({ key: path, path, title: '报废结果核对' })) navigate(path)
  }
  return <Button variant="outline" size="sm" onClick={open}>报废结果核对</Button>
}
function Item({ record }: { record: DisposalExecutionRecord }) {
  const active = useActiveWorkspaceTab(), write = useDisposalExecution(record.id, active)
  return <section className="rounded border p-4"><h2>处置单 #{record.id} 原报废结果</h2><DisposalExecutionPanel write={write} active={active} /></section>
}
function Records({ records }: { records: DisposalExecutionRecord[] }) {
  const [known, setKnown] = useState(records)
  useEffect(() => { setKnown(previous => {
    const added = records.filter(record => !previous.some(old => recordIdentity(old) === recordIdentity(record)))
    return added.length ? [...previous, ...added] : previous
  }) }, [records])
  return known.length ? <div className="space-y-3">{known.map(record => <Item key={recordIdentity(record)} record={record} />)}</div> : <p>当前账号和服务器没有待确认报废请求。</p>
}
function HandlingItem({ identity, kind }: { identity: string; kind: string }) {
  const active = useActiveWorkspaceTab(), write = useDisposalHandlingOperation(identity, active, () => false)
  const labels: Record<string, string> = { source: '处理意图', sale: '销售草稿', purchase_return: '采购退货', scrap: '报废草稿', release: '核对解除', conversion: '旧单签认' }
  return <section className="rounded border p-4"><h2>{labels[kind]}原结果</h2><HandlingOperationPanel write={write} />{write.result && <p>已确认原处理结果。请按现有查看权限从业务列表查看单据。</p>}</section>
}
function HandlingRecords() {
  const { records, error } = useOwnHandlingRecords()
  const [known, setKnown] = useState(records)
  useEffect(() => { setKnown(previous => { const added = records.filter(r => !previous.some(old => old.operationUuid === r.operationUuid)); return added.length ? [...previous, ...added] : previous }) }, [records])
  return <section><h2>处理意图与关联结果</h2>{error ? <p role="alert">{error}</p> : known.map(record => <HandlingItem key={record.operationUuid} identity={record.draftIdentity} kind={record.kind} />)}</section>
}
/** Auth-only，本人查询；不挂业务详情、审批、仓库、建议或执行表单。 */
export default function DisposalRecoveryPage() {
  const { records, error } = useOwnDisposalRecords()
  return <div className="space-y-4"><h1 className="text-xl font-semibold">报废结果核对</h1><p>这里只核对本人在原服务器发出的报废请求。查看或执行权限撤回后仍可查询；重试须有当前执行权限和仓库范围。</p>
    {error ? <p role="alert">{error}</p> : <Records key={disposalEpoch()} records={records} />}
    <HandlingRecords key={handlingEpoch()} />
  </div>
}
