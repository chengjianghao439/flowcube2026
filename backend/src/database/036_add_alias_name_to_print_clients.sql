-- 036: print_clients 增加设备别名

ALTER TABLE `print_clients`
  ADD COLUMN `alias_name` VARCHAR(200) DEFAULT NULL COMMENT '用户自定义设备名称' AFTER `hostname`;
