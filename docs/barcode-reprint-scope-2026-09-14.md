# 补打中心改为「打印记录」口径（2026-09-14）

## 背景与用户决定

用户在补打中心看到从未打印过的塑料盒 `B000001` 也带着补打按钮，点下去系统就凭空生成了一条
打印任务（任务 198，16:31:58）。查明原因后用户明确决定：

> 改为补打中心**严格等于「打印记录」**

## 原实现为什么会出现「没打过的也在列表里」

- 入库条码列表直接读 `inventory_containers`（`LEFT JOIN` 每个容器最近一条打印任务），
  出库条码读 `packages`，物流条码才直接读 `print_jobs`；
- 页面默认状态筛选是「全部」，后端不传 `status` 时不加状态条件 → **所有容器/箱子**都列出；
- 服务端对入库/出库记录恒返回 `canReprint: true`，所以「未生成打印任务」的行也能点补打，
  点下去 `reprintInboundBarcode()` 不区分对象类型、也不要求原有打印记录，直接建新任务。

这套「台账 + 丢失补打」设计本来是有意的：收货时若没有可用打印机，容器不会生成打印任务，
而回执提示现场「稍后补打」。用户判断这个语义太绕，要求改为纯粹的重打。

## 本次改动

**列表范围（`backend/src/modules/print-jobs/print-jobs.query.js`）**

- 入库：`AND pj.id IS NOT NULL`（列表与计数各一处）
- 出库：`AND pj.id IS NOT NULL`（列表与计数各一处）
- 物流本就取自 `print_jobs`，无需改动

**补打接口（`backend/src/modules/print-jobs/print-jobs.label-command.js`）**

- `reprintInboundBarcode`：按容器查 `EXISTS(print_jobs …)`，无记录返回 400
  `PRINT_BARCODE_NO_PRINT_RECORD`
- `reprintOutboundBarcode`：同样校验箱贴是否有过打印任务

**顺带修掉的既有缺陷**：出库**计数**查询里最新任务子查询别名写成了 `j`，而状态条件
`genericStatusClause(status, 'pj')` 按 `pj` 拼——只要给「出库条码」加任何状态筛选，
计数查询就会报 `Unknown column 'pj.status' in 'where clause'`。现已把别名统一为 `pj`，
回归里加了一条带状态筛选的出库查询。

**前端（`frontend/src/pages/settings/barcode-print-query/`）**

- 状态筛选项移除「未生成任务」（三类都不再可能命中）
- 三个类目的说明文案统一改为「打印记录与补打」

**文案（`frontend/src/pages/pda/receive.tsx`、`sale-return-receive.tsx`）**

- 收货无打印机时的提示改为指向**本单**的「查看打印 / 补打」，不再指向补打中心
- 退货收货的提示不再承诺一个具体入口（原因见下方缺口）

## 验证

在本地临时 MySQL（`mysql:8.0`，colima-flowcube）上新建独立测试库
`flowcube_print_test`，跑完整迁移（241 个文件）后执行 CI 的打印队列回归
`npm run smoke:print-queue`：

```
[PASS] 补打中心只列有打印记录的对象，从未打印过的不出现
[PASS] 补打接口只接受有打印记录的对象
[PASS] 出库箱贴同样只列有打印记录的对象
11 passed, 0 failed
```

覆盖矩阵：塑料盒/库存容器 × 有任务/无任务、箱贴 × 有任务/无任务，以及
`reprintInboundBarcode` 与 `reprintOutboundBarcode` 的拒绝与放行、出库带状态筛选的计数查询。
另有：后端 `eslint src/` 无错误、前端 `tsc --noEmit` 通过、`eslint` 0 error、
`build`/`build:pda` 通过、`receive.test.tsx` 3/3。临时容器与临时文件已清理。

## 已知缺口（需要下一步处理）

先澄清一条容易误读的边界：**入库条码列表只要求「有打印记录」，不要求「属于收货单」**。
退货等其它来源的容器同样是 `inventory_containers` 行，只要打过标签就在列表里、就能重打
（只是没有关联收货单号，行上不显示业务单号）。所以「找到打印记录 → 对应标签 → 重新打印」
这条常规路径对退货**同样成立**。

真正的缺口只有一个：**从未生成过打印记录的容器**（退货收货时没有可用打印机 → 压根没建任务）。
这时不是「找不到记录」，而是「没有记录可找」，只能靠业务单据侧的入口：

- 收货订单：有「整单 / 明细 / 条码补打」（`POST /api/inbound-tasks/:id/reprint`，
  按任务取容器，不要求原有任务）—— 覆盖完整。
- **退货任务：没有这个入口**（ERP 退货详情与 PDA 退货页都没有，后端也没有对应路由）。
  退货容器若在收货时因无可用打印机而未生成任务，改了本口径后**再也无法补打**。

建议补一个退货任务的补打入口（复用 `queueReturnLabels`，在 ERP 退货详情或 PDA 退货收货页
提供「补打容器标签」），与收货侧对称。本次未实现——属于新增入口，等用户确认形态后再做。

## 未做

- 真机打印未复测（本次只改列表范围、接口校验与文案）。
- 未把「无可用打印机」的容器改成先建任务后补打（需要 `print_jobs.printer_id` 允许为空，
  属迁移级改动），因此上述缺口用业务单据入口覆盖。
