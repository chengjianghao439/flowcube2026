# 批 C2 实施交接 · 2026-09-29 · 完成箱子 finish 的回执事务

> 状态：**已本地实施、后端套件 9 项全绿，并已经独立复跑接受**；本地 checkpoint 已建（提交状态以 Git 为准）。
> 本批范围**仅后端**（`packages` service/controller + `print-jobs` 查询的**可选** `exec`）。**不代表 GUI、真 PDA、物理打印。**
> 关联：C1（移出 / 作废的稳定键）见 `docs/plastic-box-batch-c1-handover-2026-09-29.md`；C3（前端丢响应 / 重挂）见 `docs/plastic-box-batch-c3-handover-2026-09-29.md`。

## 1. 修前事实（静态定位）

`packages.controller.js` 的 `finish`：
1. 用 **pool**（独立连接）`beginResourceOperationRequest`，**先于** service 的范围 / 设备仓校验；
2. `requestState.replay` 直接返回原回执 ⇒ **重放先于越权校验**命中；
3. 业务在 `svc.finishPackage` 的**自己的事务**里 commit，controller **之后**才 `completeOperationRequest` ⇒ 两步之间存在「业务已提交、回执未落」的窗口；
4. catch 用 **base action** 调 `failOperationRequest`（begin 落库的是 scoped `package.finish.<箱id>`，UPDATE 命中不了）；
5. service 在 **commit 之后**才 `buildFinishedPackagePrintResult(pool, ...)`；其内部 `getDispatchHintForJob → findById → findByIdWithExecutor` **缺行直接抛 404**（`if (!job)` 兜不住），业务已提交却让调用方拿不到结果。

## 2. 红证据（真实业务 API）

`tests/pack-finish-receipt-tx.smoke.test.js` 首轮（`/tmp/fc-pb-finish-red2.log`，`EXIT=1`，4 passed / **1 failed**）：

```
[INFO] 越权同键重放 finish=200 {"success":true, ... "printJobId":3221 ...}
[FAIL] 越权设备持原键重放 finish：应 403，而不是先命中 replay 返回原回执
```

唯一失败 = **越权设备持原键重放直接命中 replay 拿到原回执**（绕过范围 / 设备仓校验）。

> 同轮该文件还有 5 个夹具任务（1001–1005）因**验证脚本缺「已完成箱需走 `cancel-return/box` 受控拆箱」**而未 finalize（停在 `status=5`、`cancel_requested_at` 非空、自锁 0、已完成箱 1）。
> **这是验证脚本问题，不是产品缺陷**；已按真实业务接口逐任务补齐拆箱收尾，只读核对 **5/5 全部 `status=8` 且自锁 0**（脚本 `/tmp/fc-pb-c2-red1-cleanup.cjs`）。

## 3. 修复（后端最小闭环）

`packages.service.js` 的 `finishPackage` 重构为**同 conn、同事务**：

```
锁任务(task→package) → assertTaskScope（范围/设备仓**先于**幂等 begin）
  → 锁箱复查归属（peek 无锁，必须在 begin/replay 前复查，避免回放过时/越仓的原回执）
  → beginResourceOperationRequest(conn, base 'package.finish')；replay ⇒ rollback 后返回原回执
  → 已完成箱「重复完成」捷径（保留既有语义，不重复入队）
  → 业务：markPackageFinished / enqueuePackageLabelJob / createPendingWaybillTx
  → **同事务内**构建回执（读本事务刚写的 print job）→ completeOperationRequest(conn) → commit
```

- **失败即整体回滚**，**不**另开事务补失败回执：未通过范围 / 设备校验的请求不该留任何回执行；
  瞬时故障后**原键重试必须能成功**，补失败行会把重试永久挡成 409；与本模块 add / remove / void 一致（回滚即无行）。
- `packages.controller.js` 的 `finish` 不再自己 begin / complete，只透传 `requestKey` / `userId` / 范围 / 设备仓。
- **`print-jobs` 加可选 `exec`（旧调用默认 pool，行为不变）**：
  `print-jobs.query.findById(id, scope, exec = pool)`、`dispatch.getDispatchHintForJob(code, jobId, exec = pool)`；
  其中打印机 / 打印客户端读取**也走 exec**（已持事务连接时不再借 pool 第二条连接）。
  **注意**：`findByIdWithExecutor` 缺行是**抛 404**，所以事务内误用 pool 读未提交 job 的后果是**404 导致整笔回滚**，**不是**"读到 unknown"。

