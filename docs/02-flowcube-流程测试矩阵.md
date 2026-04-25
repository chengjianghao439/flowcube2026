# FlowCube 当前流程状态说明

> 状态：生效中  
> 替代文档：`docs/legacy/02-flowcube-流程测试矩阵.v2-deprecated.md`  
> 唯一真实来源：`backend/src/constants/warehouseTaskStatus.js`

旧版 `02-flowcube-流程测试矩阵.md` 已移入 `docs/legacy`。旧文档仍保留历史测试结构，但其中销售接口、销售状态、仓库任务状态均与当前代码不一致，不得再作为验收依据。

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

更完整同步策略见 `docs/sale-warehouse-status-sync.md`。

## 旧状态污染清单

旧版 `docs/legacy/02-flowcube-流程测试矩阵.v2-deprecated.md` 中保留了以下过期描述，仅供历史追溯：

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
