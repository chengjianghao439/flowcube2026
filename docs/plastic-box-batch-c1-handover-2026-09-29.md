# 批 C1 实施交接 · 2026-09-29 · 装箱异常恢复：`remove-item` / `void` 的稳定键与原目标回执

> 状态：**已本地实施；后端套件 7 项、组件用例 6 项全绿。未发布**（提交状态以 Git 与最终交接为准）。
> 本批只覆盖 **`remove-item` / `void` 两个装箱异常恢复入口**（API / service + PDA 打包页）。
> **`finish` 的稳定键与事务边界不在本批**，留给下一小批。
> 仅 **API / service / 组件**，**不代表 GUI、真 PDA、物理打印**。

## 1. 缺陷与证据

**缺陷**（Codex 定向 probe，`/tmp/flow-plastic-box-remove-replay-codex-probe-20260929.log`）：
`remove-item` **不接请求键**（controller 不传、service 无幂等），同一次操作重放会**真的再扣一次装箱量**。
`void` **同样没有请求键**，但它的表现**不是**再执行一次数据修改：作废是终态，重放会被状态检查挡住，第二次返回 **400「该箱已作废，无需重复操作」** —— 也就是说 `void` 缺的是「**同键回原回执**」，而不是「重复改数据」。

- probe 证据：同箱同明细、同一 `X-Request-Key`、`qty=10` 连发两次 ⇒ **60 → 50 → 40**，两次都 200。
- 本批自跑红证据（`/tmp/fc-pb-rm-red.log`，`EXIT=1`，4 passed / 3 failed）：

| 用例 | 修复前实测 |
|---|---|
| 同键重放只扣一次 | 重放 **200 且又扣一次**（140→130） |
| 整行删后原键回原回执 | **404「该商品明细不存在」**（明细不存在挡在重放前） |
| void 同键回首次回执 | **400「该箱已作废，无需重复操作」** |
| 新键合法第二次 / A 箱键带 B 箱 / 越权先于重放 | 已绿（**护栏**，修复后必须保持） |

## 2. 修复（对齐 `add-item` 既有正确模式）

`backend/src/modules/packages/packages.controller.js`：`removeItem` / `voidPackage` 透传 `extractRequestKey(req)` 与 `userId`。

`backend/src/modules/packages/packages.service.js`：
- 两个函数接 `requestKey` / `userId`；
- 在 **`assertTaskScope` 之后**（**先于**幂等 begin）`beginResourceOperationRequest`，动作 **base** `package.remove-item` / `package.void`（helper 会无条件再拼 `.resourceId`，资源级绑箱）；
- **重放分支排在明细 / 状态检查之前**——整行已删、箱已作废都能按原键取回原回执；
- 回执由 `completeOperationRequest` 与原操作**同一事务**落库。

**空键行为完全不变**（`beginResourceOperationRequest` 对空键直接返回 `{ enabled: false }`，`completeOperationRequest` 亦为 no-op），因此不带键的老调用点零影响——`pack-quota`（B3b）复跑 **8/8** 印证。

**语义边界**：**幂等只救「同一个操作」**。新键仍是合法新操作（第二次移出照常生效；新键对已作废箱仍按现有 **400** 拒绝）；**资源级**绑定使 A 箱的键带到 B 箱时**不命中**（B 独立执行、不重放 A、不再次改动 A）。

**前端**（`frontend/src/api/packages.ts` + `frontend/src/pages/pda/pack.tsx`）：`remove-item` / `void` 改走 `useCriticalPdaAction`（原先是不带键的普通 mutation）。未确认期间冻结原目标：换箱 / 扫码 / 新建箱 / 移出 / 作废 / 完成箱子 / 完成整单受聚合 `anySubmitBlocked` 约束，且**这些 handler 自身**也用聚合状态挡住（不只靠按钮 `disabled`）；冻结卡片显示**原任务 / 原箱 / 原明细行 / 数量**。恢复定位用**冻结记录里的原箱 id** 组成 scoped action，**只接受原箱**回执；**不**凭列表里该明细还在不在判本次成功。

