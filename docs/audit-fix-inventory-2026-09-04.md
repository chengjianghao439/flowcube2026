# F01–F05 库存审计修复（2026-09-04）

状态：工作树实现，未提交、未推送、未部署；没有连接生产数据库或修复历史数据。

## 现行规则（需同步 AGENTS.md 第 6、7、12 节及审计 F01–F05）

- 退货收货及每次质检分箱在同一事务调用既有 `enqueueContainerLabelJob`，原容器数量变更与新容器各入 ZPL 标签队列；回执包含所有变化条码/数量、`printJobIds` 与 `noPrinterCount`。无可用打印机保留收货/质检事实并明确提示，入队数据库异常随业务回滚，幂等请求重放不重复造容器或标签。客户端同时展示待上架条码与数量（客户端修复任务负责）。
- F01：销售退货部分质检按「合格、拒收、未检」三个分量拆分容器。未检量优先保留原条码，合格与拒收分别落待上架与拒收容器；后续质检可继续，三部分合计始终等于实收量，4 位小数参与数量计算。
- F11 交叉复核补充：退货条码查询与实际上架的容器预读、加锁读必须排除软删除容器；软删除且仍为待上架状态的旧条码不能推进上架量、任务状态或库存。实现由客户端修复任务负责，本文件所列 MySQL 回归同时验证这条边界。
- F02/F05：`expected` 是采购已提交/待审批的 **订购量减已上架量**，上架量不再等待整张收货任务 `audit_status=1`；已取消或软删除任务不计入。销售 ATP 可用量固定为 `ACTIVE 现货 + expected - 全部有效预占`，不能再扣一次预计绑定。默认实物投影保持不纳入 expected。
- `sale_order_expected_bindings.qty` 是该销售仍依赖采购的量。每次实际采购上架按归属采购明细 FIFO 兑现对应绑定，不减少 `inventory_stock.reserved`；其预占从预计转为现货。部分释放优先解除本销售预计依赖；部分履约先核销本销售现货部分，只关闭超过该销售剩余有效预占的绑定，不能提前解除采购尾量。
- F03：实际出库只核销本单履约预占；去除 `reserved=LEAST(reserved,quantity)`，预计预占允许大于当前现货。销售只能使用本单现货预占份额加尚未分配的实物，不能拿其它销售的现货兑现自己的预计预占。容器实际扣减仍必须满足本仓实物与本任务锁定容器约束。
- 整单/部分释放均先锁库存维度，再锁预占与绑定。整单先按商品/仓库顺序锁全部维度，最后统一关闭绑定；旧 RR 快照若漏掉新增维度，当前读发现后返回 409 重试，禁止持预占锁再补取库存锁。
- F04：采购撤回、驳回、取消、短装结案、草稿明细重建均先检查未兑现销售绑定。检查在采购行锁内使用当前读，返回 409 `BINDING_SALE_DEPENDENCY`，显示涉及销售和合计依赖量。
- 销售占库先按采购 ID 锁住本次所有候选供应，再按商品/仓库统一顺序锁库存；锁内重读真实上架量与绑定量，不使用调用方传入的 `expectedItems` 旧快照。相关入库采购锁也按 ID 排序。读取收货明细使用 `FOR UPDATE OF iti`，避免反向锁 `inbound_tasks`。
- 采购上架已兑现绑定后，撤回收货必须保证撤除实物后仍足够支撑现货预占；不足返回 409，提示先释放销售预占。撤回先锁关联采购，再锁库存/容器，避免产生无供应承诺。

## 修改文件

