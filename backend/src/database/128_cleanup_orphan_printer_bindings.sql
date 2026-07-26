-- 清理悬空打印机绑定：printer_bindings 引用了已被删除的 printers 行。
--
-- 成因：printers 走物理删除（DELETE FROM printers）且 printer_bindings 无外键约束，
-- 删除打印机后绑定记录残留。此后 fetchBindingCandidates 仍会把这些不存在的 printer_id
-- 作为候选返回，导致：候选集非空 → 跳过 binding fallback 链 → 在线过滤后为空 →
-- 最终兜底到「全库 id 最小的标签打印机」。表现为打印机绑定配置整体静默失效，
-- 所有标签都跑到同一台机器上；多仓库部署时尤其明显（跨仓库出纸）。
--
-- 代码侧已同步修复：删除打印机时级联清理绑定，且候选解析会跳过不存在/已停用的打印机。
-- 本迁移只负责清掉存量脏数据，幂等可重复执行。
DELETE b FROM `printer_bindings` b
LEFT JOIN `printers` p ON p.id = b.printer_id
WHERE p.id IS NULL;
