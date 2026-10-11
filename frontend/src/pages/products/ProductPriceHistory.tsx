import { useState } from 'react'
import { DocumentActivityPanel } from '@/components/shared/DocumentActivityPanel'
import { captureKitReadOwner } from '@/hooks/useKits'
function PriceRecords({ id }: { id: number }) {
  const [owner] = useState(captureKitReadOwner)
  return <DocumentActivityPanel type="product" id={id} view="log" readOwner={owner} />
}
export function ProductPriceHistory({ id }: { id: number }) {
  const [open,setOpen] = useState(false)
  return <details className="rounded-md border" onToggle={event => setOpen(event.currentTarget.open)}><summary className="cursor-pointer px-4 py-3 text-sm font-medium">价格变更记录</summary>{open && <div className="px-4 pb-4"><PriceRecords id={id} /></div>}</details>
}
