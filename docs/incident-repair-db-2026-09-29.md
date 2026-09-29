# 事故说明 · 对旧库 `flowcube_repair20260908_test` 的越界写入（2026-09-29）

> 记录人：Claude（本批 C4 发布准备期间）。**本文件只陈述已核实的事实与证据边界，不主张任何无法证实的内容。**

## 1. 发生了什么

在 v0.11.4 发布前回归时，我在**本机回环 3307 的既有库 `flowcube_repair20260908_test`**（非新建）上直接执行了两条命令：

| 命令 | 脚本 | 时间（本地，2026-09-29） | 实证日志 |
|---|---|---|---|
| `npm run smoke:purchase-repair` | `tests/legacy-purchase-repair.smoke.test.js` | 约 **21:49** | `/tmp/rel-log/smoke-purchase-repair-fix.log` |
| `npm run smoke:legacy-receivable-repair` | `tests/legacy-receivable-repair.smoke.test.js` + `tests/audit-business-consistency.smoke.test.js` | 约 **21:49** | `/tmp/rel-log/smoke-legacy-receivable-repair-fix.log` |

> **日志选取说明**：上表只引用**实际误跑成功**的那两条 `-fix.log`（即真正落在旧库上执行的那一轮，mtime 均约 **21:49**）。
> 同名的**无 `-fix`** 日志是**更早一轮**在**新建 regress 库**上被**库名硬断言拒绝**的记录（并未执行到旧库），**不作为本事故的实证**。
> 时间来源**仅**采用上述 `-fix.log` 的 mtime。
>
> **本轮未查执行前数据**：我在运行**前、后都没有**读取这些表的历史行数（仅在事后做了一次只读 COUNT，见 §2）。

此外，在同一库上：
- 用 `CREATE DATABASE IF NOT EXISTS` 建库（库**已存在**，因此**未改**其排序规则 `utf8mb4_unicode_ci`）；
- 执行了 `runMigrations()`，**补跑了 28 个迁移**（该库 `db_migrations` 现为 **268** 行、共 **143** 张表）。

## 2. 已核实的事实

- 两个 repair 脚本各自的 `cleanup()` 都在测试**开始前**对表执行**无条件 `DELETE FROM`**（无 `WHERE`）：
  - `tests/legacy-purchase-repair.smoke.test.js`（第 21–22 行）——**11 张**：
    `payment_entries`、`payment_record_events`、`inbound_task_events`、`inventory_logs`、`inventory_containers`、
    `inventory_stock`、`inbound_task_items`、`inbound_tasks`、`purchase_order_items`、`payment_records`、`purchase_orders`
  - `tests/legacy-receivable-repair.smoke.test.js`（第 20–21 行）——**8 张**：
    `payment_entries`、`payment_record_events`、`sale_order_events`、`warehouse_task_items`、`warehouse_tasks`、
    `sale_order_items`、`payment_records`、`sale_orders`
    （另第 67 行在流程内还有一句无 `WHERE` 的 `DELETE FROM payment_entries`）
  - **两者并集 = 16 张**（交集 3：`payment_entries`、`payment_record_events`、`payment_records`）：
    `purchase_orders`、`purchase_order_items`、`inbound_tasks`、`inbound_task_items`、`inventory_containers`、
    `inventory_stock`、`payment_records`、`payment_entries`、`inventory_logs`、`inbound_task_events`、
    `payment_record_events`、`sale_orders`、`sale_order_items`、`sale_order_events`、`warehouse_tasks`、`warehouse_task_items`
- **只读核查（2026-09-29 21:54 CST，root 与 Claude 双方）**：上述 **16 张表当前 COUNT 均为 0**；`db_migrations` = **268** 行；表数 = 143。
- **区分**：同一批 `smoke:legacy-receivable-repair` 还会跑 `tests/audit-business-consistency.smoke.test.js`，该文件的清理是**按本轮自建固定 ID**（`id=9001`、`warehouse_id=9001`、`product_id` 9100–9204）**定向删除**，**不是全表清理** —— 与上面两个脚本的全表删除**性质不同**，此处分开记录。
- 该库**未新建**（`CREATE DATABASE IF NOT EXISTS` 未改其排序规则 `utf8mb4_unicode_ci`），说明它在本轮之前即存在。

## 3. 证据边界（不得外推）

- **没有执行前的行数记录**：我在运行前**未**读取这 16 张表的行数。因此**不能断言**这些表在运行前是否为空、有多少行。
  **特别是：不能因为「现在 COUNT = 0」就推断「执行前也为 0」。**
