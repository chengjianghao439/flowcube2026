const { assertStatusAction } = require('../../constants/documentStatusRules')
const { buildDueDateSql, normalizeSettlementType } = require('../../constants/settlementType')
const { compareAndSetStatus } = require('../../utils/statusTransition')

/**
 * 重算并 upsert 某采购单的应付。
 *
 * 关键：**全量重算**（按该采购单下所有「已审核通过」收货订单的实际上架数量 × 采购单价求和，
 * 再扣除该采购单下所有「已退货(3)」的采购退货单金额），用 SET 覆盖而非累加——这样审核退回后
 * 重新通过、多批到货多次结算、以及退货发生在结算前后的任意顺序，都幂等，不会重复计账也不会
 * 把已经冲减的退货金额覆盖回去（见 P0-1：曾经出现过"退货冲减后，下一批到货结算把退货冲减吞掉"
 * 的静默财务问题）。金额=实收（上架）量，天然反映短装。依赖 payment_records 的
 * UNIQUE(type, order_id)（迁移 091）。
 */
async function recomputePurchasePayable(conn, purchaseOrderId) {
  const poId = Number(purchaseOrderId)
  if (!Number.isFinite(poId) || poId <= 0) return
  const [[po]] = await conn.query(
    `SELECT po.id, po.order_no, po.supplier_name, po.created_at,
            COALESCE(s.settlement_type, 2) AS settlement_type,
            COALESCE(s.payment_terms_days, 30) AS payment_terms_days
     FROM purchase_orders po
     LEFT JOIN supply_suppliers s ON s.id = po.supplier_id
     WHERE po.id = ?`,
    [poId],
  )
  if (!po) return
  // 聚合必须走当前读（FOR UPDATE），不能用快照读。否则在默认 REPEATABLE READ 下会 lost-update：
  // 同一采购单的多张收货单并发上架末箱、各自触发本函数时，事务的 read view 早在 putaway 前段
  // （非锁定 SELECT）就已固定，此处快照 SUM 看不到并发事务刚提交的另一张收货单 audit_status=1，
  // 只算到自己那一批 → 与下面「total_amount=VALUES() 绝对覆盖」的 upsert 叠加，后提交方把先提交
  // 方写入的应付金额直接覆盖少算，静默少付供应商（已用两连接确定性复现：50+30 被覆盖成 30）。
  // FOR UPDATE 让 SUM 读最新已提交并对相关行加锁串行化，与 containerEngine.syncStockFromContainers
  // 用 SUM(...) FOR UPDATE 防库存缓存 lost-update 是同一手法。极端并发下两批同时上架可能相互等待
  // 触发死锁，但那是 fail-safe（InnoDB 回滚一方、PDA 重试即读到正确值），远优于静默少算。
  const [[{ amount }]] = await conn.query(
    `SELECT COALESCE(SUM(iti.putaway_qty * poi.unit_price), 0) AS amount
       FROM inbound_tasks it
       JOIN inbound_task_items iti ON iti.task_id = it.id
       JOIN purchase_order_items poi ON poi.id = iti.purchase_item_id
      WHERE iti.purchase_order_id = ? AND it.deleted_at IS NULL
        AND it.status <> 5 AND it.audit_status = 1
      FOR UPDATE`,
    [poId],
  )
  const grossTotal = Number(amount) || 0
  // 同理走当前读：退货执行(status→3)与到货结算并发时，快照读会漏看已提交的退货冲减，
  // 使全量重算少减退货、应付偏大。FOR UPDATE 读最新已提交的退货金额。
  const [[{ returnedAmount }]] = await conn.query(
    `SELECT COALESCE(SUM(total_amount), 0) AS returnedAmount
       FROM purchase_returns
      WHERE purchase_order_id = ? AND deleted_at IS NULL AND status = 3
      FOR UPDATE`,
    [poId],
  )
  const total = Math.max(0, grossTotal - (Number(returnedAmount) || 0))
  // total<=0 时通常代表这张采购单从未真正结算过，不必造一条空的应付记录；
  // 但如果之前已经结算过（存在记录），哪怕现在归零（如撤回收货全部反冲），也要如实更新，
  // 不能让 payment_records 停留在撤回前的旧金额上。
  if (total <= 0) {
    const [[existing]] = await conn.query('SELECT id FROM payment_records WHERE type = 1 AND order_id = ?', [poId])
    if (!existing) return
  }
  // confirm_status：新结算/金额被重算改变（多批到货、退货冲减、撤回收货）时打回
  // 待财务确认(0)，金额未变的幂等重算保持原确认状态；付款登记要求 confirm_status=1
  // （见 payments.service.recordPayment），形成"仓库结算、财务确认、出纳付款"的分权。
  // 到期日按供应商主数据的结算方式 + 账期天数计算：现结从采购单创建日起算，
  // 月结从本次结算时刻起算（见 constants/settlementType.js 的对照表）。
  //
  // settlement_type 与 due_date 一样只在首次 INSERT 时写入，**不在重算时更新**：
  // 账款是历史事实，当初按什么条件结算就是什么条件；之后把供应商从现结改成月结，
  // 不该把这批老账追溯改写成月结（迁移 136）。补收货/退货只重算金额。
  const settlementSnapshot = normalizeSettlementType(po.settlement_type)
  const due = buildDueDateSql(settlementSnapshot, po.payment_terms_days, po.created_at)
  await conn.query(
    `INSERT INTO payment_records
       (type, order_id, order_no, party_name, total_amount, paid_amount, balance, status, confirm_status, settlement_type, due_date)
     VALUES (1, ?, ?, ?, ?, 0, ?, 1, 0, ?, ${due.expr})
     ON DUPLICATE KEY UPDATE
       confirm_status = CASE WHEN total_amount <> VALUES(total_amount) THEN 0 ELSE confirm_status END,
       total_amount = VALUES(total_amount),
       balance = GREATEST(0, VALUES(total_amount) - paid_amount),
       status = CASE WHEN paid_amount >= VALUES(total_amount) THEN 3
                     WHEN paid_amount > 0 THEN 2 ELSE 1 END`,
    [poId, po.order_no, po.supplier_name, total, total, settlementSnapshot, ...due.params],
  )
}

