INSERT IGNORE INTO `sys_settings` (`key_name`, `value`, `label`, `type`, `remark`) VALUES
('inbound_print_timeout_minutes', '10', '收货打印超时（分钟）', 'number', '收货库存条码打印任务超过该分钟数仍未完成时，视为超时待确认'),
('inbound_putaway_timeout_hours', '24', '收货待上架超时（小时）', 'number', '收货条码打印完成后，超过该小时数仍未上架时，标记为超时异常'),
('inbound_audit_timeout_hours', '24', '收货待审核超时（小时）', 'number', '收货订单完成上架后，超过该小时数仍未审核时，标记为超时异常');
