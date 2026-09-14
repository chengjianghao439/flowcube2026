# PDA 收货 403 PDA_ONLY 排查（2026-09-14）

## 结论

PDA 上「打印并登记」收货失败，不是打印机的问题，而是**前端收货接口没带 `X-Client: pda`**，
被后端 `pdaOnly` 守卫拒成 403 —— 提示文案是「此操作仅允许 PDA 扫码完成」。

根因是 2026-08-09 给收货路由加守卫时漏改客户端，**从那天起 PDA 收货在生产里完全不可用**，
而打印任务、打印机配置都是正常的（当天 16:31 还成功打过一张容器标签）。

## 现象

- 现场在 PDA 上做收货，点「打印并登记」（该按钮同时负责建容器 + 入队标签）失败，
  提示与「PDA」有关，让用户以为要换设备/换打印机。
- 收货订单 `IN20260914001`（task 7）当天始终没有产生任何容器，`received_qty` 全为 0。
- 同一时间打印机绑定、打印任务都正常：9/14 的 7 条打印任务全部 `status=2`（已打印），
  含 16:31:58 的容器标签 `B000001`。

## 证据

`POST /api/inbound-tasks/7/receive` 在 16:12:49–16:14:11 被连试 6 次，全部 403：

```sql
SELECT status_code, COUNT(*) FROM operation_logs WHERE path LIKE '%/receive' GROUP BY status_code;
-- 403 | 6   （全表只有这 6 条，即该接口从未成功过）
```

后端日志同一秒给出过程：

```
[16:12:49] [INFO] [PDASession] PDA device session accepted {route:/api/inbound-tasks/7/receive,
            userId:1, deviceCode:PDA-260828-3666, warehouseId:null}
[16:12:49] [WARN] [ERR] [AppError] 此操作仅允许 PDA 扫码完成
            {code:"PDA_ONLY", statusCode:403}
```

即：请求**确实来自 PDA App**（设备票据有效、`pdaSessionRequired` 已通过、设备 `last_seen_at`
正好停在那次请求），失败发生在紧随其后的 `pdaOnly`。

## 根因

- 路由（`backend/src/modules/inbound-tasks/inbound-tasks.routes.js:120`，2026-08-09 提交 `59524b2c` 加守卫）：

  ```js
  router.post('/:id/receive', requirePermission(...), pdaSessionRequired(), pdaOnly, validateBody(...), ctrl.receive)
  ```

- `pdaOnly`（`backend/src/middleware/pdaOnly.js`）要求请求头 `X-Client: pda`，否则 403 `PDA_ONLY`。
- 前端 `receiveInboundApi`（2026-04-19 的代码，早于该守卫）只带幂等键头，**从来不带 `X-Client`**；
  紧邻的 `putawayInboundApi` 带了，所以上架路径没被同样挡住。
- `frontend/src/api/client.ts` 里已经有注释点破这个隐患：「X-Client 就是逐个手加的，很容易漏」——
  当时用的是全局注入 `X-PDA-Session`，`X-Client` 仍靠各接口手加，于是漏了收货这一处。

影响面：PDA 收货是入库链路的入口，被挡住即当天无法收货、无法生成容器、无法进入上架。
2026-08-15 起的 `operation_logs` 里 `/receive` 零成功、`/putaway` 零调用，与此一致。

## 修复

- `frontend/src/api/inbound-tasks.ts`：`receiveInboundApi` 与上架接口保持一致，
  幂等键与 `X-Client: pda` 一起下发（`withRequestKeyHeaders(requestKey, { 'X-Client': 'pda' })`）。
- `tests/pda-only-client-header.test.js`（新增，静态契约测试）：解析后端所有挂 `pdaOnly`
  的路由，逐个比对前端 `frontend/src/api/*.ts` 里的同名调用是否带 `X-Client: pda`；
  并单独钉死收货接口。已接入 Tests CI 静态作业。
- `AGENTS.md` 第 8 节：把「PDA-only 写操作同时遵守 X-Client / 设备会话 / 绑定仓」补充为
  必须跑该契约测试的显式要求。

## 验证

| 验证项 | 结果 |
|---|---|
| 新契约测试（修复前） | 红：`POST /inbound-tasks/:param/receive ← inbound-tasks.ts` 缺头 |
| 新契约测试（修复后） | 绿：3/3，全覆盖现有 pdaOnly 路由，未发现第二处遗漏 |
| 前端 `tsc -p frontend/tsconfig.app.json --noEmit` | 通过 |
| 前端 `eslint` | 0 error（5 个既有 warning，均在无关 ui 组件） |

本机验证只覆盖静态契约与类型/lint；**真机收货尚未验证**，需要发布后在实际 PDA 上走一遍。

## 尚未完成（必须发布才能恢复现场）

PDA App 是 Capacitor 打包的（前端随 APK 分发），所以：

- 只推 main 只会更新浏览器，**不会**让现场 PDA 拿到新前端；
- 需要按 `release-flowcube` 发版并发布新 APK，现场在 PDA 内更新后收货才会恢复。
- 若必须在不更新 APK 的前提下立刻恢复，只能改服务端（例如让 `pdaOnly` 认可已通过
  `pdaSessionRequired` 的设备会话），这属于放宽既有守卫，需用户明确决定，本次未做。
