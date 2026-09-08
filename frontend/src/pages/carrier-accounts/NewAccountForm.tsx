import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { NewCarrierAccount } from '@/types/carriers'

export function NewAccountForm({ saving, onCreate, onCancel, onDirtyChange }: {
  onDirtyChange?: (dirty: boolean) => void
  saving: boolean
  onCreate: (data: NewCarrierAccount) => Promise<void>
  onCancel: () => void
}) {
  const [name, setName] = useState('')
  const [platform, setPlatform] = useState<'sf' | 'deppon'>('sf')
  const [monthly, setMonthly] = useState('')
  const [error, setError] = useState('')
  useEffect(() => { onDirtyChange?.(!!name || !!monthly || platform !== 'sf') }, [name, monthly, platform, onDirtyChange])
  async function submit() {
    setError('')
    if (!name.trim() || !monthly.trim()) { setError('请填写承运商名称和月结账号'); return }
    try { await onCreate({ name: name.trim(), platformCode: platform, monthlyAccount: monthly.trim() }) }
    catch (e) { setError(e instanceof Error ? e.message : '新增失败，请重试') }
  }
  return <form className="max-w-xl space-y-6" onSubmit={e => { e.preventDefault(); void submit() }}>
    <div><h2 className="text-base font-semibold">新增承运商账号</h2><p className="mt-2 text-sm text-muted-foreground">已有承运商请从左侧选择。</p></div>
    <fieldset disabled={saving} className="space-y-5">
      <div className="space-y-2"><Label htmlFor="new-account-platform">快递公司</Label><Select value={platform} onValueChange={v => setPlatform(v as 'sf' | 'deppon')} disabled={saving}><SelectTrigger id="new-account-platform"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="sf">顺丰</SelectItem><SelectItem value="deppon">德邦</SelectItem></SelectContent></Select></div>
      <div className="space-y-2"><Label htmlFor="new-account-name">承运商名称</Label><Input id="new-account-name" value={name} onChange={e => setName(e.target.value)} maxLength={10} required placeholder="例如：顺丰北京仓" /></div>
      <div className="space-y-2"><Label htmlFor="new-account-monthly">月结账号</Label><Input id="new-account-monthly" value={monthly} onChange={e => setMonthly(e.target.value)} maxLength={platform === 'sf' ? 20 : 32} pattern="[A-Za-z0-9_\-]+" required autoComplete="off" placeholder="填写快递公司提供的月结账号" /></div>
    </fieldset>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <div className="flex gap-3"><Button type="submit" disabled={saving}>{saving ? '正在新增…' : '保存并继续'}</Button><Button type="button" variant="outline" disabled={saving} onClick={onCancel}>取消新增</Button></div>
  </form>
}
