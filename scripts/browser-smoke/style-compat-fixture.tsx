// Golden capture: Tailwind 3.4.19 + tailwind-merge 2.6.1, original application CSS/config.
// Keep the first <main> candidate set unchanged; only the edge section adds test candidates.
import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Input } from '../../frontend/src/components/ui/input'
import { Button } from '../../frontend/src/components/ui/button'
import { Badge } from '../../frontend/src/components/ui/badge'
import { SummaryStrip } from '../../frontend/src/components/shared/SummaryStrip'
import { Dialog, DialogContent, DialogTitle } from '../../frontend/src/components/ui/dialog'

function Fixture() {
  const [open, setOpen] = useState(true)
  const [actions, setActions] = useState(0)
  const [pointer, setPointer] = useState('')
  return <>
  <main className="p-6 space-y-4">
    <h1 id="title" className="text-page-title">销售与仓库</h1>
    <Input id="input" placeholder="商品型号" />
    <Button id="primary">确认</Button>
    <Button id="secondary" variant="outline">返回</Button>
    <Button id="pda" size="pda" onPointerDown={event => setPointer(event.pointerType)} onClick={() => setActions(n => n + 1)}>扫码确认</Button>
    <Badge id="badge">待收货</Badge>
    <div id="card" className="card-base p-4 shadow-sm">成套配件</div>
    <div id="surface" className="data-table-header-surface text-xs font-medium border-b">商品 / 数量 / 金额</div>
    <div id="success" className="bg-success/10 text-success border border-success/20 p-2">收货完成</div>
    <div id="warning" className="bg-warning/10 text-warning border border-warning/20 p-2">部分发货</div>
    <div id="space" className="space-y-4"><p id="first">客户</p><p id="second">应收金额</p></div>
    <div id="palette" className="bg-slate-100 text-slate-700 border border-gray-200 p-3">打印说明</div>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent id="dialog"><DialogTitle>来源单据</DialogTitle><p>只读财务明细</p></DialogContent></Dialog>
  </main>
  <section className="p-6" aria-label="样式边界">
    <Button id="open-dialog" onClick={() => setOpen(true)}>查看来源</Button>
    <output id="actions" data-pointer={pointer}>{actions}</output>
    <div className="flex flex-col space-y-4"><div hidden>隐藏</div><div id="hidden-y-first" className="h-4 w-4" /><div id="hidden-y-second" className="h-4 w-4" /></div>
    <div className="flex space-x-4"><div hidden>隐藏</div><div id="hidden-x-first" className="h-4 w-4" /><div id="hidden-x-second" className="h-4 w-4" /></div>
    <div className="flex flex-col space-y-4 sm:space-y-0"><div id="responsive-y-first" className="h-4 w-4" /><div id="responsive-y-second" className="h-4 w-4" /></div>
    <div className="flex space-x-4 sm:space-x-0"><div id="responsive-x-first" className="h-4 w-4" /><div id="responsive-x-second" className="h-4 w-4" /></div>
    <div className="flex flex-col space-y-4"><div id="margin-first" className="h-4 w-4 mb-2" /><div id="margin-second" className="h-4 w-4 mt-2 mb-2" /></div>
    <div className="flex flex-col space-y-4 space-y-reverse"><div id="reverse-y-first" className="h-4 w-4" /><div id="reverse-y-second" className="h-4 w-4" /></div>
    <div className="flex space-x-4 space-x-reverse"><div id="reverse-x-first" className="h-4 w-4" /><div id="reverse-x-second" className="h-4 w-4" /></div>
    <div id="summary" style={{ width: 300 }}><SummaryStrip items={[{ label: '订单', value: '3' }, { label: '应收', value: '100.00' }, { label: '已收', value: '20.00' }]} /></div>
    <div className="flex flex-col divide-y divide-border"><div hidden>隐藏</div><div id="divide-y-first" className="h-4" /><div id="divide-y-second" className="h-4" /></div>
    <div className="flex flex-col divide-y sm:divide-y-0 divide-border"><div id="responsive-divide-first" className="h-4" /><div id="responsive-divide-second" className="h-4" /></div>
    <div className="flex flex-col divide-y divide-y-reverse"><div id="reverse-divide-first" className="h-4" /><div id="reverse-divide-second" className="h-4" /></div>
  </section>
  </>
}
createRoot(document.getElementById('root')!).render(<Fixture />)
requestAnimationFrame(() => requestAnimationFrame(() => { (window as unknown as { __styleReady: boolean }).__styleReady = true }))
