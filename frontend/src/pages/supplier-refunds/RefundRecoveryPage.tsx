import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useOwnRefundRecords, useSupplierRefundOperation } from '@/hooks/useSupplierRefundOperation';
import { useActiveWorkspaceTab } from '@/hooks/useActiveWorkspaceTab';
import { ownRefundRecords, refundEpoch, type RefundRecord } from '@/lib/supplierRefundRecovery';
import { MAX_WORKSPACE_TABS, useWorkspaceStore } from '@/store/workspaceStore';
import { RefundRecoveryPanel } from './RecoveryPanel';
const path = '/supplier-refunds/recovery';
export function RefundRecoveryEntry() { const state = useOwnRefundRecords(), navigate = useNavigate(); if (!state.records.length && !state.error)
    return null; function open() { const own = ownRefundRecords(); if (!own.records.length && !own.error)
    return; const store = useWorkspaceStore.getState(); if (!store.tabs.some(t => t.key === path) && store.tabs.length >= MAX_WORKSPACE_TABS)
    return; if (store.addTab({ key: path, path, title: '退款结果核对' }))
    navigate(path); } return <Button variant="outline" onClick={open}>退款结果核对</Button>; }
function Item({ record }: {
    record: RefundRecord;
}) { const active = useActiveWorkspaceTab(), write = useSupplierRefundOperation(record.draftIdentity, active, () => false); return <section><h2>{record.kind === 'create' ? '退款草稿' : `退款单 ${record.refundId}`}原请求</h2><RefundRecoveryPanel write={write}/>{write.result && <p>已核对本人原结果 {write.result.refundNo}，请按当前查看权限在业务列表核对详情。</p>}</section>; }
function Records() { const own = useOwnRefundRecords(), [known, setKnown] = useState(own.records.filter(r => r.kind !== 'backfill')); useEffect(() => setKnown(old => { const added = own.records.filter(r => r.kind !== 'backfill' && !old.some(x => x.draftIdentity === r.draftIdentity)); return added.length ? [...old, ...added] : old; }), [own.records]); return <>{own.error ? <p role="alert">{own.error}</p> : known.length ? known.map(r => <Item key={r.draftIdentity} record={r}/>) : <p>当前账号与服务器没有待核对退款请求。</p>}</>; }
/** Auth-only own receipt recovery: no source, details, accounts, price or writing form. */
export default function RefundRecoveryPage() { useOwnRefundRecords(); return <div className="space-y-4"><h1>退款结果核对</h1><p>保留原请求、金额与真实日期，主动查询本人在原服务器发出的退款或补录结果。查看与写入权限撤回后仍可核原结果，不自动重发。</p><Records key={refundEpoch()}/></div>; }
