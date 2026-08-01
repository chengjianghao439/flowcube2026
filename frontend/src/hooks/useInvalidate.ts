/**
 * useInvalidate — Keep-Alive 架构下的跨 Tab 缓存刷新机制
 *
 * 问题背景：
 *   KeepAliveOutlet 保持所有已打开 Tab 的组件实例常驻 DOM，
 *   页面不会 unmount，React Query 不会触发自动 refetch。
 *   当 Tab1 执行了业务操作（如销售确认），Tab2 的销售列表、
 *   Tab3 的仓库任务等均不会自动刷新，仍显示旧数据。
 *
 * 解决方案：
 *   集中维护一张「业务事件 → queryKey 集合」映射表（INVALIDATION_MAP）。
 *   mutation onSuccess 时调用 invalidate(event)，
 *   统一 invalidateQueries 所有受该操作影响的缓存键，
 *   使全部已挂载 Tab 自动重新请求最新数据。
 *
 * 使用方式：
 *   const invalidate = useInvalidate()
 *   // 在 mutation onSuccess 中：
 *   invalidate('sale_confirm')
 *
 * 设计约束：
 *   - 不依赖全局事件总线
 *   - 不使用 window.reload
 *   - 仅在 mutation onSuccess 中调用
 *   - 完全基于 queryClient.invalidateQueries
 */

import { useQueryClient } from '@tanstack/react-query'

// ─── 映射表 ────────────────────────────────────────────────────────────────────
//
// 键命名规则：{模块}_{操作}
// 值：所有需要失效的 queryKey 前缀数组（React Query 按前缀匹配，会失效所有子查询）
//
// 覆盖维度：
//   本模块数据（如 ['sale']）
//   + 因该操作直接影响的跨模块数据（如确认后新增任务 → ['warehouse-tasks']）
//   + 聚合统计类数据（如 ['dashboard-summary']、['warehouse-tasks-stats']）

