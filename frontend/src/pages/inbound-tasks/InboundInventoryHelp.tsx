import { Info } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

/** 解释既有收货节点，不根据任务状态另算库存或开放执行入口。 */
export function InboundInventoryHelp() {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" size="icon" className="h-6 w-6 shrink-0" aria-label="库存生效说明" title="库存生效说明">
          <Info className="h-3.5 w-3.5" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(22rem,calc(100vw-2rem))] p-3 text-sm" aria-label="库存生效说明">
        <dl className="space-y-3">
          <div><dt className="font-medium">保存订单</dt><dd>保存和打印标签不增加现货库存。</dd></div>
          <div><dt className="font-medium">PDA 实收</dt><dd>生成待上架库存条码，尚未计入现货。</dd></div>
          <div><dt className="font-medium">扫码上架</dt><dd>收货中也可上架已实收条码；上架数量计入现货，现货可用量仍受销售预占影响。</dd></div>
          <div><dt className="font-medium">自动结算</dt><dd>收货结束且实收全部上架后，整单自动结算应付。</dd></div>
        </dl>
      </PopoverContent>
    </Popover>
  )
}
