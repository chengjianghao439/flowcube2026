-- 跨期补录的「申请 → 他人审批 → 执行」审批流（2026-09-26 一致性审查 · 任务 7 第二期）。
--
-- 背景：任务 7 第一期（迁移 258）做的是**同步放行 + 留痕**：持 finance.period.backfill 者填原因后
-- 当场把业务写进已结账期间。业务口径随后定为「先审批、后动账」——申请人与审批人分离，且批准前
-- 这笔钱不进账，避免出现「钱动了、会计账上还没有、然后被驳回」的窗口。
--
-- 因此本迁移把 finance_period_backfills 从「留痕表」升级为「补录申请单」：
--   · 一次补录申请 = 一行，status 0待审批 → 1已批准(可执行/已执行) / 2已驳回；
--   · 批准是**他人**的权限（finance.period.backfill.approve），申请人不能批自己的；
--   · 批准前不写任何业务数据；批准后由系统按 request_snapshot 重放原请求，落库成功才回填 executed_*，
--     并**立即为补录当期生成调整凭证**（voucher_generated_at）。生成失败会把原因留在申请单上
--     （voucher_generate_error）并在审批页可一键重试——不允许悄悄退回「业务已动、凭证等人来点」。
--
-- 历史行处理：status 的默认值 3（历史遗留）承担标记——加列即把本列引入**之前**的行填成 3。
-- 那些行都是第一期「已放行并已写入业务」的补录，没有审批环节，页面显示为「历史补录 · 需人工核对」：
-- **不默认「已审批」**（那是把没发生过的事写成发生过），也**不自动补凭证**（补录凭证落期口径当时
-- 未定，自动补等于替会计做政策决定）。故本迁移**不含任何 UPDATE**。
--
-- 默认值刻意选 3 而非 0：万一将来有插入漏写 status，得到的是「需人工核对」而不是「待审批」，
-- 更不会凭空多出一张永远无人处理的申请单。唯一的插入点 recordBackfillApplication 显式写 0。
--
-- 申请单号不落列：用主键派生 `BF-<YYYYMMDD>-<id4>`（见 finance-backfills.service），
-- 避免多一列与主键重复的身份标识。
--
-- 幂等：全部改为「先查 information_schema 再动态执行」的逐列/逐索引条件式 DDL。
-- MySQL 8 的 ALTER TABLE 不支持 ADD COLUMN IF NOT EXISTS（MariaDB 扩展），而一次性
-- `ALTER TABLE ... ADD COLUMN a, ADD COLUMN b, ...` 中途失败后重跑会 duplicate column 中断迁移，
-- 故按本仓惯例（017/032/259）逐条判断（见 AGENTS.md 新迁移约束）。

-- ── finance_period_backfills：审批流字段 ──────────────────────────────────────
SET @dbname = DATABASE();
SET @tablename = 'finance_period_backfills';

