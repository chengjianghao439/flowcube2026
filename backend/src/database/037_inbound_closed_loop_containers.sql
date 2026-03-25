-- 强制入库闭环：容器在收货阶段生成（status=4 待上架），上架后变为 ACTIVE 并计入库存

ALTER TABLE inventory_containers
  ADD COLUMN inbound_task_id BIGINT UNSIGNED NULL COMMENT '入库任务ID' AFTER source_ref_no,
  ADD KEY idx_inbound_task_container (inbound_task_id);

ALTER TABLE inventory_containers
  MODIFY COLUMN status TINYINT UNSIGNED NOT NULL DEFAULT 1
    COMMENT '1=ACTIVE已上架 2=EMPTY 3=VOID 4=PENDING_PUTAWAY待上架不计库存';
