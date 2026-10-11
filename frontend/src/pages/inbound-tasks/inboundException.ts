import type { InboundExceptionFlags } from '@/types/inbound-tasks'

/** 原异常计数来自后端；排队、打印中、普通待上架不属于异常。 */
export function inboundExceptionReason(flags?: InboundExceptionFlags): string {
  if (!flags) return ''
  return [
    flags.failedPrintJobs > 0 ? `打印失败 ${flags.failedPrintJobs} 项` : '',
    flags.timeoutPrintJobs > 0 ? `打印超时 ${flags.timeoutPrintJobs} 项` : '',
    flags.overduePutawayContainers > 0 ? `上架逾期 ${flags.overduePutawayContainers} 条库存条码` : '',
  ].filter(Boolean).join('；')
}
