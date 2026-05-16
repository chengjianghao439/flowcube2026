-- FlowCube ERP - Migration 083
-- 更新 packages.status 列注释，新增状态值 3（已取消）

ALTER TABLE `packages`
  MODIFY COLUMN `status` TINYINT UNSIGNED NOT NULL DEFAULT 1
  COMMENT '1=打包中 2=已完成 3=已取消';
