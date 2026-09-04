# 极序 Flow 当前流程状态说明

> 状态：生效中  
> 唯一真实来源：`backend/src/constants/warehouseTaskStatus.js`

## 状态数字维护规则

状态数字禁止在新文档、新代码和测试用例中手写推导。

- 后端必须引用 `backend/src/constants/warehouseTaskStatus.js` 中的 `WT_STATUS`、`WT_STATUS_NAME`、`WT_ACTION_RULES`、`WT_TRANSITIONS`。
- 前端必须引用 `frontend/src/constants/warehouseTaskStatus.ts` 或生成后的 `frontend/src/generated/status.ts`。
- 文档如果需要写状态数字，必须注明来源是 `backend/src/constants/warehouseTaskStatus.js`，并与该文件保持一致。
- 流程测试应验证状态机行为，而不是复制一份独立状态表。

## warehouse_tasks.status

| 数字 | 常量 | 名称 | 说明 |
| --- | --- | --- | --- |
| `1` | `WT_STATUS.PENDING` | 待拣货 | 保留状态；当前 `createForSaleOrder` 直接创建为 `拣货中(2)` |
| `2` | `WT_STATUS.PICKING` | 拣货中 | PDA 正在执行拣货作业 |
| `3` | `WT_STATUS.SORTING` | 待分拣 | 拣货完成，等待 Put Wall 分拣 |
| `4` | `WT_STATUS.CHECKING` | 待复核 | 分拣完成，等待复核 |
| `5` | `WT_STATUS.PACKING` | 待打包 | 复核通过，等待装箱打包 |
| `6` | `WT_STATUS.SHIPPING` | 待出库 | 打包和箱贴打印收口完成，等待出库确认 |
| `7` | `WT_STATUS.SHIPPED` | 已出库 | 出库完成，库存已扣减，应收账款已生成 |
| `8` | `WT_STATUS.CANCELLED` | 已取消 | 任务取消，释放相关锁定资源 |

## 当前主链

```text
PENDING(1) -> PICKING(2) -> SORTING(3) -> CHECKING(4) -> PACKING(5) -> SHIPPING(6) -> SHIPPED(7)
任意进行中状态 -> CANCELLED(8)
```

当前系统通常跳过 `PENDING(1)`，销售单发起出库后直接创建 `PICKING(2)` 仓库任务。

## 动作与迁移

| 动作 | 接口 / 入口 | 允许来源 | 目标状态 |
| --- | --- | --- | --- |
| 创建仓库任务 | `sale.service.ship -> warehouseTasks.createForSaleOrder` | 销售单 `已占库(2)` | `PICKING(2)` |
| 开始拣货 | `warehouseTasks.startPicking` | `PENDING(1)` 或 `PICKING(2)` | `PICKING(2)` |
| 拣货完成 | `warehouseTasks.readyToShip` | `PICKING(2)` | `SORTING(3)` |
| 分拣完成 | `warehouseTasks.sortTask` | `SORTING(3)` | `CHECKING(4)` |
| 复核完成 | `warehouseTasks.checkDone` / 复核扫码自动收口 | `CHECKING(4)` | `PACKING(5)` |
| 打包完成 | `warehouseTasks.packDone` / `packages.finishPackage` | `PACKING(5)` | `SHIPPING(6)` |
| 出库确认 | `warehouseTasks.ship` | `SHIPPING(6)` | `SHIPPED(7)` |
| 取消任务 | `warehouseTasks.cancel` | 进行中状态 | `CANCELLED(8)` |

## 销售单状态与仓库任务状态关系

销售单状态是订单级粗粒度状态；仓库任务状态是履约作业主状态。

| 仓库任务状态 | 销售单状态 | 说明 |
| --- | --- | --- |
| `SORTING(3)` | `sale_orders.status = 3` 拣货中 | 销售单仍表示仓库履约中 |
| `CHECKING(4)` | `sale_orders.status = 3` 拣货中 | 真实阶段以仓库任务状态为准 |
| `PACKING(5)` | `sale_orders.status = 3` 拣货中 | 前端必须展示履约状态，不能只看销售状态 |
| `SHIPPING(6)` | `sale_orders.status = 3` 拣货中 | 待出库不是销售单状态 |
| `SHIPPED(7)` | `sale_orders.status = 4` 已出库 | 出库完成后通过销售服务主入口同步 |
| `CANCELLED(8)` | `sale_orders.status = 5` 已取消 | 取消同步必须走销售服务主入口 |

更完整的状态同步逻辑以 `warehouse-tasks` / `sale` 服务代码为准。

## 旧状态污染清单

以下过期描述仅供历史追溯：

