# 第二轮调拨修复与验证（2026-09-05）

对应原始审计 `docs/prelaunch-second-audit-2026-09-05.md` 的 R2-01、R2-05、R2-06、R2-07。原始探针与证据保留于 `docs/audit-round2-2026-09-05/transfer-*`；本文记录工作区实现和本次隔离验证，不表示已提交、发布或修复生产历史单据。

## 现行规则与实现

- **R2-01**：正常完成必须同时满足每条明细 `quantity = deducted_qty = received_qty`，且没有本单在途容器。计划 10、先发并收 5 时保持在途，允许继续发出剩余 5；最终收齐后仅记录一次完成事件。异常了结仍走既有独立权限入口，保留运输损耗语义。
- **PDA 出库入口**：列表的 status=2 保持待出库入口；status=3 且任一明细 `quantity > deductedQty` 时仍提供源仓扫码出库，按每行 0.0001 整数单位判断，不把重复商品行合并抵消。全部出完后不再显示出库入口，status=3 的原入库分组保持不变。`GET /transfer` 在既有范围过滤及分页后，仅按本页授权单据 ID 使用一次参数化批量查询附加 `items`，保留明细顺序、重复行及数字类型，卡片可显示实际计划/已出/已收数量，避免逐单补详情。
- **R2-05**：重复商品行继续合法，包括已有单据；无需改写历史明细或拒绝原草稿。整箱扫出先按该商品全部行合计剩余计划校验，再按明细 ID 顺序分配；扫入按各行已出未收余额分配。分配以 0.0001 为整数单位，允许一箱跨越多个同商品行；每行始终满足 `0 ≤ received_qty ≤ deducted_qty ≤ quantity`。不拆实物容器，不扩大整箱上限。
- **R2-06**：create controller 显式传入用户 scope，service 在插入前校验两端。沿用调拨列表、详情和改单的既有跨仓语义：**至少一端在用户范围内即可**；两端均在范围外返回 403 且不插入草稿。不是要求发货方同时拥有收货仓权限。
- **R2-07**：新扫码 action 为 `transfer.scanOut.<id>`、`transfer.scanIn.<id>`；同单同键返回原回执，不重复库存日志、事件、数量。不同单同键各自执行各自返回。单据存在、用户仓库范围及设备绑定仓检查先于重放，不能拿有效键跳过这些检查。
- 旧固定 action 成功记录仍能对原单重放，须同时匹配 `resource_type`、`resource_id` 和响应 `transferId`；用于另一单或旧记录未确认时明确返回 409。新绑定 action 查询可兼容同单旧回执；旧客户端固定 action 查询新回执时，只接受唯一、资源一致的候选，同键多单时返回 `not_found`，不任选成功。
- PDA 两页和关键动作 hook 同步绑定回执 action；旧 pending 记录也按当前单据绑定 action 查询。移除“只要容器已在目标仓/已上架就视为本次操作成功”的弱推断。回执缺失时保留待确认，并准确提示尚未确认，避免无归属证据的状态覆盖服务器拒绝。
- 保留单头行锁、库存维度先于容器的加锁顺序、PDA 设备会话和两端设备仓限制；缓存只经 `syncStockFromContainers` 同步。未修改真实环境、数据库公共配置、容器引擎、生产数据或部署流程。

实现集中于 `backend/src/modules/transfer/`；系统回执 controller 仅增加调拨兼容分派，其他 action 仍走既有公共查询。前端修改限于调拨 PDA 页面与旧 pending 的 action 解析。PC 调拨表单已核对：保留重复行符合上述新执行语义，无需合并或禁止选择。

## 验证与证据

使用 Node 22.23.2，公共 `tests/helpers/testEnvironment.configureTestEnvironment()`，显式测试专用 `.env.test`，回环 `127.0.0.1:13308` / `flowcube_fix_24_test`。独占随机 `R2FT` 前缀创建商品、仓库、角色、用户、设备、会话和容器，库存初始化走容器引擎；没有加载真实 `backend/.env`。夹具保留在隔离测试库便于复核。

