import { DISPOSE_TYPE_LABELS } from '@/types/disposal'
import { DISPOSAL_STATUS_LABEL } from './constants'
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { getConversionSnapshotApi } from '@/api/disposal-handling'
import { useActiveWorkspaceTab } from '@/hooks/useActiveWorkspaceTab'
import { useDisposalHandlingOperation } from '@/hooks/useDisposalHandlingOperation'
import { captureHandlingOwner, handlingOwnerCurrent, handlingConfig, mayHandle, handlingRevision, subscribeHandling } from '@/lib/disposalHandlingRecovery'
import { PERMISSIONS as P } from '@/lib/permission-codes'
import { createRequestKey } from '@/lib/requestKey'
import { formatDisplayDateTime } from '@/lib/dateTime'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { HandlingOperationPanel } from './HandlingOperationPanel'
import type { ConversionSnapshot } from '@/types/disposal-handling'
const itemLabels: Record<string,string> = { product_code:'历史编码', product_name:'历史名称', unit:'历史单位', quantity:'批准基本量', dispose_type:'处理方式', unit_value:'原参考单价', remark:'原行备注' }
const headLabels: Record<string,string> = { disposal_no:'原单号', warehouse_name:'原仓名称', status:'原状态', total_value:'原参考估值', remark:'原备注', operator_name:'原制单人', approved_by_name:'批准人', approved_at:'批准时间' }
export function ConversionDialog({ id, open, onClose }: { id: number; open: boolean; onClose: () => void }) {
  useSyncExternalStore(subscribeHandling, handlingRevision)
  const [owner] = useState(captureHandlingOwner), active = useActiveWorkspaceTab(), latest = useRef({ open, active, serial: 0 })
  if (latest.current.open !== open || latest.current.active !== active) latest.current.serial++
  Object.assign(latest.current, { open, active })
  const [preview, setPreview] = useState<ConversionSnapshot | null>(null), [readError, setReadError] = useState(''), [reason, setReason] = useState('')
  const [operationUuid] = useState(() => crypto.randomUUID()), [requestKey] = useState(() => createRequestKey('handling-conversion'))
  const current = useCallback(() => open && active && latest.current.open && latest.current.active && handlingOwnerCurrent(owner) && mayHandle(P.INVENTORY_DISPOSAL_VIEW, P.INVENTORY_DISPOSAL_APPROVE), [owner, open, active])
  const identity = `handling-conversion:${id}`, write = useDisposalHandlingOperation(identity, open && active, current)
  useEffect(() => {
    if (!current() || preview || readError || write.blocked) return
    const state = latest.current, serial = ++state.serial, abort = new AbortController()
    void getConversionSnapshotApi(id, { ...handlingConfig(owner), signal: abort.signal }).then(value => {
      if (!current() || serial !== latest.current.serial) return
      if (value.snapshot?.version !== 1 || Number(value.snapshot.head.id) !== id || !Array.isArray(value.snapshot.items) || !value.snapshot.items.length || !/^[a-f0-9]{64}$/.test(value.snapshotFingerprint)) throw Error('完整旧单历史资料身份不符，请人工核对')
      setPreview(value)
    }).catch(e => { if (current() && serial === latest.current.serial) setReadError(e instanceof Error ? e.message : '历史资料加载失败') })
    return () => { state.serial++; abort.abort() }
  }, [id, open, active, owner, preview, readError, write.blocked, current])
  const eligible = !!preview && Number(preview.snapshot.head.status) === 3 && preview.snapshot.items.some(row => row.dispose_type === 1 || row.dispose_type === 2) && !preview.conversion
  async function sign() {
    if (!current() || write.blocked || !preview || !eligible || !reason.trim() || Array.from(reason).length > 500) return
    const result = await write.submit({ kind: 'conversion', draftIdentity: identity, legacyId: id, operationUuid, requestKey, path: `/disposals/${id}/sign-conversion`, action: `disposal.handling.legacy.convert.${id}`, body: { operationUuid, snapshotFingerprint: preview.snapshotFingerprint, reason } })
    if (result && write.canApply(result)) onClose()
  }
  function display(key: string, v: unknown) { return v == null ? '未记录' : key === 'status' ? DISPOSAL_STATUS_LABEL[Number(v)] ?? '状态待核对' : key === 'dispose_type' ? DISPOSE_TYPE_LABELS[Number(v) as 1 | 2 | 3] ?? '方式待核对' : key.endsWith('_at') ? formatDisplayDateTime(String(v)) : String(v) }
  return <Dialog open={open && active && handlingOwnerCurrent(owner) && mayHandle(P.INVENTORY_DISPOSAL_VIEW)} onOpenChange={v => { if (!v && current()) onClose() }}><DialogContent className="max-w-6xl"><DialogHeader><DialogTitle>旧单整单签认</DialogTitle></DialogHeader><p>核对完整历史批准依据。签认只保存每行处理意图（含报废行），不执行库存、资金或沿用旧批准创建新报废执行。</p>
    {readError && <p role="alert">{readError}</p>}
    {preview && <><div className="grid grid-cols-3 gap-2">{Object.keys(headLabels).map(key => { const value = preview.snapshot.head[key]; return <p key={key}>{headLabels[key] ?? '历史记录'}：{display(key,value)}</p> })}</div><h3>原批准证据</h3><p>{Object.entries(preview.snapshot.approval).filter(([key]) => key !== 'approved_by').map(([key,value]) => `${headLabels[key] ?? '批准记录'}：${display(key,value)}`).join(' · ')}</p><div className="overflow-auto"><table><thead><tr>{Object.keys(itemLabels).map(key => <th key={key}>{itemLabels[key]}</th>)}</tr></thead><tbody>{preview.snapshot.items.map(row => <tr key={String(row.id)}>{Object.keys(itemLabels).map(key => <td key={key}>{display(key,row[key])}</td>)}</tr>)}</tbody></table></div>{preview.conversion && <p>该旧单已有整单签认，不可另建来源。</p>}</>}
    {preview && !eligible && <p role="alert">当前旧单不符合签认资格，请沿原流程或人工核对；完整历史预览保留。</p>}
    <label>签认说明<Input aria-label="签认说明" maxLength={500} value={reason} disabled={!current() || write.blocked} onChange={e => { if (current() && !write.blocked) setReason(e.target.value) }} /></label><HandlingOperationPanel write={write} /><Button disabled={!current() || write.blocked || !preview || !eligible || !reason.trim()} onClick={() => void sign()}>确认整单签认</Button><Button variant="outline" onClick={() => { if (current()) onClose() }}>关闭并保留历史资料</Button>
  </DialogContent></Dialog>
}