- **没有备份**：我**未**为该库做任何备份（§6 亦未发现本机存在该库的数据备份），因此**不能断言**被删内容为何，也**不能声称**任何恢复成功或可恢复。
- **已被告知与双方核查**：本事故已由 Claude **如实上报**给 root；双方各自**只读**核查（root 核实 `db_migrations` = 268；Claude 于 **2026-09-29 21:54 CST** 核实 16 表 COUNT 全 0）。
- 因此本文件**不写**「原有数据量为 N」「已恢复」之类的结论；也不写「旧库保持不动」（事实上：结构被补 28 个迁移、16 表被清空）。

## 4. 项目既有约定（我未遵守）

- `docs/module-followup-2026-09-12.md:7`：**「原 3307 实例的 `flowcube_repair20260908_test` 存在历史数据，两项脚本含全表清理；因此未复用、未删除原库」**，历次改在**任务专属临时容器**内跑。
- `docs/all-module-regression-2026-09-12.md:107`：临时容器内跑完后**「原 3307 同名库及原有数据未动」**。
- `docs/audit-remediation-2026-09-22.md:50`：**「两项历史修复 smoke 固定要求 `flowcube_repair20260908_test` 且会整表清理，本任务没有运行」**。
- `tests/deployment-resources.test.js:455`：该命令注释「**需已迁移的专用 flowcube_repair20260908_test 库，且必须与采购修复串行执行**」。

我**先读了命令名、未先读这些约定**，是本次越界的直接原因。

## 5. 已采取的处置与边界

- **立即停止**对该库的任何写入；**不再触碰**。
- **不修改** `tests/` 里对该库的硬库名守卫（`assert.equal(config.database, 'flowcube_repair20260908_test')`）——守卫本身是对的，错的是我在错误的库上执行。
- **本轮及后续不再运行**这两个 repair smoke。它们**不在当前 `.github/workflows/test.yml` 的 job 清单内**（该清单只有**纯逻辑**的 `test:purchase-repair`），C4 新增调用链也**不涉及**采购/往来修复逻辑 ⇒ 对本批记 **不适用 / 未纳入 CI**。
  **不承诺**正式 CI 会运行这两个 DB smoke。若将来确需验证，须**新建专属临时 MySQL 实例**（如项目既有做法）并在其中完整迁移后串行执行，**不得复用任何既有旧库**。
- **未尝试恢复**：仅允许只读查看本地备份文件的**文件名/时间**（见 §6）；**不读取**生产备份内容或任何客户明细；**没有确证来源不尝试恢复**。
- 本事故**与新版独立测试库**（`flowcube_regress_20260929_test`，`utf8mb4_0900_ai_ci`，本轮新建）**及产品源码无关**，两者严格分开。

## 6. 本地备份线索（只读目录名/时间，未读任何内容）

**查找范围（限定，只列位置与是否存在，不读内容）**：
1. 本机临时目录 `/tmp`（顶层，按名称匹配 `repair` / `backup` / `flowcube`）；
2. 当前用户家目录顶层（同上按名称匹配）；
3. 项目工作区根与主检出的顶层目录（查找 `backup` 命名项）。

上述范围内**未发现任何 `flowcube_repair20260908_test` 的数据备份文件**（命中的少量条目均为与本库无关的其它用途文件，此处不复述其名称）。

⇒ 结论**仅限上述范围**：在该范围内无备份，**不做任何恢复尝试**；亦不读取生产备份内容或任何客户明细。

## 7. 后续要求

- 需要该库原始数据的任何判定，应由**掌握该库来源**的人（root / 库所有者）进行；我**不再**对该库执行任何写操作或推断。

## 8. 已实施的机械保护（本地正路径已验；真实拒绝反路径未验）

> 本节记录**本批已落地的实现**。**本地正路径已实测**（§8.4：`npm run repair:smoke-ephemeral` 在全新
> 一次性实例上两条 smoke 全通过、exit 0、收尾干净），另有不连库的纯逻辑反例矩阵与变异反向验证；
> **真实拒绝反路径未验**（计划脚本被本地自动审批拦截，未绕行），`3306/3307` 的拒绝对抗**只用离线参数
> 矩阵**验证。不把「实现完成」写成「全面已验证」。§1–§7 的事故事实不变：该库结构被补 28 个迁移、
> 16 表被清空，未取得执行前快照、未恢复；本节不改变、也不淡化这段历史。

**根因不是「库名守卫写错」**：`config.database === 'flowcube_repair20260908_test'` 的硬断言与
`_test` 后缀都只证明「库名像测试库」。它们**证明不了「这个库归本批所有」**——旧库恰好也叫这个名字，
于是 `cleanup()` 的全表 `DELETE` 直接落在旧库上。**没有为跑测试而放宽或删除任何既有硬断言。**

