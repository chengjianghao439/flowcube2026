# PDA 部分收货被锁死（2026-09-16）

## 现象

用户在 PDA 上收一张**两项商品**的收货订单：收完第一项、标签也打出来了，页面随即跳到
「收货已完成，该订单已进入上架阶段。」——第二项商品再也找不到收货入口，标签也打不出来。

## 现场证据（生产）

生产收货单 `IN20260914001`（`inbound_tasks.id=7`，2026-09-14 创建）：

| 项目 | 值 |
|---|---|
| 任务状态 | `status=2`（收货中），`audit_status=0` |
| 明细行 | 2 行 |
| 第 1 行（商品 169） | 应到 12 / 已收 12（已收满） |
| 第 2 行（商品 162） | 应到 23 / **已收 0**（一件没收） |
| 容器 | 1 个，`I1001111112`，`status=4`（待上架），12 件 |
| 打印任务 | 1 条（`print_jobs.id=199`，状态 2 成功） |

事件流（`inbound_task_events`）：

```
09-14 16:11 created            创建收货单
09-14 16:12 submitted_to_pda   提交到 PDA
09-15 14:16 receive_started    开始收货
09-15 14:16 receive_recorded   商品 169 登记 1 箱共 12 件
09-15 14:16 print_queued       提交打印
09-15 14:16 print_completed    打印完成 I1001111112
（此后无任何记录——商品 162 的 23 件从未收货）
```

生产共 7 张收货单，**只有这一张是多个明细行**，这解释了该缺陷为何长期未被发现。

## 根因

能否继续收货被前端按**「是否有容器在等上架」**判断，而这个条件每收一箱就成立：

- `inbound-tasks.query.js` 的 `waiting_containers` = `inventory_containers.status=4`（待上架）计数；
- `inbound-tasks.status.js` 的 `buildPutawayStatus()` 只要 `waitingContainers > 0` 就返回 `waiting`；
- 于是 `frontend/src/pages/pda/receive.tsx` 的
  `task.putawayStatus?.key === 'waiting' || 'putting_away'` 在**部分收货**时即成立，
  整页被替换成"收货已完成"。
- 同一时刻上架页 `putaway.tsx` 按 `task.status < 3` 判断，又显示"收货尚未完成，完成后即可上架"，
  现场被卡在两个页面之间，双向都进不去。

`frontend/src/pages/pda/inbound.tsx` 的列表卡片用同一判据，把「开始收货」按钮换成「扫码上架」，
使第二项商品连列表入口都没有。

**权威判据是任务状态**：后端只在**全部明细行收满**时才把任务从 2 推进到 3
（`inbound-tasks.command.js` 的 `allReceived` → `receiveComplete`），上架页本来就用 `task.status`。

## 修复

前端三处判据统一为任务状态（后端无需改动，`receive` 本来就允许状态 1/2）：

| 文件 | 改动 |
|---|---|
| `pages/pda/receive.tsx` | 拦截条件改为 `task.status >= 3`；文案按 3/4/5 区分；待上架状态补「扫码上架」入口 |
| `pages/pda/inbound.tsx` | 卡片按钮与跳转目标改为 `task.status === 3` |
| `pages/pda/putaway.tsx` | 未改动（原本就用 `task.status`，现三处一致） |

回归测试：

- `pages/pda/receive.test.tsx`：夹具补上真实的 `putawayStatus.key`（此前缺失，导致该分支在单测里
  从未被触发），新增「部分收货仍能继续收剩下的商品」「任务推进到待上架后才收起收货界面」两条。
- `pages/pda/inbound.test.tsx`（新增）：卡片入口按任务状态给出，且点击跳转目标正确。

两条新用例在修复前的代码上均失败（报错文案正是用户看到的"收货已完成，该订单已进入上架阶段"），
修复后通过。

## 验证

- 前端全量单测 76 文件 / 377 用例通过（Node 22）；lint 0 error（5 条存量 warning）；`tsc` 0 错误。
- 本地开发者模式页面验收（`flowcube_dev8` 库，收货单 `IT20260902015`：应到 100 / 已收 32 /
  3 个待上架容器）：
  - 列表页：该单显示「开始收货」（同类中已收满 100% 的单显示「扫码上架」）；
  - 收货页：正常渲染逐箱录入与「打印并登记」；
  - **前后对比**：临时还原修复前代码，同一页面显示「收货已完成，该订单已进入上架阶段。」；
  - 真实提交 1 件：已收 32→33、待上架容器 3→4、打印状态变「待派发」，页面保持可继续收货。
- 已发生的数据副作用：本次验收在本地开发库对测试单提交了 1 件；生产数据未做任何写入。

## 规则完善：收满才能上架（同日追加，用户确定）

前端修好后，「收满才能上架」仍只守在前端——服务端 `putaway` 的 `from` 一直含 2，未收满也能上架。
排查后确认这不是有意开口子，而是历史宽松：

- PDA 上架页自 **v0.1.2** 起就按 `task.status < 3` 拦着，**现场走不到**这条路径；
- 进入「待上架(3)」本就有两条正规路径：全部明细行收满自动推进，或供应商短装时走 ERP「短装结案」
  （结案入口的界面文案即"剩余未收数量作罢，进入待上架，可正常上架已收到的部分"）；
- 只有 API 直连能绕过——本地测试数据里就有 `status=2` 却已上架容器的单，
  `tests/p1-regression` 的短装场景也依赖了这条宽松。

改动：

| 位置 | 改动 |
|---|---|
| `backend/src/constants/documentStatusRules.js` | `putaway.from` 由 `[2, 3]` 收紧为 `[3]`；补 `blocked[2]` 文案，指引"继续收货 / 由 ERP 短装结案"两条出路 |
| `frontend/src/pages/pda/putaway.tsx` | 未收满时的空态由"待上架/收货尚未完成，完成后即可上架"改为明确的「收货尚未完成」，并写出短装结案这条出路 |
| `tests/status-rules-integrity.test.js` | 纯函数断言：上架只从 3 发起、2 被拒且文案含两条出路、3 放行 |
| `tests/p0-regression.smoke.test.js` | 端到端断言：短装结案**之前**上架必须被 400 拒绝（收紧前会放行） |
| `tests/p1-regression.smoke.test.js` | 短装场景改走正确业务路径：先 `close-receiving` 再上架（它此前依赖 `from` 含 2） |

上架入口 `assertTaskCanPutaway` 全仓只有一处调用（`inbound-tasks.putaway.js`），
管理员补录 `/api/admin/putaway` 复用同一个 service，因此这次收紧覆盖全部上架入口，无旁路。

**对生产的影响面为 0**：收紧前生产库中「任务未收满却已有已上架容器」的记录数为 **0**（只读查询），
不存在因规则变更而被卡住的存量单。

## 边界

- 任务进入 `status=3` 后仍不能再收货；需要补收只能走撤回收货（`void-receipt`，容器被后续动作碰过时会被拒绝）。
- 供应商短装是"收满才能上架"的正规出口：先由 ERP 短装结案，再上架已收到的部分。
- 上架页、工作台「扫码上架」入口与本次改动无冲突；`putaway.tsx` 按 `task.status` 判定。
