import { useEffect, useState } from 'react'
import type { SaleOrder } from '@/types/sale'
import { useCommercialSaleRead } from '@/hooks/useCommercialSale'
import { Button } from '@/components/ui/button'
import CommercialEditor from './CommercialEditor'

/** Freeze the actual owned read once; background refreshes cannot replace an open draft. */
export function ExistingSaleEditor({ saleId, tabPath, adjust = false, onDone }: {
  saleId: number; tabPath: string; adjust?: boolean; onDone: () => void
}) {
  const read = useCommercialSaleRead(saleId)
  const [generation, setGeneration] = useState(0)
  const [baseline, setBaseline] = useState<SaleOrder | null>(null)
  useEffect(() => {
    if (!baseline && read.isFetchedAfterMount && !read.isFetching && !read.isError && read.data?.id === saleId) setBaseline(read.data)
  }, [baseline, read.isFetchedAfterMount, read.isFetching, read.isError, read.data, saleId])
  if (baseline) return <CommercialEditor key={generation} order={baseline} owner={read.readOwner} tabPath={tabPath} adjust={adjust}
    ordinaryOnlySave={baseline.commercialModel !== 'kit-v1'} onDone={onDone} onReload={next => { setBaseline(next); setGeneration(value => value + 1) }} />
  return <div className="space-y-3 p-4 text-sm" role={read.isError ? 'alert' : 'status'}>
    <p>{read.isError ? '原单读取失败，无法初始化编辑草稿' : '正在加载原单…'}</p>
    {read.isError && <Button variant="outline" onClick={() => void read.refetch()}>重新读取原单</Button>}
    <Button variant="outline" onClick={onDone}>返回订单</Button>
  </div>
}