/**
 * 采购单是否「全部明细都已由已审核通过的收货订单收齐」且无未审核收货订单。
 * 满足则可自动完成；短装（未收齐）时返回 false，需人工「关闭剩余」结案。
 */
async function isPurchaseFullyReceivedAndAudited(conn, purchaseOrderId) {
  const poId = Number(purchaseOrderId)
  if (!Number.isFinite(poId) || poId <= 0) return false
  const [[{ pending }]] = await conn.query(
    `SELECT COUNT(DISTINCT it.id) AS pending
       FROM inbound_tasks it
       JOIN inbound_task_items iti ON iti.task_id = it.id
      WHERE iti.purchase_order_id = ? AND it.deleted_at IS NULL
        AND it.status <> 5 AND it.audit_status <> 1`,
    [poId],
  )
  if (Number(pending) > 0) return false
  const [rows] = await conn.query(
    `SELECT poi.quantity,
            COALESCE(SUM(CASE WHEN it.status <> 5 AND it.audit_status = 1 THEN iti.putaway_qty ELSE 0 END), 0) AS ap
       FROM purchase_order_items poi
       LEFT JOIN inbound_task_items iti ON iti.purchase_item_id = poi.id
       LEFT JOIN inbound_tasks it ON it.id = iti.task_id
      WHERE poi.order_id = ?
      GROUP BY poi.id, poi.quantity`,
    [poId],
  )
  return rows.length > 0 && rows.every(r => Number(r.ap) >= Number(r.quantity))
}

/** 尝试把采购单推进到「已完成(3)」，已完成/状态不符则静默忽略（幂等）。 */
async function tryCompletePurchase(conn, purchaseOrderId) {
  const rule = assertStatusAction('purchase', 'complete', 2)
  try {
    await compareAndSetStatus(conn, {
      table: 'purchase_orders',
      id: Number(purchaseOrderId),
      fromStatus: rule.from,
      toStatus: rule.to,
      entityName: '采购单',
    })
  } catch (e) {
    if (e?.statusCode !== 409) throw e
  }
}

/**
 * 收货订单审核通过后的结算：重算涉及的每个采购单应付；若已收齐且无待审核订单则自动完成。
 * 一张收货订单可能混合多个采购单的明细（此时 inbound_tasks.purchase_order_id 为空），
 * 因此改从 inbound_task_items 按明细归属的采购单逐一结算，而非只看收货单头字段。
 * 在 audit 的同一事务内调用。
 */
async function settlePurchaseOnAudit(conn, taskId) {
  const [rows] = await conn.query(
    'SELECT DISTINCT purchase_order_id FROM inbound_task_items WHERE task_id = ?',
    [taskId],
  )
  for (const row of rows) {
    const poId = Number(row.purchase_order_id)
    if (!Number.isFinite(poId) || poId <= 0) continue
    await recomputePurchasePayable(conn, poId)
    if (await isPurchaseFullyReceivedAndAudited(conn, poId)) {
      await tryCompletePurchase(conn, poId)
    }
  }
}

module.exports = {
  recomputePurchasePayable,
  isPurchaseFullyReceivedAndAudited,
  tryCompletePurchase,
  settlePurchaseOnAudit,
}