SET @columnname = 'status';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND COLUMN_NAME = @columnname) > 0,
  'SELECT 1',
  'ALTER TABLE `finance_period_backfills` ADD COLUMN `status` TINYINT NOT NULL DEFAULT 3 COMMENT ''0待审批 1已批准 2已驳回 3历史遗留（第一期同步补录，无审批环节，需人工核对）'''
));
PREPARE stmt FROM @preparedStatement; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @columnname = 'applicant_id';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND COLUMN_NAME = @columnname) > 0,
  'SELECT 1',
  'ALTER TABLE `finance_period_backfills` ADD COLUMN `applicant_id` BIGINT UNSIGNED DEFAULT NULL COMMENT ''申请人'''
));
PREPARE stmt FROM @preparedStatement; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @columnname = 'applicant_name';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND COLUMN_NAME = @columnname) > 0,
  'SELECT 1',
  'ALTER TABLE `finance_period_backfills` ADD COLUMN `applicant_name` VARCHAR(50) DEFAULT NULL'
));
PREPARE stmt FROM @preparedStatement; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @columnname = 'request_snapshot';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND COLUMN_NAME = @columnname) > 0,
  'SELECT 1',
  'ALTER TABLE `finance_period_backfills` ADD COLUMN `request_snapshot` JSON DEFAULT NULL COMMENT ''原始请求快照（业务参数 + 原请求键），审批人据此核对，批准后据此重放'''
));
PREPARE stmt FROM @preparedStatement; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @columnname = 'approver_id';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND COLUMN_NAME = @columnname) > 0,
  'SELECT 1',
  'ALTER TABLE `finance_period_backfills` ADD COLUMN `approver_id` BIGINT UNSIGNED DEFAULT NULL COMMENT ''审批人（必须与申请人不为同一人）'''
));
PREPARE stmt FROM @preparedStatement; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @columnname = 'approver_name';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND COLUMN_NAME = @columnname) > 0,
  'SELECT 1',
  'ALTER TABLE `finance_period_backfills` ADD COLUMN `approver_name` VARCHAR(50) DEFAULT NULL'
));
PREPARE stmt FROM @preparedStatement; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @columnname = 'approved_at';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND COLUMN_NAME = @columnname) > 0,
  'SELECT 1',
  'ALTER TABLE `finance_period_backfills` ADD COLUMN `approved_at` DATETIME DEFAULT NULL'
));
PREPARE stmt FROM @preparedStatement; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @columnname = 'approve_remark';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND COLUMN_NAME = @columnname) > 0,
  'SELECT 1',
  'ALTER TABLE `finance_period_backfills` ADD COLUMN `approve_remark` VARCHAR(300) DEFAULT NULL COMMENT ''批准/驳回意见'''
));
PREPARE stmt FROM @preparedStatement; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @columnname = 'executed_at';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND COLUMN_NAME = @columnname) > 0,
  'SELECT 1',
  'ALTER TABLE `finance_period_backfills` ADD COLUMN `executed_at` DATETIME DEFAULT NULL COMMENT ''批准后业务实际写入完成时间；NULL 且 status=1 表示已批准但尚未执行成功'''
));
PREPARE stmt FROM @preparedStatement; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @columnname = 'executed_biz_id';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND COLUMN_NAME = @columnname) > 0,
  'SELECT 1',
  'ALTER TABLE `finance_period_backfills` ADD COLUMN `executed_biz_id` BIGINT UNSIGNED DEFAULT NULL COMMENT ''重放后产生的业务单据 id'''
));
PREPARE stmt FROM @preparedStatement; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @columnname = 'posting_period';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND COLUMN_NAME = @columnname) > 0,
  'SELECT 1',
  'ALTER TABLE `finance_period_backfills` ADD COLUMN `posting_period` CHAR(6) DEFAULT NULL COMMENT ''补录凭证归属期间（补录当期）；与业务日期所属期间不同，见 voucher-engine'''
));
PREPARE stmt FROM @preparedStatement; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @columnname = 'voucher_generated_at';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND COLUMN_NAME = @columnname) > 0,
  'SELECT 1',
  'ALTER TABLE `finance_period_backfills` ADD COLUMN `voucher_generated_at` DATETIME DEFAULT NULL COMMENT ''补录执行后自动生成调整凭证的完成时间；NULL 且 executed_at 非空=生成失败，需重试'''
));
PREPARE stmt FROM @preparedStatement; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @columnname = 'voucher_generate_error';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND COLUMN_NAME = @columnname) > 0,
  'SELECT 1',
  'ALTER TABLE `finance_period_backfills` ADD COLUMN `voucher_generate_error` VARCHAR(300) DEFAULT NULL COMMENT ''自动生成调整凭证失败的原因；重试成功后清空'''
));
PREPARE stmt FROM @preparedStatement; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @indexname = 'idx_fpb_status';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND INDEX_NAME = @indexname) > 0,
  'SELECT 1',
  'ALTER TABLE `finance_period_backfills` ADD KEY `idx_fpb_status` (`company_id`, `status`, `created_at`)'
));
PREPARE stmt FROM @preparedStatement; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ── 申请的幂等：请求键为永久身份，载荷指纹为一致性校验 ────────────────────────
--
-- 申请必须幂等，否则出纳一次提交 → 超时 → 重开再提交，会落两张内容相同的申请单；
-- 审批人看着两张一模一样的单子批准两次，就是同一笔钱记两次账。
--
-- **幂等身份 = 请求键（X-Request-Key），一次操作一个键，且是全生命周期的身份。**
-- 客户端约定与 operation_requests 相同：提交超时就**保留原键**重新提交、或查询上次结果，
-- 不得换键重发；确实换了键，就等于声明「这是新的一次业务」。
--
-- 唯一约束为什么覆盖**全生命周期**（而不是只在途）：
--   申请分支（tryRecordBackfillApplication）跑在业务 operation_requests 落回执**之前**。
--   若请求键在终态（已执行/已驳回）释放，同一次操作的超时重放会绕过回执、直接再插一张
--   新申请单——出纳看到「申请已提交」，库里却多了一张迟早被人批准的单子，同一笔钱记两次。
--   「同一次操作已经办完了」不等于「这个身份可以再用」：身份跟着操作走，不跟着状态走。
--   因此唯一键是 (company_id, biz_type, request_key)，从建单到终结一直占着；
--   要发起一笔新业务，客户端就用新的请求键。
--
-- 幂等作用域为什么不是「(biz_type, biz_id)」：
--   业务的 biz_id 是**账款 id**，而同一笔账款天然会有多次付款（先付 5000、再付 3000）。
--   按 biz_id 去重会把第二笔「并入」第一张在途申请——出纳以为提交了，其实那张单里是
--   第一笔的金额，第二笔钱永远不会被审批、永远不会记账。
--
-- 幂等作用域为什么也不是**载荷指纹**（一度这么设计过，是错的）：
--   载荷指纹把「内容一样的两笔不同业务」也算成同一笔。同一账款同一天、两次各 500 元的
--   真实付款，金额/日期/方式/账户**全都一样**，指纹必然相同——于是第二笔被并入第一张在途
--   申请，钱少了 500，且要等对账才发现。这与上面按 biz_id 去重是同一类错误，只换了个维度：
--   指纹能证明「这两次提交内容相同」，不能证明「这是同一次业务」。**丢账比重复记账更糟**：
--   重复记账对账能查出来，丢账只能等一笔钱不见了才知道。
--
-- 指纹降级为**同键载荷不可变校验**：同一个键再次提交时，载荷指纹必须相同。
--   · 相同 → 同一次操作的重放 → 返回原来那张申请单（不新增，也不重复动账）；
--   · 不同 → 同一个键被用来提交了别的内容（客户端键管理有问题）→ 明确 409 报错，
--     绝不静默把别人的单子当成本次结果返回，也绝不丢掉这次提交的内容。
--
-- 没有请求键（客户端没传）时不参与唯一约束（本列 NULL），即不做幂等——与
-- operation_requests 的既有语义一致（无键即无幂等）。这是客户端契约问题，不是本表职责。
--
-- 为什么用**唯一索引**而不是「先 SELECT 再 INSERT」：
--   先查后插是 TOCTOU——两个并发请求都读到「不存在」，然后各插一行，谁也拦不住。
--   唯一索引把并发交给数据库，第二个 INSERT 必然撞 ER_DUP_ENTRY，由应用读回既有行处理。
SET @columnname = 'request_key';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND COLUMN_NAME = @columnname) > 0,
  'SELECT 1',
  'ALTER TABLE `finance_period_backfills` ADD COLUMN `request_key` VARCHAR(64) DEFAULT NULL COMMENT ''本次操作的幂等身份（原提交的 X-Request-Key），全生命周期唯一'''
));
PREPARE stmt FROM @preparedStatement; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @columnname = 'payload_fingerprint';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND COLUMN_NAME = @columnname) > 0,
  'SELECT 1',
  'ALTER TABLE `finance_period_backfills` ADD COLUMN `payload_fingerprint` CHAR(16) DEFAULT NULL COMMENT ''载荷指纹（sha256 前 16 位）：只用于校验同一个请求键的载荷不可变，不用于识别业务身份'''
));
PREPARE stmt FROM @preparedStatement; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 全生命周期唯一：request_key 为 NULL 时 MySQL 唯一索引不约束（无键即无幂等）。
SET @indexname = 'uk_fpb_request_key';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND INDEX_NAME = @indexname) > 0,
  'SELECT 1',
  'ALTER TABLE `finance_period_backfills` ADD UNIQUE KEY `uk_fpb_request_key` (`company_id`, `biz_type`, `request_key`)'
));
PREPARE stmt FROM @preparedStatement; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ── finance_account_transactions：补录凭证的归属日期覆盖 ───────────────────────
--
-- 凭证引擎（voucher-engine.buildFundVouchers）以 finance_account_transactions 为驱动，用
-- happened_at 同时定凭证日期与所属期间。补录的业务**真实发生在**已结账期间（钱确实是那天的），
-- 所以 happened_at 必须保留真实日期——改它会篡改银行流水对账依据。业务口径（2026-09-26 确认）：
-- 补录凭证落**补录当期**（会计上标准的「前期差错在当期调整」），故加一列只覆盖凭证归属日期：
--   NULL     = 按 happened_at（正常业务）
--   非 NULL  = 凭证日期/期间用本列（跨期补录），流水日期仍是 happened_at
SET @tablename = 'finance_account_transactions';

SET @columnname = 'voucher_date_override';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND COLUMN_NAME = @columnname) > 0,
  'SELECT 1',
  'ALTER TABLE `finance_account_transactions` ADD COLUMN `voucher_date_override` DATE DEFAULT NULL COMMENT ''跨期补录的凭证归属日期（凭证落补录当期）；NULL=按 happened_at 归属'''
));
PREPARE stmt FROM @preparedStatement; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @columnname = 'backfill_id';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND COLUMN_NAME = @columnname) > 0,
  'SELECT 1',
  'ALTER TABLE `finance_account_transactions` ADD COLUMN `backfill_id` BIGINT UNSIGNED DEFAULT NULL COMMENT ''本次流水来自哪张补录申请单（finance_period_backfills.id）；NULL=正常业务'''
));
PREPARE stmt FROM @preparedStatement; EXECUTE stmt; DEALLOCATE PREPARE stmt;
