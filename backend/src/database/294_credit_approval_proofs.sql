-- 293 is reserved for the independent PDA change. No role grants or backfill.
-- Legacy approved requests without an immutable basis must be reviewed again.
CREATE TABLE IF NOT EXISTS sale_credit_approval_proofs (
  override_id BIGINT UNSIGNED NOT NULL,
  sale_order_id BIGINT UNSIGNED NOT NULL,
  basis_hash CHAR(64) NOT NULL,
  expires_at DATETIME DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (override_id),
  KEY idx_credit_proof_order (sale_order_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sale_credit_approval_actions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  override_id BIGINT UNSIGNED NOT NULL,
  sale_order_id BIGINT UNSIGNED NOT NULL,
  instance_id BIGINT UNSIGNED NOT NULL,
  task_id BIGINT UNSIGNED NOT NULL,
  step_order INT NOT NULL,
  applicant_id BIGINT UNSIGNED NOT NULL,
  approver_id BIGINT UNSIGNED NOT NULL,
  approver_name VARCHAR(50) NOT NULL,
  action VARCHAR(20) NOT NULL,
  reason VARCHAR(500) DEFAULT NULL,
  is_self_approval TINYINT(1) NOT NULL DEFAULT 0,
  authorization_basis JSON NOT NULL,
  request_key VARCHAR(100) NOT NULL,
  action_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_credit_action_task (task_id),
  KEY idx_credit_action_document (override_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
