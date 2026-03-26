import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import PageHeader from '@/components/shared/PageHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { getPriceListsApi, createPriceListApi, deletePriceListApi, getPriceListItemsApi, updatePriceListItemsApi } from '@/api/price-lists'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { toast } from '@/lib/toast'
import { useProducts } from '@/hooks/useProducts'
import type { PriceList, PriceListItem } from '@/api/price-lists'

interface DraftItem extends PriceListItem { _key: number; isDirty?: boolean }

export default function PriceListsPage() {
  const qc = useQueryClient()
  const [selected, setSelected] = useState<PriceList | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [name, setName] = useState('')
  const [remark, setRemark] = useState('')
  const [items, setItems] = useState<DraftItem[]>([])
  const [counter, setCounter] = useState(0)
  const [saving, setSaving] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(false)

  const { data: lists, isLoading } = useQuery({ queryKey: ['price-lists'], queryFn: () => getPriceListsApi().then(r => r.data.data || []) })
  const { data: products } = useProducts({ page: 1, pageSize: 500, keyword: '' })
  useQuery({ queryKey: ['price-list-items', selected?.id], queryFn: () => getPriceListItemsApi(selected!.id).then(r => r.data.data || []), enabled: !!selected, onSuccess: (data: PriceListItem[]) => setItems(data.map((i, k) => ({ ...i, _key: k }))) } as Parameters<typeof useQuery>[0])

  const createMut = useMutation({ mutationFn: createPriceListApi, onSuccess: () => { qc.invalidateQueries({ queryKey: ['price-lists'] }); setCreateOpen(false); setName(''); setRemark('') } })
  const deleteMut = useMutation({ mutationFn: deletePriceListApi, onSuccess: () => { qc.invalidateQueries({ queryKey: ['price-lists'] }); setSelected(null) } })

  const addRow = () => { setCounter(c => c + 1); setItems(p => [...p, { _key: counter, id: 0, productId: 0, productCode: '', productName: '', unit: '', salePrice: 0 }]) }
  const removeRow = (k: number) => setItems(p => p.filter(i => i._key !== k))
  const selectProduct = (k: number, pid: string) => {
    if (!pid || pid === '__none__') {
      setItems(prev => prev.map(i => i._key === k ? { ...i, productId: 0, productCode: '', productName: '', unit: '', salePrice: 0 } : i))
      return
    }
    const p = products?.list.find(x => String(x.id) === pid)
    if (p) setItems(prev => prev.map(i => i._key === k ? { ...i, productId: p.id, productCode: p.code, productName: p.name, unit: p.unit, salePrice: p.salePrice || 0 } : i))
  }
  const updatePrice = (k: number, v: number) => setItems(p => p.map(i => i._key === k ? { ...i, salePrice: v } : i))

  const saveItems = async () => {
    if (!selected) return
    setSaving(true)
    try {
      await updatePriceListItemsApi(selected.id, items.filter(i => i.productId > 0).map(i => ({ productId: i.productId, productCode: i.productCode, productName: i.productName, unit: i.unit, salePrice: i.salePrice })))
      qc.invalidateQueries({ queryKey: ['price-list-items', selected.id] })
      toast.success('价格表已保存')
    } catch (e) { toast.error((e as Error).message) }
    setSaving(false)
  }

  return (
    <div className="space-y-4">
      <PageHeader title="价格管理" description="为客户设置专属价格表，下销售单时自动带入" actions={<Button onClick={() => setCreateOpen(true)}>+ 新建价格表</Button>} />

      <div className="grid grid-cols-4 gap-4 min-h-96">
        {/* 左侧：价格表列表 */}
        <div className="col-span-1 space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">价格表</p>
          {isLoading && <p className="text-sm text-muted-foreground">加载中...</p>}
          {lists?.map(list => (
            <div key={list.id} onClick={() => setSelected(list)}
              className={`p-3 rounded-lg border cursor-pointer transition-colors ${selected?.id === list.id ? 'border-primary bg-primary/5' : 'hover:border-primary/40'}`}>
              <p className="font-medium text-sm">{list.name}</p>
              {list.remark && <p className="text-xs text-muted-foreground mt-0.5 truncate">{list.remark}</p>}
            </div>
          ))}
          {!lists?.length && !isLoading && <p className="text-sm text-muted-foreground text-center py-8 border rounded-lg">暂无价格表</p>}
        </div>

        {/* 右侧：价格明细 */}
        <div className="col-span-3 border rounded-xl p-4 space-y-4">
          {!selected ? (
            <div className="flex items-center justify-center h-full text-muted-foreground text-sm">← 点击左侧选择价格表</div>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-semibold">{selected.name}</h3>
                  {selected.remark && <p className="text-sm text-muted-foreground">{selected.remark}</p>}
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={addRow}>+ 添加商品</Button>
                  <Button size="sm" onClick={saveItems} disabled={saving}>{saving ? '保存中...' : '保存价格表'}</Button>
                  <Button size="sm" variant="destructive" onClick={() => setDeleteConfirm(true)}>删除</Button>
                </div>
              </div>

              <div className="rounded-lg border overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40">
                    <tr><th className="px-4 py-2 text-left text-muted-foreground font-medium">商品</th><th className="px-4 py-2 text-left w-16 text-muted-foreground font-medium">单位</th><th className="px-4 py-2 text-right w-32 text-muted-foreground font-medium">专属价格</th><th className="px-4 py-2 w-12"></th></tr>
                  </thead>
                  <tbody>
                    {!items.length && <tr><td colSpan={4} className="text-center py-8 text-muted-foreground">暂无明细，点击「添加商品」</td></tr>}
                    {items.map(item => (
                      <tr key={item._key} className="border-t">
                        <td className="px-4 py-2">
                          <Select value={item.productId ? String(item.productId) : '__none__'} onValueChange={v => selectProduct(item._key, v)}>
                            <SelectTrigger className="w-full h-9 text-sm"><SelectValue placeholder="选择商品" /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__none__">选择商品</SelectItem>
                              {products?.list.map(p => (
                                <SelectItem key={p.id} value={String(p.id)}>{p.name}（{p.code}）</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </td>
                        <td className="px-4 py-2 text-muted-foreground text-center">{item.unit || '-'}</td>
                        <td className="px-4 py-2">
                          <div className="flex items-center justify-end gap-1">
                            <span className="text-muted-foreground">¥</span>
                            <Input type="number" min="0" step="0.01" className="w-24 text-right text-sm" value={item.salePrice} onChange={(e: React.ChangeEvent<HTMLInputElement>) => updatePrice(item._key, +e.target.value)} />
                          </div>
                        </td>
                        <td className="px-4 py-2 text-right"><Button size="sm" variant="ghost" className="text-red-500 px-2" onClick={() => removeRow(item._key)}>✕</Button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={deleteConfirm}
        title="确认删除"
        description={`删除价格表「${selected?.name}」？该操作不可撤销。`}
        variant="destructive"
        confirmText="删除"
        onConfirm={() => { if (selected) deleteMut.mutate(selected.id); setDeleteConfirm(false) }}
        onCancel={() => setDeleteConfirm(false)}
      />
      {/* 新建价格表弹窗 */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>新建价格表</DialogTitle></DialogHeader>
          <form onSubmit={async (e) => { e.preventDefault(); await createMut.mutateAsync({ name, remark: remark || undefined }) }} className="space-y-4">
            <div className="space-y-1"><Label>名称 *</Label><Input value={name} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)} placeholder="如：VIP客户价、批发价" required /></div>
            <div className="space-y-1"><Label>备注</Label><Input value={remark} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRemark(e.target.value)} /></div>
            <DialogFooter><Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>取消</Button><Button type="submit" disabled={createMut.isPending}>创建</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