| 旧描述 | 当前正确值 |
| --- | --- |
| `warehouse_tasks.status = 1（待分配）` | `1` 是 `待拣货`，且当前创建任务通常直接进入 `2 拣货中` |
| `2（备货中）` | `2` 是 `拣货中` |
| `3（待出库）` | `3` 是 `待分拣` |
| `4（已出库）` | `4` 是 `待复核` |
| `5（已取消）` | `5` 是 `待打包` |
| `ship` 要求 `status=3` | 当前 `ship` 只允许 `SHIPPING(6)` |
| `ship 后 warehouse_tasks.status=4` | 当前出库完成为 `SHIPPED(7)` |
| `sale_orders.status=3（已出库）` | 当前销售单 `3` 是 `拣货中/仓库履约中`，`4` 才是 `已出库` |
| `sale_orders.status=4（已取消）` | 当前销售单取消为 `5` |

## 回归测试重点

- 创建销售出库任务后，仓库任务应为 `PICKING(2)`。
- 拣货完成只能从 `PICKING(2)` 推进到 `SORTING(3)`。
- 分拣完成只能从 `SORTING(3)` 推进到 `CHECKING(4)`。
- 复核完成只能从 `CHECKING(4)` 推进到 `PACKING(5)`。
- 打包完成必须在箱子和箱贴打印收口后推进到 `SHIPPING(6)`。
- 出库确认只能从 `SHIPPING(6)` 推进到 `SHIPPED(7)`。
- 非法跳跃必须被 `WT_ACTION_RULES` / `WT_TRANSITIONS` 阻断。
- 销售侧页面必须展示仓库任务状态作为真实履约状态。

## 销售订单完整性回归

- 新建和草稿编辑必须保留整单折扣、行级仓库和正小数数量；数量最多 4 位小数，单位折算后不得舍入为零，折扣不得超过订单原值。
- 客户、仓库、商品、承运商及商品身份快照必须由服务端当前启用主数据生成，伪造客户端名称不能写入。
- 限仓用户不能创建、查看、占库、发货、取消或删除包含范围外明细仓库的订单。
- ATP 弹窗分别展示 ACTIVE 实物、已占、预计到货与可承诺量；不足行不得提交，0 实物只有在合法预计库存支撑时才能形成预计预占，实际出库仍禁止负库存。
- 发起出库支持 `items: [{ id, qty }]` 按行按量分批；数量不得超过 `reserved_qty - dispatched_qty`，不存在、重复或已不可发的明细必须整体拒绝。
- 同商品分仓时，扫描记录按仓库任务和商品共同归属，不能复制到另一仓同商品明细。
- 应收和授信按折后净额计算；分批出库按已发原值比例分摊折扣，出库授信复查扣除本单已收款。
- 已部分出库后关闭剩余，保留实发明细、按实发比例保留折扣并在同一事务重算应收。
- 占库期或执行期减量后若原折扣超过新货款必须拒绝；销售关联仓库任务从任务入口单独取消必须返回 `SALE_ORDER_CANCEL_REQUIRED`，整单取消仍可统一处理全部任务与预占。
- 占库、释放、发货、取消和删除的幂等 action 必须绑定销售单 ID；同一请求键用于另一张订单时不能重放前一单结果。
- 已批准授信放行只有在客户、额度、本单净额仍与审批快照一致且当前超额不超过获批值时生效；编辑增额或换客户后必须重新审批。
- 占库、释放、发货、取消、删除的重复请求不得重复改变库存、状态或账款；危险操作先经过专用弹窗或详情核对。


### 销售复核补充（2026-09-05）

销售改单回归增加：执行期改单后 quantity/reserved_qty/dispatched_qty 对齐；同键重试返回原回执；单任务部分派发和同仓多任务改单均返回 409 且任务量不变；额度刚好足够时部分占库、预检、补占均成功。前端数量回归包含 0.3−0.1 的默认剩余量及超四位小数拒绝。仪表盘查看模式使用保存宽度。

待归还改单需验证：确认前 reserved_qty 保留实际预占，确认后与预占账同事务减少，dispatched_qty 为调整后的目标。


## 仪表盘与销售列表第二版只读回归

`tests/dashboard-sales-v2.smoke.test.js` 在独立测试库核对：销售状态计数不受分页/当前状态限制但遵守仓库范围；多基本单位不混算，小数数量保留；待处理含部分占库；应收到期桶覆盖昨天、今天、未来第 1/7/8 天和未知日期，未清金额总额守恒。前端 `salePresentation.test.ts` 覆盖未占量不冒充缺货、取消/待归还优先级。

真实数据优化补充：`dashboard-sales-v2.smoke.test.js` 增加待办按创建时间/待审批优先排序、完成单排除、授信超限分页、低库存 23 项以上完整总数和跨页不重复、空仓库范围校验；`receivableStatus.test.ts` 校验无账款不显示逾期、已付清/部分付语义保持。