> **本批引入并已修复的前端回归（如实记录）**：改写「当前待确认」共用位次链时一度**漏掉 `finishAction`**，会让「完成箱子」待确认时 `frozenRecord` 变 null、查询/清除落到 `finalizeAction` —— **等于把既有的完成箱恢复入口改回归**。已补回位次（`add → remove-item → void → **finish** → print → finalize`），并加组件用例钉住：完成箱子待确认时卡片显示该箱、且「确认上次结果 / 清除记录」确实调用**完成箱子**。**本批不改 `finish` 后端**，但必须保持前端既有功能不回归。
> 另：冻结卡片文案**按 action 分派**（装箱 / 移出 / 作废各有专名，其余用记录自身 `label` 组合），**不得**把完成箱子 / 打印 / 完成打包一律写成「装箱提交」。

## 3. 测试

脚本 **`npm run smoke:pack-remove-void-replay`**（`package.json`），已接入 CI `regression-plastic-box` job（顺序排在 B4 补充项之后）。等价直跑命令（显式回环专库 + Node 22 + 可写下载目录）：

```
set -a; source ~/.config/flowcube/operations20260912-test.env; set +a
export DB_NAME=flowcube_plastic_box_20260929_test NODE_ENV=test APP_UPDATE_DOWNLOADS_DIR=/tmp/fc-pb-downloads
export DB_HOST=127.0.0.1 DB_PORT=3307
node tests/pack-remove-void-replay.smoke.test.js
```

结果：**7 passed / 0 failed，natural exit 0**（`/tmp/fc-pb-rm-green2.log`）。全真实业务链（采购→收货→上架→建盒放货→销售占库发货→扫盒取货→ready→`sort-done`→复核→装箱→移出 / 作废），**未用 SQL 改库存 / 状态 / 回执**：

1. **remove 部分移出**：同键重放只扣一次（保持 140）、回执与首次一致
2. **remove 整行删除后**：原键重放仍返回**原回执**（不再 404）
3. **remove 新键**：合法第二次移出正常生效（140→130）
4. **remove 资源级绑定**：A 箱的键带到 B 箱时 **B 独立执行、不重放 A、不再次改动 A**（B 扣 10、A 仍 140）
5. **void 同键重放**返回首次回执；**新键**对已作废箱仍 **400**（现有拒绝语义保留）
6. **void 资源级绑定**：A 箱的键带到 B 箱时 B 正常作废
7. **越权重放**：remove 与 void **各自先产生本 action 的成功回执**，再用**同账号、不同仓的有效 PDA 票据**持原键重放 ⇒ **403 `PDA_WAREHOUSE_MISMATCH`**，数据不变

**组件**：`frontend/src/pages/pda/pack.test.tsx` **6/6 natural exit 0**（3 原有 + 3 新增：移出 pending 冻结并显示原箱与原明细、作废 pending 同理、**完成箱子 pending 的定位与「确认/清除落在 finish」回归护栏**；`taskId=41 / pkg=7` 与当前 `42 / L000008` 刻意不同，避免「拿当前值替代」也能绿）。

**静态检查**：改动的 2 个后端源文件、3 个前端源文件 eslint **exit 0**；`frontend tsc -p tsconfig.app.json` **exit 0**。

**受影响回归（本批自跑）**：`pack-quota`（B3b，含 remove/void 的空键路径）**8/8**。

**夹具**：`finally` 按自建 ID 逐笔合法取消 + 归还并只读核对 `task=8 且自身锁 0`（本轮 **10 笔全部通过**）；自建分拣格逐格删除。**越权夹具全部走合法接口、不直接造状态**：`POST /api/warehouses` 建独立仓库、`POST /api/pda-devices` 登记独立设备 + `POST /api/pda/sessions` 换票据；收尾**设备**先 `PUT /api/pda-devices/:id { warehouseId: null }` **解绑**、再 `PUT /api/pda-devices/:id/status { status: 'disabled' }` **停用**（停用会连带吊销票据），**仓库**用 `DELETE /api/warehouses/:id` —— 后端是 **softDelete 软删**（`warehouses.routes.js:41`），**不是物理删除**。
收尾**不再默认成功**：任一步失败即 `failed++` 输出 `[FAIL]`，并按**只读核对**报告 —— 设备要求 `warehouse_id IS NULL` + `status='disabled'` + **有效票据 0**（`revoked_at IS NULL AND expires_at > NOW()`），仓库要求 `deleted_at` 非空。日志：`自建越权夹具收尾核对：设备 1/1 台（已解绑 + 已停用 + 无有效票据）、仓库 1/1 个（已软删）`。

