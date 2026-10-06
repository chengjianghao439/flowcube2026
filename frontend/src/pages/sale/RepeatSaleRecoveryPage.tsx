import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { MAX_WORKSPACE_TABS, useWorkspaceStore } from '@/store/workspaceStore'
import { useActiveWorkspaceTab } from '@/hooks/useActiveWorkspaceTab'
import { ownRepeatSaleQueries, useOwnRepeatSaleQueries, useRepeatSaleCreate, type QueryRecord } from '@/hooks/useRepeatSaleCreate'
import { captureReorderOwner, reorderEpoch } from '@/lib/saleReorder'
import { toast } from '@/lib/toast'
import { RepeatCreateRecoveryPanel } from './RepeatCreateRecoveryPanel'

const path = '/sale/create-recovery'
const recordKey = (record: QueryRecord) => JSON.stringify([record.scope, record.requestKey])

/** 仅本人当前服务器有未决记录时提供核对入口，不加入常驻业务菜单。 */
export function RepeatSaleRecoveryEntry() {
  const { records, error } = useOwnRepeatSaleQueries(), navigate = useNavigate()
  if (!records.length && !error) return null
  function open() {
    const pending = ownRepeatSaleQueries()
    if (!pending.records.length && !pending.error) return
    const workspace = useWorkspaceStore.getState(), existing = workspace.tabs.find(tab => tab.key === path)
    if (!existing && workspace.tabs.length >= MAX_WORKSPACE_TABS) { toast.warning('工作区标签已满，请先关闭不需要的页面再核对原结果'); return }
    if (workspace.addTab({ key: path, path, title: '开单结果核对' })) navigate(path)
  }
  return <Button variant="outline" size="sm" onClick={open}>开单结果核对</Button>
}

function RecoveryItem({ record }: { record: QueryRecord }) {
  const [owner] = useState(captureReorderOwner), active = useActiveWorkspaceTab()
  const write = useRepeatSaleCreate(record.sourceId, record.model, owner, record.scope, record.requestKey)
  return <section className="rounded border p-4 space-y-2">
    <h2 className="font-medium">{record.model === 'kit-v1' ? '套销售' : '销售'}来源 #{record.sourceId} 的创建结果</h2>
    <RepeatCreateRecoveryPanel write={write} active={active} onConfirmed={() => {}} />
  </section>
}

function RecoveryRecords({ records }: { records: QueryRecord[] }) {
  // 保留本上下文刚核对成功的结果入口；切账号/服务器/权限代次由父key卸载。
  const [known, setKnown] = useState(records)
  useEffect(() => { setKnown(previous => { const additions = records.filter(record => !previous.some(old => recordKey(old) === recordKey(record))); return additions.length ? [...previous, ...additions] : previous }) }, [records])
  return known.length ? <div className="space-y-3">{known.map(record => <RecoveryItem key={recordKey(record)} record={record} />)}</div> : <p>当前账号和服务器没有待确认的重复开单请求。</p>
}

/** 已登录的本人查询落点；不挂来源读取、选品或新建表单，也不自动POST。 */
export default function RepeatSaleRecoveryPage() {
  const { records, error } = useOwnRepeatSaleQueries()
  return <div className="space-y-4">
    <h1 className="text-xl font-semibold">开单结果核对</h1>
    <p className="text-sm text-muted-foreground">这里只核对当前账号在原服务器发出的创建请求。重开页面没有原完整表单，不能再次提交；查询失败或未找到结果时请继续核对，勿另发保存。</p>
    {error ? <p role="alert">{error}</p> : <RecoveryRecords key={reorderEpoch()} records={records} />}
  </div>
}
