-- FlowCube ERP - Migration 164
-- 承运商加"电子面单平台对接配置"（文档 06 · 电子面单与快递对接）。
--
-- 现状：carriers 只是纯 CRUD 主数据（name/type/contact/phone），没有任何平台对接信息。
-- 本功能给承运商加"用哪个电子面单平台、平台侧快递编码、月结账号、网点、是否开通取号"等
-- **非敏感**对接字段。真正的 app_id/app_key/app_secret **绝不入库明文**（硬约束）——走环境变量，
-- carriers.credential_ref 只存"用哪一组凭据"的引用名（如 kdniao_main），运行时由 config/env 解析映射。
-- 纯加列，不改任何现有流程；waybill_enabled 默认 0，存量承运商上线后行为零变化。

ALTER TABLE `carriers`
  ADD COLUMN `platform_code`    VARCHAR(30)  DEFAULT NULL COMMENT '电子面单平台标识：kdniao/cainiao/sf/mock/none' AFTER `type`,
  ADD COLUMN `platform_carrier` VARCHAR(30)  DEFAULT NULL COMMENT '平台侧快递公司编码，如 SF/YTO/ZTO' AFTER `platform_code`,
  ADD COLUMN `monthly_account`  VARCHAR(60)  DEFAULT NULL COMMENT '月结账号/客户编码（非密钥，可入库）' AFTER `platform_carrier`,
  ADD COLUMN `net_site_code`    VARCHAR(60)  DEFAULT NULL COMMENT '网点/收件网点编码' AFTER `monthly_account`,
  ADD COLUMN `credential_ref`   VARCHAR(60)  DEFAULT NULL COMMENT '密钥引用名（指向 env 中的凭据组，不存明文）' AFTER `net_site_code`,
  ADD COLUMN `waybill_enabled`  TINYINT(1)   NOT NULL DEFAULT 0 COMMENT '1=已开通电子面单取号 0=仅线下' AFTER `credential_ref`;