> **偏差描述（两段分开说，别混成一句）**：
> ① **早期版本**的越权夹具是**用 SQL 直建**的（`INSERT pda_devices` / `INSERT inventory_warehouses`），并**用 SQL 物理删除**了自建仓。这段做法**已废弃**——现版本全部改走合法接口（`POST /api/warehouses`、`POST /api/pda-devices`、`POST /api/pda/sessions`，收尾用 `PUT` 解绑 + 停用 + `DELETE` 软删）。
> ② **147 / 149 这两台设备本身是后来用合法接口 `POST /api/pda-devices` 登记的**（**不是** SQL 直建），它们悬空的**唯一原因**是早期那批**物理删仓**把 `warehouse_id` 指向的行删掉了。订正：`PUT /api/pda-devices/:id { warehouseId: null }` 把这两台解绑为 `warehouseId=null`、状态**保持 `disabled`**（未重新激活），**只改本批这两个 ID**，未手工补旧仓、未删设备历史。
> 现存 **5 个自建仓行全部软删**（`deleted_at` 非空）；**旧仓 28 / 29 已被物理删除，属历史偏差、未恢复**——不得把这两行写成「已软删」。

**root 独立复跑（2026-09-29，非本会话自证）——结论：本批独立审查接受**

- 后端 `pack-remove-void-replay` **7/7，natural exit 0**（`/tmp/flow-plastic-box-remove-void-codex-20260929.log`）。
- 组件 `frontend/src/pages/pda/pack.test.tsx` **6/6，natural exit 0**（`/tmp/flow-plastic-box-c1-ui-final-codex-20260929.log`）。
- CI 资源 + 文档守卫 **26/26，natural exit 0**（`/tmp/flow-plastic-box-c1-ci-guard-codex-20260929.log`）。
- **定向 S7 与新版合法清理 1/1，natural exit 0**（`/tmp/flow-plastic-box-c1-cleanup-codex-20260929.log`），其中 2 笔销售合法取消 / 归还 **2/2**。
- root **只读复核**：API7 的 **10 笔**销售与清理 1 的 **2 笔**销售，任务全部 `status=8`、自身锁 **0**；本批 PB-C1 **额外设备 7 台**均 `warehouse_id=null` + `status=disabled` + **有效票据 0**（含 147 / 149 的订正）；现存 **5 个自建仓行全部软删**。
- root 环境核对：浏览器 `sessions[]` 为空，3399/3400/5173/5174 **无监听**，root 主工作树干净，`git diff --check` 为 **0**。
- **未做故障注入**：收尾核对 SQL 的**异常分支**（`catch` 内 `failed++` 那条路径）**只有代码审查、未实跑** —— **不得**称"异常分支已实测"。

## 4. 证据边界与仍未验（如实）

- 走 **HTTP 全链**：全部 7 项。
- **1. GUI / 真 PDA 全程未跑**；**物理打印未验**（本批不涉及打印链）。
- **2. 前端组件用例只 mock 了 `useCriticalPdaAction`**，证明的是**页面用法**（冻结哪些入口、显示什么定位、按什么分派清除）。**真实持久化重挂、真实丢响应（断网 / 超时）未跑**——不得据此称「重挂恢复已验」。
- **3. 越权只验了 `pdaWarehouseId`（PDA 设备仓）分支**：用的是**同账号 + 另一个仓库的有效设备票据**。**限仓用户的 `scopeWarehouseIds` 分支本轮未实测**（造限仓且持 pack 权限的用户成本高，未做）——**两个分支不能互相代表**。
- **4. `finish` 未动**：其稳定键、controller 在 `pool` 上 begin/complete、replay 先于 scope/device、service 自行提交事务与历史回执等边界**仍是下一小批**。
- **5. 本批为资源级幂等的单机顺序场景**；真实并发未验。
- **6. 7 项 + 6 例仅为本批证据**，不等于批 C 全部验收。

## 5. 资源

- 本轮未启动常驻服务与浏览器；测试进程自起自停。共享 **3307** MySQL 保留，未触碰其它任务资源。
- **未打 tag、未发布**；提交状态以 Git 与最终交接为准（本轮**未暂存、未提交**，按审查点交付）。