1. 后端 HTTP 回归 `tests/round2-transfer.smoke.test.js`：**15/15 通过**。走真实鉴权、受限角色、PDA 中间件、controller/service 和 MySQL 事务，覆盖范围拒绝、分批、3+7/5+5 重复行、逆序收箱、四位小数跨行、跨单键、新旧回执、同单串行/并发重试、错设备/不存在单据、整箱超限，以及库存总量和缓存守恒。新增真实 GET 列表回归验证在途重复行四位小数、已出/已收投影、行序、分页边界及范围外单据不泄漏；补测精确连接 `127.0.0.1:13308 / flowcube_fix_22_test`，没有占用浏览器验收的 `flowcube_fix_24_test`。
2. 红测先于实现：初版 9 项中 6 项按正确业务期望失败，分别观察到 201≠403、首批错误完成、重复行整箱被拒绝、跨单回错单、错误设备仍成功及旧 action 跨单错误回放。原先已正确的同单重试与整箱超限作为保护项保留。
3. 前端 `frontend/src/pages/pda/transfer.test.tsx`：**10/10 通过**。真实挂载两页和 `useCriticalPdaAction`，验证旧 pending 查询绑定 action、仅有目标仓在库容器但没有回执时保持待确认。移除弱推断前两项均实际失败，观察到错误清除 pending。新增 8 项真实列表组件回归，覆盖部分出库、重复行、最小 0.0001 余量、逐行判断、刷新后的 2→3→全出完与无效状态，并验证点击进入 `/pda/transfer-out/:id`。列表修复前 5 项失败；后端新增 GET 断言修复前以“列表必须携带逐行数量”失败。
4. 受影响后端/前端文件 ESLint 通过；`tsc -p frontend/tsconfig.app.json --noEmit` 通过；受影响文件 `git diff --check` 通过。

复跑命令（`FLOWCUBE_TEST_ENV_FILE` 使用当前有效测试配置路径，不在仓库保存凭据）：

```bash
source "$HOME/.config/flowcube/dev-env.sh"
DB_NAME=flowcube_fix_24_test node --test tests/round2-transfer.smoke.test.js
npm --prefix frontend run test:unit -- src/pages/pda/transfer.test.tsx
./frontend/node_modules/.bin/tsc -p frontend/tsconfig.app.json --noEmit
```

本机日志：`/tmp/flowcube-round2-fix-transfer-red.log`、`/tmp/flowcube-round2-fix-transfer-green.log`、`/tmp/flowcube-round2-fix-transfer-ui-red.log`、`/tmp/flowcube-round2-fix-transfer-ui-green.log`；每次真实 HTTP 的状态、逐行量、容器归属及最终守恒快照见 `/tmp/flowcube-round2-fix-transfer-evidence.json`。列表补修证据另存 `/tmp/flowcube-round2-fix-transfer-list-{red,green}.log`、`/tmp/flowcube-round2-fix-transfer-list-api-{red,green}.log` 及 `/tmp/flowcube-round2-fix-transfer-list-evidence.json`；测试脚本允许 `FLOWCUBE_TRANSFER_EVIDENCE_PATH` 指定独立输出，未覆盖原浏览器验收夹具证据。初次绿测的范围外夹具漏传 operator，补齐测试参数后完成 15 项回归。以上临时路径不是跨机器归档保证。

## 文档同步与边界

总任务已同步 AGENTS.md 的调拨规则、资源级幂等、PDA 待确认语义与审计状态，并明确在途部分出库入口和列表批量明细契约。原审计报告保留修复前证据，最新页面验收和交付状态见第二轮修复汇总。

未自动回填或重开此前已提前完成的历史单据；此类单据须核对实际搬运事实后单独处理。回执超过既有保留期后不会根据容器当前状态猜测成功。浏览器本地开发模式验收由总任务统一进行；本域的 React DOM 测试和真实 HTTP 不等于 Android 真机扫码、打印或整条生产调拨验收。