- `backend/src/modules/return-tasks/return-tasks.labels.js`：事务标签入队和结构化打印回执。
- `backend/src/modules/return-tasks/return-tasks.service.js`：质检容器三分量守恒与标签回执；同文件新增查询 API 由客户端修复任务负责。
- `backend/src/utils/expectedStock.js`：预计总量、当前读、采购锁及按量兑现依赖。
- `backend/src/engine/{containerEngine,inventoryEngine,reservationEngine}.js`：ATP 投影、绑定分配/核销、实物出库守卫。
- `backend/src/modules/{purchase/purchase.service,sale/sale.service}.js`：采购依赖保护、销售多行占库当前读。
- `backend/src/modules/inbound-tasks/{inbound-tasks.putaway,inbound-tasks.void,inbound-tasks.helpers}.js`：到货兑现、撤收保护、统一采购锁序。
- `tests/audit-inventory.smoke.test.js`：真实 MySQL 8 与实际 service/engine 回归，使用公共 `testEnvironment` 显式测试库约束。

## 验证

初次 RED：在隔离 `flowcube_inventory_test` / MySQL 8.0.46 执行新增的 11 项测试，**0 passed / 11 failed**，复现部分质检量丢失、部分上架供应虚增、出库截断、撤回/驳回放行、多销售预计量重复扣减及上架绑定未兑现。新增「预计销售消耗另一销售现货」用例另有一次 RED：**12 passed / 1 failed**。

后续新增真实队列/无打印机 RED **17/2**；两连接释放与上架/履约锁序 RED **20/2**（均复现 `ER_LOCK_DEADLOCK`）；旧快照漏维度保护 RED **22/1**，均修复转绿。客户端交叉复核新增软删除容器查询/上架两例 RED **23/2**，两条旧入口均未拒绝已删除容器；客户端补齐条码查询、预读与加锁读的软删除过滤后，两例均转绿且确认数量与库存无副作用。

修复后持续扩展：部分质检混合/纯合格/纯拒收/小数、多销售顺序占库、部分上架、部分履约/释放、采购短装、其它来源实物履约、撤收保护、两采购明细旧快照、双连接旧快照并发预占、撤回与绑定提交交错、软删退货容器查询及上架。完成时本次实际执行结果为 **25 passed / 0 failed**（MySQL 8.0.46）。

运行（根目录；设置 `NODE_ENV=test`、显式本机 `DB_*`，库名 `flowcube_test` 或 `flowcube_<用途>_test`）：

```bash
node tests/audit-inventory.smoke.test.js
```

本次具体隔离 runner：

```bash
source "$HOME/.config/flowcube/dev-env.sh"
node /tmp/flowcube-repair-20260904/run.cjs flowcube_inventory_test node tests/audit-inventory.smoke.test.js
```

普通用例在外层事务中，通过保存点执行业务自身事务，再整例回滚；双连接用例提交仅自己新建的专用 ID，并在 finally 精确按 ID 清理。测试不加载真实 `backend/.env`，不依赖生产数据，无历史数据清扫操作。

在已跑过基线的 `flowcube_test` 复验时，打印夹具曾因既有 `container_label` 绑定及历史单列唯一索引产生 RED **23/2**，进程退出码实测为 **1**。现改为事务内锁住并临时复用既有绑定，无绑定时才插入；外层回滚还原，并比较运行前后全部 `printer_bindings` 行确保完整恢复。该同库连续执行两次均为 **25/0**、退出码 **0**，未删除基线数据。测试失败及顶层异常仍明确以非零退出。

现有 `npm run smoke:atp` 真实 HTTP 回归 **8 passed / 0 failed**。本域代码 ESLint 在 `backend` 目录执行，通过且无输出；`git diff --check` 通过。主任务负责现有全链路与跨域回归、AGENTS/总审计正文统一合并。

## 限制与后续核验

- 没有新增迁移。旧版本已经损坏的预占缓存、已经兑现但未关闭的历史绑定、质检丢失的历史容器数量不会自动修正。生产需要先只读核对，确认实际影响后再单独授权数据修复；不能由本次测试推断生产已发生问题。
- QA 拆分继续使用既有建容器与 ZPL 入队机制；已验证队列内容和事务幂等，不代表物理打印设备、PDA 实物重新贴标或 Windows/Android 真机已验证。
- 所有数量事实、绑定兑现和状态变化仍在同一调用方事务；实际物理打印保持异步。
