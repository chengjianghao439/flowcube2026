import { payloadClient as client } from './client'

/** PDA 工作台「作业待办通知」计数（按设备绑定仓库聚合，仅 PDA 可调） */
export interface PdaTodoCounts {
  inbound: number      // 收货订单
  picking: number      // 拣货
  checking: number     // 复核
  packing: number      // 打包
  shipping: number     // 待出库
  saleReturn: number   // 销售退货
  transfer: number     // 调拨
  stockcheck: number   // 盘点
  cancelReturn: number // 拣货退回
  adjustments: number  // 改单确认
}

export const getPdaTodoCountsApi = () =>
  client.get<PdaTodoCounts>('/pda/todo-counts', { headers: { 'X-Client': 'pda' } })
