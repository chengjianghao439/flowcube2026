import { useRef } from 'react'
import Barcode from 'react-barcode'
import { QRCodeSVG } from 'qrcode.react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { printHtmlDocument } from '@/lib/printHtmlDocument'

interface Props {
  open: boolean
  onClose: () => void
  product: { id: number; code: string; name: string; unit: string; salePrice?: number } | null
  copies?: number
}

export default function BarcodeDialog({ open, onClose, product, copies = 1 }: Props) {
  const printRef = useRef<HTMLDivElement>(null)

  if (!product) return null

  const handlePrint = () => {
    const content = printRef.current?.innerHTML
    if (!content) return
    printHtmlDocument(`<!DOCTYPE html><html><head><meta charset="utf-8"/><title>标签打印</title><style>
      body{font-family:'PingFang SC',sans-serif;margin:0;padding:16px}
      .label{display:inline-block;border:1px solid #ddd;border-radius:4px;padding:10px 14px;margin:6px;width:200px;vertical-align:top;text-align:center}
      .product-name{font-size:12px;font-weight:600;margin-bottom:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .product-code{font-size:10px;color:#666;margin-bottom:6px}
      .price{font-size:14px;font-weight:bold;color:#e53e3e;margin-top:4px}
      .unit{font-size:10px;color:#888}
      svg{max-width:100%}
      @media print{body{padding:4px}}
    </style></head><body>
    ${Array(copies).fill(`<div class="label">${content}</div>`).join('')}
    </body></html>`)
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>商品标签 — {product.name}</DialogTitle></DialogHeader>
        <div className="flex flex-col items-center space-y-4 py-4">
          {/* 标签预览 */}
          <div ref={printRef} className="border rounded-lg p-4 w-52 flex flex-col items-center bg-white shadow-sm">
            <p className="font-semibold text-sm text-center mb-1 w-full truncate">{product.name}</p>
            <p className="text-xs text-muted-foreground mb-3">{product.code}</p>
            {/* 条形码 */}
            <Barcode value={product.code || '000000'} width={1.4} height={50} fontSize={10} displayValue margin={0} />
            {/* QR码 */}
            <div className="mt-3">
              <QRCodeSVG value={`FLOWCUBE:${product.id}:${product.code}`} size={72} level="M" />
            </div>
            {product.salePrice !== undefined && product.salePrice > 0 && (
              <p className="price mt-2">¥{product.salePrice.toFixed(2)} <span className="unit">/{product.unit}</span></p>
            )}
          </div>
          <p className="text-xs text-muted-foreground">条形码 + QR码（含商品ID/编码）</p>
        </div>
        <div className="flex gap-2 justify-end">
          <Button variant="outline" onClick={onClose}>关闭</Button>
          <Button onClick={handlePrint}>打印标签</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
