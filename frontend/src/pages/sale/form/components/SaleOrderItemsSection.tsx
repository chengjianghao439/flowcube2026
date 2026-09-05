import type { ReactNode } from 'react'
import { PackageOpen, Plus } from 'lucide-react'
import { SectionCard } from '@/components/shared/SectionCard'
import { Button } from '@/components/ui/button'

/** 新建、编辑和改单共用的商品区域，只负责布局。 */
export function SaleOrderItemsSection({ hasItems, onAdd, children }: {
  hasItems: boolean
  onAdd: () => void
  children: ReactNode
}) {
  return (
    <SectionCard title="商品明细" compact actions={
      <Button type="button" size="sm" variant="outline" onClick={onAdd} className="gap-1.5">
        <Plus className="h-4 w-4" />添加商品
      </Button>
    }>
      {hasItems ? children : (
        <div className="flex items-center justify-center gap-4 py-10 text-left">
          <PackageOpen className="h-9 w-9 shrink-0 text-muted-foreground/50" />
          <div>
            <p className="text-sm font-medium">添加本单商品</p>
            <p className="mt-1 text-xs text-muted-foreground">点击右上角“添加商品”，选择后填写数量与单价。</p>
          </div>
        </div>
      )}
    </SectionCard>
  )
}
