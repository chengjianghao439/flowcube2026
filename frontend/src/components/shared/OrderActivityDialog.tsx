import { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import type { DocumentType } from '@/api/document-activity'
import { OrderDetailSections } from './OrderDetailSections'
export function OrderActivityDialog({ type, id, title, fields }: { type: DocumentType; id: number; title: string; fields: [string, string | number | null | undefined][] }) {
  const [open, setOpen] = useState(false)
  return <><Button size="sm" variant="outline" onClick={() => setOpen(true)}>详情 / 记录</Button>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto"><DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
      <OrderDetailSections type={type} id={id}><dl className="grid grid-cols-2 gap-x-8 gap-y-4 rounded-lg border p-4 text-sm">{fields.map(([label, value]) => <div key={label}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 whitespace-pre-wrap break-words">{value ?? '—'}</dd></div>)}</dl></OrderDetailSections>
    </DialogContent></Dialog>
  </>
}
