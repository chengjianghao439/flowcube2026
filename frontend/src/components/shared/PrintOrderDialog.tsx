import { useRef } from 'react'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

interface OrderItem { productCode:string; productName:string; unit:string; quantity:number; unitPrice:number; amount:number; remark?:string }
interface PrintOrderData {
  orderNo: string; type: '采购单'|'销售单'; status: string
  partyLabel: string; partyName: string
  warehouseName: string; date?: string
  totalAmount: number; operatorName: string; createdAt: string
  remark?: string; items: OrderItem[]
}

interface Props { open: boolean; onClose: () => void; data?: PrintOrderData | null }

export default function PrintOrderDialog({ open, onClose, data }: Props) {
  const printRef = useRef<HTMLDivElement>(null)

  const handlePrint = () => {
    const content = printRef.current?.innerHTML
    if (!content) return
    const w = window.open('', '_blank', 'width=800,height=600')
    if (!w) return
    w.document.write(`<!DOCTYPE html><html><head><title>${data?.orderNo}</title><style>
      body{font-family:'PingFang SC',Microsoft YaHei,sans-serif;padding:24px;color:#000;font-size:13px}
      h2{text-align:center;font-size:18px;margin-bottom:4px}
      .subtitle{text-align:center;color:#555;margin-bottom:16px;font-size:12px}
      .info-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px 24px;margin-bottom:16px}
      .info-item{display:flex;gap:8px}.info-label{color:#666;white-space:nowrap}
      table{width:100%;border-collapse:collapse;margin-top:8px}
      th{background:#f0f0f0;padding:8px 6px;text-align:left;border:1px solid #ddd;font-size:12px}
      td{padding:7px 6px;border:1px solid #ddd;font-size:12px}
      .total-row td{font-weight:bold;background:#fafafa}
      .footer{margin-top:24px;display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;font-size:12px}
      .sign-line{border-bottom:1px solid #000;margin-top:24px;margin-bottom:4px}
      @media print{body{padding:0}}
    </style></head><body>${content}</body></html>`)
    w.document.close()
    w.focus(); w.print(); w.close()
  }

  if (!data) return null

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <div ref={printRef}>
          <h2>{data.type}</h2>
          <p className="subtitle">单号：{data.orderNo} &nbsp;|&nbsp; 状态：{data.status}</p>
          <div className="info-grid">
            <div className="info-item"><span className="info-label">{data.partyLabel}：</span><span>{data.partyName}</span></div>
            <div className="info-item"><span className="info-label">仓库：</span><span>{data.warehouseName}</span></div>
            {data.date && <div className="info-item"><span className="info-label">日期：</span><span>{data.date}</span></div>}
            <div className="info-item"><span className="info-label">经办人：</span><span>{data.operatorName}</span></div>
            <div className="info-item"><span className="info-label">创建时间：</span><span>{String(data.createdAt).slice(0,16)}</span></div>
            {data.remark && <div className="info-item col-span-2"><span className="info-label">备注：</span><span>{data.remark}</span></div>}
          </div>
          <table>
            <thead><tr><th>#</th><th>编码</th><th>商品名称</th><th>单位</th><th>数量</th><th>单价</th><th>金额</th><th>备注</th></tr></thead>
            <tbody>
              {data.items.map((item, i) => (
                <tr key={i}>
                  <td>{i+1}</td><td>{item.productCode}</td><td>{item.productName}</td><td>{item.unit}</td>
                  <td>{item.quantity}</td><td>¥{item.unitPrice.toFixed(2)}</td><td>¥{item.amount.toFixed(2)}</td><td>{item.remark||'-'}</td>
                </tr>
              ))}
              <tr className="total-row"><td colSpan={6} style={{textAlign:'right'}}>合计：</td><td>¥{data.totalAmount.toFixed(2)}</td><td></td></tr>
            </tbody>
          </table>
          <div className="footer" style={{marginTop:32}}>
            <div><div className="sign-line"></div><p>制单人</p></div>
            <div><div className="sign-line"></div><p>审核人</p></div>
            <div><div className="sign-line"></div><p>收货/发货签字</p></div>
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-4 border-t mt-4">
          <Button variant="outline" onClick={onClose}>关闭</Button>
          <Button onClick={handlePrint}>打印</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
