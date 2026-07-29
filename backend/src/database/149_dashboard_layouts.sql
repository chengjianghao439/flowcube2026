-- FlowCube ERP - Migration 149
-- 仪表盘个性化布局：每个用户一行，存「可见小组件的顺序/尺寸/显隐」。
--
-- 背景：仪表盘由固定布局重构为「可编辑小组件」后，用户可自选显示哪些小组件、
-- 拖拽排序、调整宽度。这些是纯个人偏好，跨设备/端（桌面、网页）需一致，故存后端
-- 而非 localStorage。结构由前端小组件注册表（frontend widget registry）定义，
-- 后端只做「合法性浅校验 + 原样透传存取」，不理解具体 widget 语义——注册表变化
-- 无需改库。缺行（未个性化过）时前端回落到默认布局。
--
-- user_id 引用登录用户 sys_users.id，UNIQUE 保证一人一行、用 upsert 覆盖写。
-- 不加外键：sys_users 走 deleted_at 逻辑删除，用户被停用/删除不应牵连历史布局，
-- 且这张表纯偏好、无账务后果，硬外键只会在用户清理时误伤（同 payment_entries 的取舍）。
CREATE TABLE IF NOT EXISTS dashboard_layouts (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id    BIGINT UNSIGNED NOT NULL COMMENT '登录用户 sys_users.id',
  layout     JSON NOT NULL COMMENT '布局：{ widgets: [{ id, visible, w }] }，顺序即数组顺序，结构由前端注册表定义',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_dashboard_layouts_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户仪表盘个性化布局';
