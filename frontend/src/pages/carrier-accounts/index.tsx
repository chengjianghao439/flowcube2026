import { useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import PageHeader from '@/components/shared/PageHeader'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { getCarriersApi, getCarrierAccountBindingApi, saveCarrierAccountBindingApi, createCarrierAccountApi, deleteCarrierApi } from '@/api/carriers'
import { collectAllRecords } from '@/api/allRecords'
import { usePermission } from '@/hooks/usePermission'
import { PERMISSIONS } from '@/lib/permission-codes'
import { createRequestKey } from '@/lib/requestKey'
import { toast } from '@/lib/toast'
import type { SaveCarrierAccountBinding, PauseCarrierAccountBinding, NewCarrierAccount } from '@/types/carriers'
import { AccountBindingForm } from './AccountBindingForm'
import { NewAccountForm } from './NewAccountForm'

export default function CarrierAccountsPage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [carrierId, setCarrierId] = useState(params.get('carrierId') || '')
  const [chosenPlatform, setPlatform] = useState<'' | 'sf' | 'deppon'>('')
  const [keyword, setKeyword] = useState('')
  const [creating, setCreating] = useState(false)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [nextSelection, setNextSelection] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState('')
  const createAttempt = useRef({ signature: '', key: '' })
  const busy = useRef(false)
  const { can } = usePermission()
  const canCreate = can(PERMISSIONS.CARRIER_CREATE)
  const canEdit = can(PERMISSIONS.CARRIER_UPDATE)
  const canDelete = can(PERMISSIONS.CARRIER_DELETE)
  const client = useQueryClient()
  const carriers = useQuery({ queryKey: ['carriers', 'account-binding'], queryFn: ({ signal }) => collectAllRecords((page, pageSize = 100) => getCarriersApi({ page, pageSize }), signal) })
  const available = (carriers.data?.list || []).filter(c => !c.platformCode || ['sf', 'deppon'].includes(c.platformCode))
  const visible = available.filter(c => `${c.name} ${c.monthlyAccount || ''} ${c.code}`.toLowerCase().includes(keyword.trim().toLowerCase()))
  const selected = available.find(c => String(c.id) === carrierId)
  const platform = (selected?.platformCode || chosenPlatform) as '' | 'sf' | 'deppon'
  const queryKey = ['carrier-account-binding', carrierId, platform]
  const binding = useQuery({ queryKey, queryFn: () => getCarrierAccountBindingApi(Number(carrierId), platform as 'sf' | 'deppon'), enabled: !creating && !!selected && !!platform, refetchOnWindowFocus: false })
  function switchTo(id: string) {
    setCreating(id === 'new'); setCarrierId(id === 'new' ? '' : id); setPlatform(''); setError(''); setDirty(false); setNextSelection(null)
  }
  function select(id: string) {
    if (saving) return
    if (dirty) { setNextSelection(id); return }
    switchTo(id)
  }
  async function refreshCarriers() { await client.invalidateQueries({ queryKey: ['carriers'] }) }
  async function save(input: SaveCarrierAccountBinding | PauseCarrierAccountBinding) {
    if (busy.current) return
    busy.current = true; setSaving(true)
    try {
      const result = await saveCarrierAccountBindingApi(Number(carrierId), input)
      client.setQueryData(queryKey, result); setDirty(false)
      await refreshCarriers()
      toast.success('action' in input ? input.action === 'unbind' ? '账号已解绑，历史记录已保留' : '自动下单已暂停' : input.enabled ? '自动下单已启用' : '月结资料已保存，请查看开通进度')
    } finally { busy.current = false; setSaving(false) }
  }
  async function create(data: NewCarrierAccount) {
    if (busy.current) return
    busy.current = true; setSaving(true)
    const signature = JSON.stringify(data)
    if (createAttempt.current.signature !== signature) createAttempt.current = { signature, key: createRequestKey('carrier-account') }
    try {
      const result = await createCarrierAccountApi(data, createAttempt.current.key)
      await refreshCarriers()
      switchTo(String(result.id)); createAttempt.current = { signature: '', key: '' }
      toast.success('账号已新增，请继续选择常用服务')
    } finally { busy.current = false; setSaving(false) }
  }
  async function remove() {
    if (!selected || busy.current) return
    busy.current = true; setSaving(true); setError('')
    try {
      await deleteCarrierApi(selected.id, { skipGlobalError: true })
      client.removeQueries({ queryKey: ['carrier-account-binding', carrierId] })
      switchTo(''); await refreshCarriers(); toast.success('未使用的承运商已删除')
    } catch (e) { setError(e instanceof Error ? e.message : '删除失败，请重试') }
    finally { busy.current = false; setSaving(false); setDeleting(false) }
  }
  return <div className="p-4 sm:p-6">
    <PageHeader title="快递账号绑定" description="管理顺丰、德邦月结账号。新增和保存资料均不会自动发货。" actions={<>{canCreate && <Button disabled={saving} onClick={() => select('new')}>新增账号</Button>}<Button variant="outline" disabled={saving || dirty || creating} onClick={() => navigate('/carriers')}>承运商管理</Button></>} />
    <div className="grid items-start gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
      <aside aria-label="快递账号列表" className="min-w-0 space-y-3">
        <Input aria-label="搜索快递账号" placeholder="搜索名称或月结号" value={keyword} onChange={e => setKeyword(e.target.value)} />
        <p className="text-sm text-muted-foreground">{available.length} 个承运商 · 选择后管理账号</p>
        {carriers.isError ? <p role="alert">账号列表读取失败。<Button variant="link" onClick={() => void carriers.refetch()}>重新加载</Button></p> : carriers.isLoading ? <p role="status">正在读取账号…</p> : <div className="max-h-64 overflow-auto rounded-lg border lg:max-h-[65vh]">
          {visible.map(c => <button key={c.id} type="button" aria-pressed={!creating && String(c.id) === carrierId} disabled={saving} onClick={() => select(String(c.id))} className={`block w-full border-b px-4 py-3 text-left last:border-b-0 hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:opacity-50 ${!creating && String(c.id) === carrierId ? 'bg-accent text-accent-foreground' : 'bg-card'}`}>
            <span className="block break-words font-medium">{c.name}</span><span className="mt-1 block break-all text-sm text-muted-foreground">{c.monthlyAccount || '未绑定月结账号'}</span><span className="mt-2 block text-xs text-muted-foreground">{c.platformCode === 'sf' ? '顺丰 · ' : c.platformCode === 'deppon' ? '德邦 · ' : ''}{!c.isActive ? '承运商已停用' : c.waybillEnabled ? '自动下单已启用' : '自动下单已暂停'}</span>
          </button>)}
          {!visible.length && <p className="p-4 text-sm text-muted-foreground">{keyword ? '没有匹配的账号，请换个关键词。' : '还没有可绑定的承运商。点击新增账号开始。'}</p>}
        </div>}
      </aside>
      <section aria-label="账号管理" className="min-w-0 rounded-lg border bg-card p-4 sm:p-6">
        {error && <p role="alert" className="mb-4 text-sm text-destructive">{error}</p>}
        {creating && canCreate ? <NewAccountForm onDirtyChange={setDirty} saving={saving} onCreate={create} onCancel={() => select('')} /> : !selected ? <div className="py-10"><h2 className="font-medium">选择一个账号，或新增快递账号</h2><p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">已有承运商可直接选择并填写月结号。修改、暂停和解绑都在这里完成，无需填写接口密钥。</p></div> : <>
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b pb-4"><div><h2 className="font-semibold">{selected.name}</h2><p className="mt-1 text-sm text-muted-foreground">{selected.code} · {selected.isActive ? '承运商正常使用' : '承运商已停用'}</p></div><div className="flex flex-wrap gap-2">
            {platform && <Button variant="outline" disabled={saving || dirty || binding.isFetching} onClick={() => void binding.refetch()}>刷新开通状态</Button>}
            {canDelete && <Button variant="ghost" disabled={saving || dirty || !!selected.monthlyAccount || selected.waybillEnabled} onClick={() => setDeleting(true)}>删除承运商</Button>}
          </div></div>
          {!selected.platformCode && <div className="mb-6 max-w-xs space-y-2"><Label htmlFor="binding-company">快递公司</Label><Select value={platform || '__empty__'} disabled={saving || dirty || !canEdit} onValueChange={v => setPlatform(v === '__empty__' ? '' : v as 'sf' | 'deppon')}><SelectTrigger id="binding-company"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="__empty__">请选择快递公司</SelectItem><SelectItem value="sf">顺丰</SelectItem><SelectItem value="deppon">德邦</SelectItem></SelectContent></Select></div>}
          {!platform ? <p className="text-sm text-muted-foreground">请先选择快递公司，再绑定月结账号。</p> : binding.isError ? <p role="alert">{binding.error instanceof Error ? binding.error.message : '开通状态读取失败，请刷新重试'}</p> : binding.data ? <AccountBindingForm key={`${carrierId}:${platform}:${binding.data.revision}`} data={binding.data} canEdit={canEdit} saving={saving} onSave={save} onDirtyChange={setDirty} /> : <p role="status">正在检查账号准备状态…</p>}
          {canDelete && <p className="mt-6 border-t pt-4 text-xs leading-5 text-muted-foreground">删除仅适用于已解绑且没有关联业务记录的承运商。已使用的账号可以暂停或解绑，历史记录会保留。</p>}
        </>}
      </section>
    </div>
    <ConfirmDialog open={nextSelection !== null} title="放弃尚未保存的资料？" description="切换后当前未保存的填写内容会丢失。" confirmText="放弃并继续" onConfirm={() => switchTo(nextSelection || '')} onCancel={() => setNextSelection(null)} />
    <ConfirmDialog open={deleting} title="删除未使用的承运商" description={`确认删除「${selected?.name || ''}」？系统会检查月结绑定和关联业务；已有业务记录时不允许删除。此操作不会解除快递官网授权。`} variant="destructive" confirmText="确认删除" loading={saving} onConfirm={() => void remove()} onCancel={() => setDeleting(false)} />
  </div>
}
