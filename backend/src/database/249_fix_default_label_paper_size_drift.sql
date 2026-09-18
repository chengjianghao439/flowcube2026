-- 2026-09-18 审计 P2-44：迁移 079 在发布后被回改过两次，**已执行过旧版 079 的库拿不到修订**。
--
-- 事实（只读核对生产库确认）：生产 `print_templates` 的 type 5/6/7/8/9 仍是 `thermal80`，
-- 而当前 079 文件里已改为 `thermal75`；079 在生产执行于 2026-05-18，改动发生在其后。
-- 迁移运行器只按 filename 判重（db_migrations 没有 checksum），所以「文件改了但库没跟上」
-- 既不会被重跑、也不会被提示。
--
-- 本迁移只做**条件式**订正：仅当值仍是那个已知错误的 `thermal80` 时才改为 `thermal75`，
-- 因此绝不会覆盖运维自己调过的模板。不回改 079 文件（AGENTS 第 5 节：已执行迁移只能新增）。
-- type=2/3 的种子已在生产与本地库中存在（只读核对过），无需在此重复那两段大 JSON；
-- 全新库由当前 079 文件负责。
--
-- 幂等：值已是 thermal75 时 WHERE 不匹配，天然无事发生。

SET @db = DATABASE();

SET @sql = IF(
  EXISTS (
    SELECT 1 FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'print_templates'
  ),
  'UPDATE print_templates SET paper_size = ''thermal75'' WHERE type IN (5,6,7,8,9) AND paper_size = ''thermal80''',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
