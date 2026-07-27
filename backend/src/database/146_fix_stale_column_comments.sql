-- FlowCube ERP - Migration 146
-- 订正与代码常量脱节的列注释（CLAUDE.md 第 20 节风险 5 的收尾）。
--
-- 注释不影响运行，但它是读库时唯一的语义提示。之前已经出过一次事：有人照着
-- 「3已执行」之外的旧注释理解状态，得到的结论和 constants/ 里的状态机不是一回事。
-- 本迁移只改 COLUMN_COMMENT，类型/NULL/默认值全部按 information_schema 原样回写。
--
-- 逐条依据（均以 backend/src/constants/ 与前端 StatusBadge 的显示名为准）：
--
-- 1. transfer_orders.status —— 最严重的一条：旧注释「1草稿 2已确认 3已执行 4已取消」
--    比实际少一个状态，且语义是错的。documentStatusRules.transfer 实为
--    1草稿 2待出库(已派发) 3在途 4已完成 5已取消，其中 3 是**中间态不是终态**
--    （scanOut 后进在途，scanIn 才到已完成），按旧注释理解会以为调拨到 3 就结束了。
-- 2. sale_orders.closed_reason —— partial_ship_close 已被迁移 127 废弃并回填清理，
--    现在只可能是 NULL。
-- 3. purchase_returns.status / sale_returns.status —— 3 的显示名在
--    documentStatusRules（execute 动作）与前端 StatusBadge 里都是「已执行」，
--    旧注释的「已退货」「已退货入库」是更早的叫法。
-- 4. print_jobs.content_type —— 队列现在只接受 zpl，html/pdf 在入队时就被
--    PRINT_CONTENT_TYPE_UNSUPPORTED 拒掉（print-jobs.command.js）。默认值仍是
--    'html' 属于历史遗留，这里只在注释里讲清楚，不动默认值以免影响存量行。
--
-- 未改动但核对过的（结论是注释本来就对，记下来免得下次重复查）：
--   sale_orders.status「3拣货中」与 saleOrderStatus.js 一致；
--   inventory_checks.status「1进行中」与前端 StatusBadge 一致；
--   inventory_logs.type「1入库 2出库 3调整」仍然成立——关闭的是手动入口，不是 type 值本身。

ALTER TABLE `transfer_orders`
  MODIFY COLUMN `status` TINYINT UNSIGNED NOT NULL DEFAULT 1
  COMMENT '1草稿 2待出库(已派发) 3在途 4已完成 5已取消（见 documentStatusRules.transfer；3 是中间态，scanIn 后才到 4）';

ALTER TABLE `sale_orders`
  MODIFY COLUMN `closed_reason` VARCHAR(20) DEFAULT NULL
  COMMENT '结案原因：NULL正常出库（partial_ship_close 已由迁移 127 废弃并清空）';

ALTER TABLE `purchase_returns`
  MODIFY COLUMN `status` TINYINT UNSIGNED NOT NULL DEFAULT 1
  COMMENT '1草稿 2已确认 3已执行 4已取消（见 documentStatusRules.purchaseReturn）';

ALTER TABLE `sale_returns`
  MODIFY COLUMN `status` TINYINT UNSIGNED NOT NULL DEFAULT 1
  COMMENT '1草稿 2已确认 3已执行 4已取消（见 documentStatusRules.saleReturn）';

ALTER TABLE `print_jobs`
  MODIFY COLUMN `content_type` VARCHAR(50) NOT NULL DEFAULT 'html'
  COMMENT '打印内容类型：实际只接受 zpl，html/pdf 入队即被 PRINT_CONTENT_TYPE_UNSUPPORTED 拒绝；默认值 html 为历史遗留';