## 4. 测试（`tests/pack-finish-receipt-tx.smoke.test.js`，**9 项**）

结果：**9 passed / 0 failed，natural exit 0**（`/tmp/fc-pb-finish-green5.log`）。全真实业务链；夹具合法创建与收尾。

1. finish 正常：箱已完成、**回执带本事务产生的打印任务信息**（只读复核 job 真实存在且 `ref_id` = 本箱）
2. **越权设备持原键重放 → 403**（修前 200）
3. 同键重放：返回原回执且**不重复入队**
4. 无请求键旧路径：照常可用
5. 新键对已完成箱：走既有捷径，不重复入队
6. **故障注入 · commit 失败**：业务与回执全部回滚，**原键重试成功**
7. **故障注入 · 回执写入（`UPDATE operation_requests`）失败**：同上
8. **故障注入 · 回执构建读（`FROM print_jobs j LEFT JOIN printers`）失败**：同上
9. **API 成功后按原键查回执**：`finish` 返回**完整 200** 之后，按原键查
   `GET /api/system/request-status/:key?action=package.finish.<箱id>` 能取回**原箱**回执。
   **口径**：只证明「**原键查询通路可用、且绑定原箱**」，**不是**丢响应 / 切目标 / 重挂的证据（本条**没有**丢响应机制）。

故障注入**只在测试内**包装 pool 连接；**记录每条被包装连接的原 `commit`/`query` 并在 finally 逐一恢复**
（否则连接还池后带着坏方法会污染原键重试与后续收尾），且**只注入第一次**（范围内第一个写事务就是被测 finish，不误伤日志 / 审计事务）。

**受影响回归重跑**：`pack-quota` **8/8**、`pick-cancel-return` **5/5**、`pick-label-reprint-lifecycle` **3/3**、`pack-remove-void-replay` **7/7**；
改动的 4 个后端源文件 eslint **exit 0**。

## 5. 独立复跑（root，2026-09-29，非本会话自证）—— 结论：本批接受

- Node 22 实跑本套件 **9/9，natural exit 0**（`/tmp/flow-plastic-box-c2-codex-20260929.log`）；自建 **9 笔**销售夹具收尾 **9/9**；越权夹具 **1 台设备解绑 + 停用 + 有效票据 0 / 1 个仓软删**。
- 组件 9/9 natural exit 0（`/tmp/flow-plastic-box-c2-component-codex-20260929.log`）。
- root 只读复核：首轮遗留任务 1001–1005 与 red2 批次全部 `status=8`、自锁 0。

## 6. 证据边界与仍未验（如实）

- **1. 真实 GUI / 真 PDA / 物理打印未验**（C2 为后端批）。
- **2. 运单与业务一起回滚未验**：夹具**未指定承运商**，`createPendingWaybillTx` 本就不建运单 ——
  故障注入用例只能说明「本分支仍为零运单」，**不能**据此宣称「运单创建也已回滚」。
- **3. 限仓用户 `scopeWarehouseIds` 分支未实测**（越权只验了 PDA 设备仓分支，两者不互相代表）。
- **4. 真实并发未验**；本批为单机顺序场景。
- **5. `finish` 的历史回执兼容**（更早版本用 base action 落库的行）**未做专项取证**。
- **6. 改动了共用的打印任务查询**（`print-jobs.query.findById` / `dispatch.getDispatchHintForJob` 增加可选参数）：
  **发版前全量门禁仍待跑**（本轮只跑了上述受影响回归）。

## 7. 资源

- 本轮未启动常驻服务与浏览器；测试进程自起自停。共享 **3307** MySQL 保留，未触碰其它任务资源。
- 越权夹具走合法接口（建仓 / 登记设备 / 换票据），收尾**解绑 + 停用 + 软删**并**只读核对**报告。
- **未打 tag、未发布。**