const INVALIDATION_MAP = {

  // ── 销售 ──────────────────────────────────────────────────────────────────

  /** 新建草稿：仅影响销售列表 */
  sale_create: [
    ['sale'],
  ],

  /** 编辑草稿：仅影响销售单本身 */
  sale_update: [
    ['sale'],
  ],

  /** 占用库存：预占量增加，影响销售单状态与库存可用量 */
  sale_reserve: [
    ['sale'],
    ['inventory-stock'],
    ['inventory-overview'],
  ],

  /** 确认销售单：触发仓库任务自动生成 */
  sale_confirm: [
    ['sale'],
    ['warehouse-tasks'],
    ['warehouse-tasks-stats'],
    ['dashboard-summary'],
  ],

  /** 直接出库（无仓库任务路径）：库存/账款同时变化 */
  sale_ship: [
    ['sale'],
    ['warehouse-tasks'],
    ['warehouse-tasks-stats'],
    ['inventory-stock'],
    ['inventory-logs'],
    ['inventory-overview'],
    ['inventory-containers'],
    ['dashboard-summary'],
    ['payments'],
  ],

  /** 删除销售单：已占库时释放预占 */
  sale_delete: [
    ['sale'],
    ['inventory-stock'],
    ['inventory-overview'],
    ['dashboard-summary'],
  ],

  /** 取消销售单：释放预占，可用库存增加 */
  sale_cancel: [
    ['sale'],
    ['warehouse-tasks'],
    ['warehouse-tasks-stats'],
    ['inventory-stock'],
    ['inventory-overview'],
    ['dashboard-summary'],
  ],

  /** 执行期改单：预占/仓库任务明细/容器/箱子均可能变化，pending 时还会影响改单确认池 */
  sale_adjust: [
    ['sale'],
    ['warehouse-tasks'],
    ['warehouse-tasks-stats'],
    ['inventory-stock'],
    ['inventory-overview'],
    ['inventory-containers'],
    ['warehouse-task-adjustments'],
  ],

  // ── 采购 ──────────────────────────────────────────────────────────────────

  /** 新建草稿 */
  purchase_create: [
    ['purchase'],
  ],

  /** 确认采购单（不再自动生成入库任务） */
  purchase_confirm: [
    ['purchase'],
  ],

  /** 取消采购单 */
  purchase_cancel: [
    ['purchase'],
  ],

  /** 编辑采购单草稿 */
  purchase_update: [
    ['purchase'],
  ],

  /** 关闭剩余结案采购单 */
  purchase_close: [
    ['purchase'],
  ],

  /** 撤回确认：回到草稿，仅影响采购单本身 */
  purchase_withdraw_confirm: [
    ['purchase'],
  ],

  // ── 入库任务 ──────────────────────────────────────────────────────────────

  /** 新建入库任务 */
  inbound_create: [
    ['inbound-tasks'],
    ['purchase'],
  ],

  /** 提交到 PDA / 审核通过 / 审核退回 */
  inbound_submit: [
    ['inbound-tasks'],
    ['pda-inbound-tasks'],
    ['pda-inbound-task'],
    ['barcode-print-records'],
  ],

  /** 入库任务收货（仅任务与容器，不计库存） */
  inbound_receive: [
    ['inbound-tasks'],
    ['pda-inbound-tasks'],
    ['pda-inbound-task'],
    ['barcode-print-records'],
  ],

  /** 入库任务上架：创建容器 + 库存变化 + 可能完成采购单 */
  inbound_putaway: [
    ['inbound-tasks'],
    ['purchase'],
    ['inventory-stock'],
    ['inventory-logs'],
    ['inventory-overview'],
    ['inventory-containers'],
    ['dashboard-summary'],
    ['payments'],
  ],

  /** 入库任务取消：采购单可再次创建入库任务 */
  inbound_cancel: [
    ['inbound-tasks'],
    ['purchase'],
  ],

  /** 结束收货：仅任务状态从收货中推进到待上架，不涉及库存/应付变化 */
  inbound_close_receiving: [
    ['inbound-tasks'],
  ],

  /** 撤回收货：反冲容器/库存/应付，可能把采购单退回已提交，与上架的影响面对称 */
  inbound_void_receipt: [
    ['inbound-tasks'],
    ['purchase'],
    ['inventory-stock'],
    ['inventory-logs'],
    ['inventory-overview'],
    ['inventory-containers'],
    ['dashboard-summary'],
    ['payments'],
  ],

  /**
   * 质检拒收处置（退供应商/报废，文档07 Phase2）：只把 REJECTED 容器转 VOID。
   * 拒收品从收货起就在库存缓存与应付之外，故零库存/零账款影响，只刷新收货任务与容器视图。
   */
  inbound_qa_dispose: [
    ['inbound-tasks'],
    ['inventory-containers'],
  ],

  // ── 仓库任务 ──────────────────────────────────────────────────────────────

  /** 分配/开始备货/标记完成/取消等常规操作：仅影响任务自身 */
  task_action: [
    ['warehouse-tasks'],
    ['warehouse-tasks-stats'],
  ],

  /** 任务出库：同时完成销售单 + 扣减库存 + 生成应收账款 */
  task_ship: [
    ['warehouse-tasks'],
    ['warehouse-tasks-stats'],
    ['sale'],
    ['inventory-stock'],
    ['inventory-logs'],
    ['inventory-overview'],
    ['inventory-containers'],
    ['dashboard-summary'],
    ['payments'],
  ],

  // ── 库存手动操作 ─────────────────────────────────────────────────────────

  /** 手动入库 / 出库 / 调整：库存数据全维度刷新 */
  inventory_change: [
    ['inventory-stock'],
    ['inventory-logs'],
    ['inventory-overview'],
    ['inventory-containers'],
    ['dashboard-summary'],
  ],

  // ── 库存盘点 ─────────────────────────────────────────────────────────────

  /** 创建 / 取消盘点单 */
  stockcheck_action: [
    ['stockcheck'],
  ],

  /** 提交盘点结果：调整容器库存，库存数据全维度刷新 */
  stockcheck_submit: [
    ['stockcheck'],
    ['inventory-stock'],
    ['inventory-logs'],
    ['inventory-overview'],
    ['inventory-containers'],
    ['dashboard-summary'],
  ],

  // ── 波次拣货 ──────────────────────────────────────────────────────────────

  /** 创建波次 */
  wave_create: [
    ['picking-waves'],
    ['warehouse-tasks'],
    ['warehouse-tasks-stats'],
  ],

  /** 波次拣货/分拣/完成 */
  wave_action: [
    ['picking-waves'],
  ],

  /** 波次完成：回写任务状态 */
  wave_finish: [
    ['picking-waves'],
    ['warehouse-tasks'],
    ['warehouse-tasks-stats'],
    ['sale'],
  ],

  // ── 调拨 ─────────────────────────────────────────────────────────────────

  /** 调拨完成：两个仓库的库存均发生变化 */
  transfer_complete: [
    ['inventory-stock'],
    ['inventory-logs'],
    ['inventory-overview'],
    ['inventory-containers'],
    ['dashboard-summary'],
  ],

  // ── 退货 ─────────────────────────────────────────────────────────────────

  /** 退货处理完成：库存与账款均受影响 */
  return_complete: [
    ['inventory-stock'],
    ['inventory-logs'],
    ['inventory-overview'],
    ['inventory-containers'],
    ['dashboard-summary'],
    ['payments'],
  ],

} as const

export type InvalidationEvent = keyof typeof INVALIDATION_MAP

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * useInvalidate
 *
 * 返回一个 invalidate(event) 函数，调用后会批量失效该事件关联的所有 queryKey。
 * 仅应在 mutation onSuccess 回调中调用。
 *
 * @example
 *   const invalidate = useInvalidate()
 *   useMutation({
 *     mutationFn: confirmSaleApi,
 *     onSuccess: () => invalidate('sale_confirm'),
 *   })
 */
export function useInvalidate() {
  const qc = useQueryClient()

  return (event: InvalidationEvent) => {
    for (const key of INVALIDATION_MAP[event]) {
      qc.invalidateQueries({ queryKey: key as readonly string[] })
    }
  }
}
