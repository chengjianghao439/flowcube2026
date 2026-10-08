import { Route } from 'react-router-dom'
import { PdaProtectedRoute, PdaGuestRoute } from './PdaAuthRoutes'
import PdaLayout from '@/layouts/PdaLayout'
import PdaRoutePermission from '@/components/pda/PdaRoutePermission'
import { PERMISSIONS } from '@/lib/permission-codes'
import PdaBindingHydrationGate from './PdaBindingHydrationGate'
import {
  PdaLoginPage,
  PdaIndexPage,
  PdaPickingPage,
  PdaTaskPage,
  PdaInboundPage,
  PdaReceivePage,
  PdaPutawayPage,
  PdaCheckPage,
  PdaPackPage,
  PdaStockcheckPage,
  PdaSplitPage,
  PdaFillPage,
  PdaPlasticBoxPage,
  PdaSplitRecoveryPage,
  PdaBindPage,
  PdaShipPage,
  PdaSortPage,
  PdaSaleReturnListPage,
  PdaSaleReturnReceivePage,
  PdaSaleReturnPutawayPage,
  PdaCancelReturnPage,
  PdaAdjustmentPage,
  PdaTransferPage,
  PdaTransferOutPage,
  PdaTransferInPage,
  PdaInventoryQueryPage,
} from './pdaPages'

