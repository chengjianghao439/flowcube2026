# 待上架待办与超时提醒失效（2026-09-16）

## 现象

「收完货没人上架」这件事在系统里没有任何提示：

- 岗位工作台/待办的「待上架」卡片**永远是 0 条**；
- 通知中心的「X 箱打印后未上架超时」**从来没有出现过**。

生产证据：2 张收货单（`IT20260401001`、`IT20260401002`）各压着 1 个待上架容器，
从 2026-04-01 创建至今 5 个多月，没有任何提醒把它们捞出来。

## 根因

四处查询把待上架容器的状态写成了 `0`，而**容器状态只有 1..6，没有 0**
（`CONTAINER_STATUS`：1 ACTIVE / 2 EMPTY / 3 VOID / **4 PENDING_PUTAWAY** / 5 PENDING_QA / 6 REJECTED）。
条件恒不成立，查询恒返回空。

| 位置 | 影响 |
|---|---|
| `modules/reports/reports.query.js` 的 `waitingPutawayCount` | 工作台「待上架」卡片计数恒为 0 |
| `modules/reports/reports.query.js` 的 `waitingPutawayRows` | 同上，明细列表恒为空 |
| `modules/notifications/notifications.service.js` 的 `overdueInboundPutaway` | `INBOUND_PUTAWAY_TIMEOUT` 通知永不产生 |
| `modules/notifications/notifications.service.js` 的 `putawayTimeoutTarget` | 同上，通知的跳转目标也永远拿不到 |

对照：入库任务列表的「待上架」数字（`inbound-tasks.query.js` 的 `waiting_containers`）
用的是常量 `CONTAINER_STATUS.PENDING_PUTAWAY`，**一直是对的**——只有待办/通知/报表这一侧写错。

已核对容器表实际取值：生产库只有 1/3/4，本地库只有 1/2/3/4/6，**没有任何 status=0 的记录**，
不存在"这是为某种历史状态而写"的可能。

## 修复

四处改为引用 `CONTAINER_STATUS.PENDING_PUTAWAY` 常量（参数化查询），不再写数字字面量。
顺带修掉同一批改动引入的一处文案瑕疵：PDA 上架页对「还没开始收货(1)」的单也提示"短装结案"，
而结案要求已有实收数量、这时不适用，改为按状态分别提示。

## 测试与验证

- `tests/workbench.test.js` 新增回归：断言工作台与通知发出的容器查询**不得出现 `status = 0`**，
  且待上架查询的参数必须含 `4`。该用例在修复前的代码上失败（已实测）。
- 实测（本地开发库，2026-09-16）：
  - `GET /api/reports/role-workbench` 的 `warehouse-putaway` 卡片由恒为 0 变为 **878 条**，
    并列出具体容器、带「超时」徽章与跳转路径；
  - `GET /api/notifications` 出现 `INBOUND_PUTAWAY_TIMEOUT`：「877 箱打印后未上架超时」。
- 补跑相关回归：`smoke:reports`、`smoke:reports-values`(60)、`smoke:warehouse-ops`(39)、
  `smoke:pda-device-session`(28)、`smoke:mainline`(49) 全绿；`test:workbench` 3/3。

## 边界

- 修好的是"提示是否出现"，**不改变**任何库存或单据状态。
- 提醒阈值仍是既有的 `putawayTimeoutHours` / `putaway_deadline_at`，未调整。
- 生产上那 2 张 5 个月的老单本身没有被这次修复处理，它们只是从此会出现在待办与提醒里；
  要不要上架、作废或清理，属于业务决定。
