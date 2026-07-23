-- FlowCube ERP - Migration 116
-- 清理 071 迁移遗留的 inbound.order.audit 权限 seed 数据：
-- 人工审核链路已随 v0.4.22 整体下线（上架完成即自动结算），代码中已无任何引用，
-- 该权限码属于纯历史死数据，避免它继续出现在角色权限勾选界面误导配置。

DELETE FROM `sys_role_permissions` WHERE `permission` = 'inbound.order.audit';
