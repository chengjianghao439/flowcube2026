import { useId, type ReactNode } from 'react'
import { PackageOpen, Plus } from 'lucide-react'
import { OrderFieldError } from '@/components/shared/OrderFieldError'
import { SectionCard } from '@/components/shared/SectionCard'
import { Button } from '@/components/ui/button'

/** 新建、编辑和改单共用的商品区域，只负责布局。 */
export function SaleOrderItemsSection({ hasItems, onAdd, children, allowAdd = true, compact = false, addError }: {
  compact?: boolean
  addError?: string
  allowAdd?: boolean
  hasItems: boolean
  onAdd: () => void
  children: ReactNode
}) {
  const errorId = useId()
  return (
    <SectionCard title="商品明细" compact noPadding={compact} actions={allowAdd ? <>
      <OrderFieldError id={errorId}>{addError}</OrderFieldError>
      <Button data-entry-add data-entry-field="add" type="button" size="sm" variant="outline" onClick={onAdd} aria-describedby={addError ? errorId : undefined} className="gap-1.5">
        <Plus className="h-4 w-4" />添加商品
      </Button></> : undefined
    }>
      {hasItems ? children : compact ? <div className="flex min-h-32 items-center justify-center px-4 py-6 text-sm text-muted-foreground">尚未添加商品</div> : (
        <div className="flex items-center justify-center gap-4 py-10 text-left">
          <PackageOpen className="h-9 w-9 shrink-0 text-muted-foreground/50" />
          <div>
            <p className="text-sm font-medium">添加本单商品</p>
          </div>
        </div>
      )}
    </SectionCard>
  )
}