// ERP 浏览器与独立 PDA 构建共用同一份路由、认证及权限定义。
export function pdaRoutes() {
  return <>
          <Route element={<PdaBindingHydrationGate />}>
          {/* ── PDA 游客路由 ── */}
          <Route element={<PdaGuestRoute />}>
            <Route path="/pda/login" element={<PdaLoginPage />} />
          </Route>

          {/*
            PDA 必须挂在 path="/pda" 树下（相对子路径），不能写一堆绝对路径 /pda/xxx 挂在无 path 的父级上，
            否则在部分 React Router 版本里会与 ERP 的 path="/*" 抢匹配，误入 AppLayout →「页面未注册」。
          */}
          <Route path="/pda" element={<PdaProtectedRoute />}>
            <Route element={<PdaLayout />}>
              <Route index element={<PdaIndexPage />} />
              <Route path="inbound" element={<PdaRoutePermission title="收货订单" required={[PERMISSIONS.INBOUND_ORDER_VIEW]}><PdaInboundPage /></PdaRoutePermission>} />
              <Route path="receive/:id" element={<PdaRoutePermission title="收货登记" required={[PERMISSIONS.INBOUND_ORDER_VIEW, PERMISSIONS.INBOUND_RECEIVE_EXECUTE]}><PdaReceivePage /></PdaRoutePermission>} />
              <Route path="putaway/:id" element={<PdaRoutePermission title="扫码上架" required={[PERMISSIONS.INBOUND_ORDER_VIEW, PERMISSIONS.INBOUND_PUTAWAY_EXECUTE]}><PdaPutawayPage /></PdaRoutePermission>} />
              <Route path="putaway" element={<PdaRoutePermission title="扫码上架" required={[PERMISSIONS.INBOUND_ORDER_VIEW, PERMISSIONS.INBOUND_PUTAWAY_EXECUTE]}><PdaPutawayPage /></PdaRoutePermission>} />
              <Route path="picking" element={<PdaRoutePermission title="拣货任务" required={[PERMISSIONS.WAREHOUSE_TASK_VIEW, PERMISSIONS.WAREHOUSE_TASK_PICK]}><PdaPickingPage /></PdaRoutePermission>} />
              <Route path="task/:id" element={<PdaRoutePermission title="扫码拣货" required={[PERMISSIONS.WAREHOUSE_TASK_VIEW, PERMISSIONS.WAREHOUSE_TASK_PICK]}><PdaTaskPage /></PdaRoutePermission>} />
              <Route path="check/:id" element={<PdaRoutePermission title="复核作业" required={[PERMISSIONS.WAREHOUSE_TASK_VIEW, PERMISSIONS.WAREHOUSE_TASK_CHECK]}><PdaCheckPage /></PdaRoutePermission>} />
              <Route path="check" element={<PdaRoutePermission title="复核作业" required={[PERMISSIONS.WAREHOUSE_TASK_VIEW, PERMISSIONS.WAREHOUSE_TASK_CHECK]}><PdaCheckPage /></PdaRoutePermission>} />
              <Route path="pack/:id" element={<PdaRoutePermission title="打包作业" required={[PERMISSIONS.WAREHOUSE_TASK_VIEW, PERMISSIONS.WAREHOUSE_TASK_PACK]}><PdaPackPage /></PdaRoutePermission>} />
              <Route path="pack" element={<PdaRoutePermission title="打包作业" required={[PERMISSIONS.WAREHOUSE_TASK_VIEW, PERMISSIONS.WAREHOUSE_TASK_PACK]}><PdaPackPage /></PdaRoutePermission>} />
              {/* 塑料盒作业：扫 B 还原整件（主语义）；旧 I→散件盒方向保留为同页另一分支 */}
              <Route path="split" element={<PdaRoutePermission title="塑料盒作业" required={[PERMISSIONS.INVENTORY_CONTAINER_SPLIT]}><PdaSplitPage /></PdaRoutePermission>} />
              <Route path="plastic-box" element={<PdaRoutePermission title="塑料盒作业" required={[PERMISSIONS.INVENTORY_CONTAINER_SPLIT]}><PdaPlasticBoxPage /></PdaRoutePermission>} />
              {/* 本人原拆分查询沿request-status契约；设备仍必需，重试在页面和handler守原SPLIT。 */}
              <Route path="split-recovery" element={<PdaRoutePermission title="拆分结果核对" required={[]}><PdaSplitRecoveryPage /></PdaRoutePermission>} />
              {/* 放货：扫整件来源 → 扫目标盒 → 全部放入 */}
              <Route path="fill" element={<PdaRoutePermission title="塑料盒放货" required={[PERMISSIONS.INVENTORY_CONTAINER_SPLIT]}><PdaFillPage /></PdaRoutePermission>} />
              <Route path="stockcheck/:id" element={<PdaRoutePermission title="扫码盘点" required={[PERMISSIONS.STOCKCHECK_VIEW]}><PdaStockcheckPage /></PdaRoutePermission>} />
              <Route path="stockcheck" element={<PdaRoutePermission title="扫码盘点" required={[PERMISSIONS.STOCKCHECK_VIEW]}><PdaStockcheckPage /></PdaRoutePermission>} />
              {/* 设备绑定不挂业务权限：任何能登录 PDA 的操作员都要能绑定，
                  否则会陷入「没绑定 → 请求被拒 → 绑不了」的死结 */}
              <Route path="bind" element={<PdaBindPage />} />
              <Route path="ship/:id" element={<PdaRoutePermission title="出库确认" required={[PERMISSIONS.WAREHOUSE_TASK_SHIP]}><PdaShipPage /></PdaRoutePermission>} />
              <Route path="ship" element={<PdaRoutePermission title="出库确认" required={[PERMISSIONS.WAREHOUSE_TASK_SHIP]}><PdaShipPage /></PdaRoutePermission>} />
              <Route path="sort" element={<PdaRoutePermission title="分拣作业" required={[PERMISSIONS.SORTING_BIN_VIEW, PERMISSIONS.WAREHOUSE_TASK_SORT]}><PdaSortPage /></PdaRoutePermission>} />
              <Route path="cancel-return" element={<PdaRoutePermission title="拣货退回" required={[PERMISSIONS.WAREHOUSE_TASK_CANCEL_RETURN_VIEW]}><PdaCancelReturnPage /></PdaRoutePermission>} />
              <Route path="cancel-return/:id" element={<PdaRoutePermission title="拣货退回确认" required={[PERMISSIONS.WAREHOUSE_TASK_CANCEL_RETURN_VIEW, PERMISSIONS.WAREHOUSE_TASK_CANCEL_RETURN]}><PdaCancelReturnPage /></PdaRoutePermission>} />
              <Route path="adjustments" element={<PdaRoutePermission title="改单确认" required={[PERMISSIONS.WAREHOUSE_TASK_ADJUST_VIEW]}><PdaAdjustmentPage /></PdaRoutePermission>} />
              <Route path="adjustments/:id" element={<PdaRoutePermission title="改单确认" required={[PERMISSIONS.WAREHOUSE_TASK_ADJUST_VIEW, PERMISSIONS.WAREHOUSE_TASK_ADJUST]}><PdaAdjustmentPage /></PdaRoutePermission>} />
              <Route path="transfer" element={<PdaRoutePermission title="调拨执行" required={[PERMISSIONS.TRANSFER_ORDER_VIEW]}><PdaTransferPage /></PdaRoutePermission>} />
              <Route path="transfer-out/:id" element={<PdaRoutePermission title="调出仓扫码出库" required={[PERMISSIONS.TRANSFER_ORDER_VIEW, PERMISSIONS.TRANSFER_ORDER_EXECUTE]}><PdaTransferOutPage /></PdaRoutePermission>} />
              <Route path="transfer-in/:id" element={<PdaRoutePermission title="调入仓扫码入库" required={[PERMISSIONS.TRANSFER_ORDER_VIEW, PERMISSIONS.TRANSFER_ORDER_EXECUTE]}><PdaTransferInPage /></PdaRoutePermission>} />
              {/* 只读库存查询（无决策入口）：仅需库存查看权限 */}
              <Route path="inventory-query" element={<PdaRoutePermission title="库存查询" required={[PERMISSIONS.INVENTORY_VIEW]}><PdaInventoryQueryPage /></PdaRoutePermission>} />
              <Route path="sale-return" element={<PdaRoutePermission title="销售退货" required={[PERMISSIONS.RETURN_ORDER_VIEW]}><PdaSaleReturnListPage /></PdaRoutePermission>} />
              <Route path="sale-return/:id/receive" element={<PdaRoutePermission title="退货收货" required={[PERMISSIONS.RETURN_ORDER_VIEW, PERMISSIONS.RETURN_ORDER_EXECUTE]}><PdaSaleReturnReceivePage /></PdaRoutePermission>} />
              <Route path="sale-return/:id/putaway" element={<PdaRoutePermission title="退货上架" required={[PERMISSIONS.RETURN_ORDER_VIEW, PERMISSIONS.RETURN_ORDER_EXECUTE]}><PdaSaleReturnPutawayPage /></PdaRoutePermission>} />
            </Route>
          </Route>

          </Route>

  </>
}
