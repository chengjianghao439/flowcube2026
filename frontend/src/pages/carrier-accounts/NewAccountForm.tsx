import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { FormField } from '@/components/shared/FormField'
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
  return <form className="desktop-management-form max-w-xl space-y-5" onSubmit={e => { e.preventDefault(); void submit() }}>
    <div><h2 className="text-base font-semibold">新增承运商账号</h2><p className="mt-2 text-sm text-muted-foreground">已有承运商可在账号列表中选择。</p></div>
    <fieldset disabled={saving} className="space-y-5">
      <FormField id="new-account-platform" label="快递公司">{field => <Select value={platform} onValueChange={v => setPlatform(v as 'sf' | 'deppon')} disabled={saving}><SelectTrigger {...field}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="sf">顺丰</SelectItem><SelectItem value="deppon">德邦</SelectItem></SelectContent></Select>}</FormField>
      <FormField id="new-account-name" label="承运商名称">{field => <Input {...field} value={name} onChange={e => setName(e.target.value)} maxLength={10} required placeholder="例如：顺丰北京仓" />}</FormField>
      <FormField id="new-account-monthly" label="月结账号">{field => <Input {...field} value={monthly} onChange={e => setMonthly(e.target.value)} maxLength={platform === 'sf' ? 20 : 32} pattern="[A-Za-z0-9_\-]+" required autoComplete="off" placeholder="填写快递公司提供的月结账号" />}</FormField>
    </fieldset>
    {error && <p role="alert" className="text-sm text-destructive-ink">{error}</p>}
    <div className="flex flex-wrap justify-end gap-2"><Button type="button" variant="outline" disabled={saving} onClick={onCancel}>取消新增</Button><Button type="submit" disabled={saving}>{saving ? '正在新增…' : '保存并继续'}</Button></div>
  </form>
}