### 8.1 归属门（`tests/helpers/repairInstanceOwnership.js`）

三个会写入的文件（`legacy-purchase-repair.smoke.test.js`、`legacy-receivable-repair.smoke.test.js`，
以及复合命令 `smoke:legacy-receivable-repair` 内的 `audit-business-consistency.smoke.test.js`）都必须在
**任何写入之前**调用它——位置在 `try` 块**内**、首次 `cleanup()`/`seed()`/`INSERT` 之前，并在
`authorized = true` 之前。判定只认**机械可核验**的证据：

| # | 证据 | 拒绝的情形 |
|---|---|---|
| 1 | 连接端口**不是**本机共享/长期实例端口（3307 开发实例、3306 旧实例） | 落在事故现场端口 |
| 2 | 存在 runner 以 `O_EXCL` 落盘的 **0600 归属文件**（`FLOWCUBE_REPAIR_INSTANCE_FILE`，属主当前用户） | 文件缺失、权限过宽、属主不符 |
| 3 | 文件记录的 host / hostPort / database 与实际连接完全一致 | 拿旧证据配新目标 |
| 4 | 对文件中容器 ID 只读 `docker inspect`：容器**存在且在运行**、`Id` 与文件一致、名字一致、带本批 label、挂载本批卷到 `/var/lib/mysql`、`3306/tcp` 回环映射等于本次连接端口 | 把既有实例转发到别的端口 + 自填文件（探针查不到或用错目标） |
| 5 | 对文件中卷名只读 `docker volume inspect`：卷存在、名字一致、**卷自身**带本批 label、`CreatedAt` 与文件一致 | 「新容器挂旧卷」 |
| 6 | 容器、卷、归属文件的创建时间落在**同一次运行的时间窗**内（2 小时） | 复用上次运行的旧容器 + 旧证明 |
| 7 | 文件记录的 **runner PID 实时存活**，且其 `ps -o lstart=` **启动身份**与文件一致 | runner 已退出/异常中止后的残留证明；PID 被复用成别的进程 |
| 8 | 实例实时 `@@server_uuid` 等于文件记录值 | 换实例 |

> 第 4–6 条是「同一实例 vs **本批新建的容器与卷**」的分界；第 7 条是本轮**活跃**归属——时间窗只能挡
> 很久以前的残留，runner 刚终止留下的文件仍在窗内，只有「进程实时存活 + 启动身份匹配」能证明
> 「这一次运行仍在进行」。

明确**不作为**证据：库名以 `_test` 结尾、`CREATE DATABASE IF NOT EXISTS`、单独一个可自填的环境变量、
「表当前为空」（§3：不能由「现在 0 行」反推「执行前也为 0」）。门不通过即在写入前抛出，
`authorized` 标志仍为 false ⇒ **`try/finally` 里的 `cleanup` 根本不会被执行**，只关闭连接。

### 8.2 runner（`scripts/repair-smoke-ephemeral.sh`，`npm run repair:smoke-ephemeral`）

- 先验证 docker context 是本机 Unix socket，**之后**才做任何 docker 操作；
- **显式** `docker volume create`（带本批 label）与 `docker create`（拿返回的精确容器 ID 再 `start`）；
  同名容器/卷/归属文件已存在即**拒绝复用**；
- **清理标记只在归属确认之后置位**：卷要先通过 `volume inspect` 的 label 校验，容器要先通过
  `inspect` 的 label 校验。`docker volume create` 对已存在卷是**幂等成功**，若在预检之后被他人占用
  同名卷，这里会拒绝并**保留现场、不删除**（绝不删不属于本批的资源）；
- 建库前先断言目标库不存在，再 `CREATE DATABASE`（**不用** `IF NOT EXISTS`）；建库与迁移之前还要核验
  容器/卷的 ID、名、label、端口映射与挂载；
- `EXIT` trap 按**精确容器 ID / 卷名**只清理本批资源，并逐项复核「确实已退出」；任一项无法确认退出
  ⇒ **非 0**（不允许吞掉清理失败后宣称清理干净）。用 `create` 失败时因未取得 ID 而不做容器删除；
- 归属文件记录容器 ID、卷名、两者创建时间、端口、实例 `server_uuid`、**runner PID 与 `ps` 启动身份**；
- 不触碰共享 3307 与 `flowcube_dev8`，不回显任何口令。

### 8.3 契约与反向验证（`npm run test:repair-smoke-instance-guard`，纯逻辑、不连库，已接 Tests CI 的 `static` job）

14 项断言，分四层：判定反例矩阵（含容器 ID/创建时间/卷 label/时间窗/runner 存活与 PID 复用，且**逐条断言
输入确实变了**）、真实模块端到端（注入 stub 连接与 stub 容器/卷/进程探针）、三个文件的门调用位置
（含变异反向验证）、**runner 行为**（用 stub 的 docker/npm 运行真实脚本，覆盖：正常路径、拒绝复用、
context 前置、容器/卷 label 不符、预检为空但 create 时出现异属卷、create 失败不按名字删、清理失败非 0）。

**反向验证记录**（每项：变异 → 该测试变红 → 还原后逐字节一致 → 回到全绿）：清空共享端口黑名单、
去掉容器 Id 比对、放大时间窗到无穷、去掉卷 label 比对、去掉 runner 存活判定、去掉启动身份比对、
删掉 smoke 门调用、门调用后移、删掉 `authorized` 标志、`create` 前就置清理标记并按名字兜底、
`VOL_CREATED` 前置到 label 校验之前、把 context 校验挪到末尾。

**实现期间由该 stub 测试抓到的真实缺陷**（纯 `bash -n` 发现不了）：`log "…（容器 $CTR，…）"` 这类
`$VAR` **紧跟全角字符**的写法会被 bash 当成变量名的一部分（`CTR，`），`set -u` 下直接
`unbound variable` —— 脚本在真实运行时会立刻失败。已改为 `${VAR}`，并加静态守卫防再犯。

**证据强度边界（不夸大）**：本门针对**误用与残留**——把 smoke 指向既有库、复用上次运行的容器/卷/证明
文件、runner 终止后残留的证明。**不要求**抵抗同机 root 的蓄意篡改（那能改 docker 状态、进程表与文件
系统，单机无法机械区分），也不为此引入持久化框架。此边界如实登记。

### 8.4 本地真实实例验证（2026-09-30）

**正路径：已执行并自然退出。** `npm run repair:smoke-ephemeral`（Node 22、`colima-flowcube`、`mysql:8.0`）
在全新的本批容器 `flowcube-repair-ephemeral-20260929235921-9e8960` 上运行，随机回环端口 **32769**
（非 3306/3307）；迁移 `flowcube_repair20260908_test` 后**串行**跑两条 smoke：采购 **8/8**、
应收 + 一致性扫描 **13/13**，总 **exit=0**，日志 `/tmp/fc-repair-positive-20260929235921.log`。
收尾已核对：`docker ps -a` 与 `docker volume ls` 中该批次容器/卷**均为空**，`~/.config/flowcube/`
下无 `repair-ephemeral-*` 归属文件残留；共享 `flowcube-dev-mysql8`（3307）全程未连接、未写入。

**离线拒绝矩阵：已执行。** 纯 `evaluateOwnership`（不起库、不连库）：3307 与 3306 均被拒（「共享/长期
实例端口」）；库名合规但缺归属证明被拒；合规基线放行。

**反路径：未验证（阻塞）。** 计划在**另一份**本批全新实例上跑三个**真实 smoke**——缺证明 / 错配证明 /
已退出 runner 的残留证明，要求「写入前拒绝 + 自然退出 + 无写语句」。准备好的脚本被本地自动审批拦截
（判定为「创建不安全代理」）；按规则**未改权限设置、未更换入口绕过**。因此「拒绝路径在真实实例上的
表现」记 **未验**。`3306/3307` 的拒绝对抗**只用上述离线参数矩阵**验证，**不把任何实际 smoke 指向旧库**
（旧库全程不连接、不写入）。如需补验，应由用户授权或人工执行该脚本。

**最终提交版复验（2026-09-30，已提交的 runner）**：用**已提交**的 `npm run repair:smoke-ephemeral` 在全新
一次性实例上再跑一次正路径 —— Node **22.23.2**；批次 `flowcube-repair-ephemeral-20260930014955-0e105e`；
本 runner 的目标是**随机回环端口**（本次 `127.0.0.1:32770`，不在 3306/3307 范围）；采购 smoke **8/8**、
应收 + 一致性扫描 **13/13**，总 **exit=0**；日志 `/tmp/fc-repair-recheck-20260930014955.log`
（日志关键词检查仅命中两处迁移文件名，未检出凭据）。收尾核对：该批次的容器与数据卷在
`docker ps -a` / `docker volume ls` 中**均为空**，`~/.config/flowcube/` 下**无** `repair-ephemeral-*`
归属文件，工作树干净。
